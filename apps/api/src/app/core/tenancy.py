"""Automatic multi-tenancy.

Every row of an :class:`~app.models.base.OrgScoped` model is filtered by the
active tenant. This is enforced by SQLAlchemy session events rather than by
call-site discipline, so there is no query path that can forget it.

Four guarantees, and one thing they do not cover:

1. **Reads** — ``do_orm_execute`` applies ``with_loader_criteria`` to every ORM
   SELECT, including relationship loads.
2. **Writes** — ``before_flush`` stamps ``org_id``/``event_id`` on new rows and
   rejects any write that would cross a tenant boundary.
3. **Bulk statements** — ``session.execute(update(Model)...)`` and the delete
   equivalent are rejected unless their WHERE clause names a tenant column.

   This guard lives in ``do_orm_execute``, *not* in the engine-level
   ``before_execute``, because the ORM's own unit-of-work flush emits Core
   UPDATE statements keyed only on the primary key; an engine-level guard would
   reject every ordinary save.

4. **Statements with no ORM entity** — ``select(func.count()).select_from(Model)``
   has nothing for ``with_loader_criteria`` to attach to, so it is refused rather
   than answered across every organization. Use ``select(func.count(Model.id))``.

**What this does not cover:** a statement executed on a raw ``Connection``
rather than through the ``Session``. Application code always goes through the
session; if you reach for a raw connection, you own the tenant predicate.

The guard proves a tenant column is *present*, not that it is compared against
the *right* value. It catches the realistic bug — omitting the filter — and the
two-org leak test in ``tests/test_tenancy.py`` covers the rest.

Nothing is filtered when no tenant is set: instead, touching a tenant-scoped
model without one raises. Fail closed, never fail open.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from functools import lru_cache
from typing import Final

from sqlalchemy import event
from sqlalchemy.orm import ORMExecuteState, Session, with_loader_criteria
from sqlalchemy.sql import visitors
from sqlalchemy.sql.elements import ColumnClause

from app.models.base import EventScoped, OrgScoped

TENANT_COLUMNS: Final = frozenset({"org_id", "event_id"})


class TenancyError(RuntimeError):
    """Base for every tenancy violation. Always a bug, never user input."""


class MissingTenantError(TenancyError):
    pass


class CrossTenantWriteError(TenancyError):
    pass


class UnscopedBulkStatementError(TenancyError):
    pass


class UnscopedStatementError(TenancyError):
    """A statement touches a tenant-scoped table that cannot be filtered."""


@dataclass(frozen=True, slots=True)
class TenantContext:
    org_id: uuid.UUID
    event_id: uuid.UUID | None = None


class _Disabled:
    __slots__ = ()


DISABLED: Final = _Disabled()

_tenant: ContextVar[TenantContext | _Disabled | None] = ContextVar("tenant", default=None)


def current_tenant() -> TenantContext:
    """The active tenant, or raise. Use where a tenant is required."""
    value = _tenant.get()
    if isinstance(value, TenantContext):
        return value
    raise MissingTenantError(
        "no tenant in context; wrap the call in tenant_scope(...) or tenancy_disabled()"
    )


@contextmanager
def tenant_scope(org_id: uuid.UUID, event_id: uuid.UUID | None = None) -> Iterator[TenantContext]:
    """Scope every query in this block to one organization, optionally one event."""
    ctx = TenantContext(org_id=org_id, event_id=event_id)
    token = _tenant.set(ctx)
    try:
        yield ctx
    finally:
        _tenant.reset(token)


@contextmanager
def tenancy_disabled() -> Iterator[None]:
    """Escape hatch. Legitimate only in seeds, migrations, and cross-org admin reads.

    Deliberately greppable: every use should be obvious in review.
    """
    token = _tenant.set(DISABLED)
    try:
        yield
    finally:
        _tenant.reset(token)


@lru_cache(maxsize=1)
def _tenant_scoped_tables() -> frozenset[str]:
    from app.models.base import Base

    return frozenset(
        mapper.class_.__tablename__  # type: ignore[attr-defined]
        for mapper in Base.registry.mappers
        if issubclass(mapper.class_, OrgScoped)
    )


def _touches_tenant_scoped(state: ORMExecuteState) -> bool:
    return any(issubclass(mapper.class_, OrgScoped) for mapper in state.all_mappers)


def _unmapped_tenant_tables(state: ORMExecuteState) -> set[str]:
    """Tenant-scoped tables present in the statement with no ORM entity attached.

    `select(func.count()).select_from(Model)` is the common shape: the model is a
    FROM but not a column, so `all_mappers` is empty and `with_loader_criteria`
    has nothing to attach to. Left alone that query silently counts every
    organization's rows.
    """
    try:
        froms = state.statement.get_final_froms()  # type: ignore[attr-defined]
    except (AttributeError, NotImplementedError):
        return set()
    names = {getattr(f, "name", None) for f in froms}
    return {n for n in names if n is not None and n in _tenant_scoped_tables()}


def _is_unset(obj: object, field: str) -> bool:
    """True when the attribute was never assigned on this instance.

    Deliberately not ``is None``: the columns are NOT NULL, so the type checker
    rules that comparison out, and it would conflate "never set" with "explicitly
    set to None" anyway.
    """
    return field not in obj.__dict__


def _where_column_names(statement: object) -> set[str]:
    where = getattr(statement, "whereclause", None)
    if where is None:
        return set()
    return {
        element.name
        for element in visitors.iterate(where)
        if isinstance(element, ColumnClause) and element.name in TENANT_COLUMNS
    }


@event.listens_for(Session, "do_orm_execute")
def _apply_tenancy(state: ORMExecuteState) -> None:
    # Relationship and deferred-column loads inherit the criteria already applied
    # to the statement that triggered them.
    if state.is_column_load or state.is_relationship_load:
        return

    value = _tenant.get()

    if not _touches_tenant_scoped(state):
        # No ORM entity to hang criteria on. If a tenant-scoped table is in the
        # FROM anyway, refuse rather than answer across every organization.
        orphans = _unmapped_tenant_tables(state)
        if orphans and not isinstance(value, _Disabled):
            raise UnscopedStatementError(
                f"statement selects from tenant-scoped {sorted(orphans)} with no ORM entity, "
                "so it cannot be filtered. Use the entity form — select(func.count(Model.id)) "
                "rather than select(func.count()).select_from(Model)."
            )
        return

    if isinstance(value, _Disabled):
        return
    if value is None:
        raise MissingTenantError(
            f"query touches tenant-scoped {[m.class_.__name__ for m in state.all_mappers]} "
            "with no tenant in context"
        )

    if state.is_update or state.is_delete:
        if not _where_column_names(state.statement):
            raise UnscopedBulkStatementError(
                "bulk UPDATE/DELETE on a tenant-scoped table must filter on org_id "
                "or event_id; with_loader_criteria does not apply to bulk statements"
            )
        return

    if not state.is_select:
        return

    org_id = value.org_id
    state.statement = state.statement.options(
        with_loader_criteria(
            OrgScoped,
            lambda cls: cls.org_id == org_id,
            include_aliases=True,
        )
    )


@event.listens_for(Session, "before_flush")
def _stamp_and_validate(session: Session, flush_context: object, instances: object) -> None:
    value = _tenant.get()
    if isinstance(value, _Disabled):
        return

    pending = [obj for obj in session.new if isinstance(obj, OrgScoped)]
    changed = [obj for obj in session.dirty if isinstance(obj, OrgScoped)]
    if not pending and not changed:
        return

    if value is None:
        raise MissingTenantError("flushing tenant-scoped rows with no tenant in context")

    for obj in pending:
        if _is_unset(obj, "org_id"):
            obj.org_id = value.org_id
        elif obj.org_id != value.org_id:
            raise CrossTenantWriteError(
                f"{type(obj).__name__} carries org_id={obj.org_id!s} "
                f"but the active tenant is {value.org_id!s}"
            )
        if isinstance(obj, EventScoped) and _is_unset(obj, "event_id"):
            if value.event_id is None:
                raise MissingTenantError(
                    f"{type(obj).__name__} is event-scoped but no event_id is in context"
                )
            obj.event_id = value.event_id

    for obj in changed:
        if obj.org_id != value.org_id:
            raise CrossTenantWriteError(
                f"refusing to update {type(obj).__name__} owned by org {obj.org_id!s} "
                f"while acting as {value.org_id!s}"
            )
