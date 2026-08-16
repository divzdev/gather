"""A router factory for simple event-scoped resources, and the writer beneath it.

Tracks, rooms, session formats, event days and schedule blocks are the same five
endpoints over different columns. Five hand-written copies would be ~300 lines of
identical code, so this is the second-usage threshold met honestly rather than a
generic CRUD framework: it covers list/create/read/update/delete over one model
and nothing else. A resource that grows real behaviour gets its own router and
stops using this.

`create_resource` and `update_resource` are separate from the routes on purpose
(spec 0008). They used to live inside the factory's closure, which was fine while
HTTP was the only way in. It is not any more: the event assistant can propose a
program change, and accepting one has to run **this** code rather than its own
copy. A second implementation would agree with this one on the day it was written
and drift the first time somebody added a hook — which is the failure mode the
whole proposal pattern exists to prevent, reappearing one layer down.
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import DbSession, bind_tenant, require_role
from app.core.errors import ConflictError, NotFoundError
from app.models import Role, User
from app.models.base import Base

WRITE_ROLES = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)
READ_ROLES = (Role.OWNER, Role.ADMIN, Role.COORDINATOR, Role.REVIEWER)

PostCreate = Callable[[AsyncSession, Any], Awaitable[None]]
#: Applied after the fields are set and before the flush, for a resource whose
#: edit has consequences beyond its own row.
PostUpdate = Callable[[AsyncSession, Any, dict[str, Any]], Awaitable[None]]
#: Why this row cannot be deleted, or None if it can. A sentence rather than a
#: count, because "3 sessions are scheduled on this day" and "2 sessions are in
#: this room" are different facts and the factory cannot know which it is holding.
InUseCheck = Callable[[AsyncSession, uuid.UUID], Awaitable[str | None]]
#: Read-only fields computed for every row of this resource in one pass, keyed by
#: row id and merged into the read schema. What a screen needs to say about a row
#: is mostly derived — how many sessions use it, what hours a day actually
#: occupies — and derived beats asking an organiser to type it in and keep it true.
RowExtras = Callable[[AsyncSession], Awaitable[dict[uuid.UUID, dict[str, Any]]]]


@dataclass(frozen=True, slots=True)
class ResourceSpec:
    """One event-scoped resource, described once.

    Defined as data rather than as arguments to the factory so that the two
    things which need it — the HTTP routes and the assistant's apply path — read
    the *same* description. The alternative is spelling a resource's schema,
    hooks and duplicate message out in two places, which is a drift waiting to
    happen (spec 0008).
    """

    model: type[Base]
    read_schema: type[BaseModel]
    create_schema: type[BaseModel]
    update_schema: type[BaseModel]
    plural: str
    tag: str
    #: Shown when a unique constraint fires. Written per resource because "this
    #: event already has a room with that name" is a better sentence than
    #: anything a factory could assemble.
    duplicate: str
    #: How an organiser names one of these in conversation: the column an
    #: assistant proposal resolves a target against.
    label_column: str = "name"
    order_by: str = "sort_order"
    on_create: PostCreate | None = None
    on_update: PostUpdate | None = None
    in_use: InUseCheck | None = None
    extras: RowExtras | None = None

    @property
    def singular(self) -> str:
        return self.tag[:-1] if self.tag.endswith("s") else self.tag


async def flush_resource(session: AsyncSession, spec: ResourceSpec) -> None:
    """Turn a unique-constraint violation into the sentence that caused it.

    Every one of these resources is unique on something an organiser types — a
    room's name, a day's date. Letting the IntegrityError out returned a bare
    500 to somebody who had simply added the same day twice.
    """
    try:
        await session.flush()
    except IntegrityError as clash:
        if "unique" not in str(clash.orig).lower():
            raise
        raise ConflictError(spec.duplicate, details={"duplicate": True}) from clash


async def create_resource(session: AsyncSession, spec: ResourceSpec, body: BaseModel) -> Any:
    """Add one row, hooks and all. The only way a row of these is created.

    `exclude_unset` is what keeps a create honest: a field nobody supplied takes
    the column's default rather than the schema's, so a room described only by
    name does not acquire a capacity somebody's model imagined.
    """
    item = spec.model(**body.model_dump(exclude_unset=True))
    session.add(item)
    if spec.on_create is not None:
        await spec.on_create(session, item)
    await flush_resource(session, spec)
    return item


def previous_values(row: Any, body: BaseModel) -> dict[str, Any]:
    """What the row holds today, for exactly the fields this edit would change.

    Read before the edit is applied — by `update_resource` for its hook, and by
    the assistant when it builds a proposal, so a card can say `capacity 60 → 80`
    with a left-hand side that came from the database rather than from a guess.
    """
    return {key: getattr(row, key) for key in body.model_dump(exclude_unset=True)}


async def update_resource(
    session: AsyncSession, spec: ResourceSpec, row: Any, body: BaseModel
) -> Any:
    """Apply an edit to one row, hooks and all. The only way one of these changes."""
    changes: dict[str, Any] = body.model_dump(exclude_unset=True)
    before = previous_values(row, body)
    for key, value in changes.items():
        setattr(row, key, value)
    if spec.on_update is not None:
        await spec.on_update(session, row, before)
    await flush_resource(session, spec)
    return row


async def get_resource(session: AsyncSession, spec: ResourceSpec, item_id: uuid.UUID) -> Any:
    item = await session.get(spec.model, item_id)
    if item is None:
        raise NotFoundError(f"No {spec.singular} with id {item_id}.")
    return item


def event_resource_router(spec: ResourceSpec) -> APIRouter:
    model, read_schema = spec.model, spec.read_schema
    create_schema, update_schema = spec.create_schema, spec.update_schema
    extras, in_use = spec.extras, spec.in_use

    router = APIRouter(
        prefix="/v1/events/{event_id}/" + spec.plural,
        tags=[spec.tag],
        dependencies=[Depends(bind_tenant)],
    )

    async def _read(session: AsyncSession, rows: list[Any]) -> list[Any]:
        """One aggregate for the whole list, not one query per row."""
        computed = {} if extras is None else await extras(session)
        return [
            read_schema.model_validate(row).model_copy(update=computed.get(row.id, {}))
            for row in rows
        ]

    @router.get("", response_model=list[read_schema])  # type: ignore[valid-type]
    async def list_items(
        session: DbSession,
        _: User = Depends(require_role(*READ_ROLES)),
    ) -> Any:
        column = getattr(model, spec.order_by, None) or model.id  # type: ignore[attr-defined]
        # `id` second, always. Every one of these resources sorts on a field an
        # organiser can leave at its default — three tracks all at `sort_order:
        # 0` is the normal case — and a tie with no tiebreak lets Postgres
        # return whatever physical order it likes. That surfaced as a list
        # arriving [1, 3, 2] once unrelated work changed the row layout, which
        # reads on screen as the app shuffling itself. UUIDv7 is time-ordered,
        # so this is "the order they were added".
        rows = (
            (await session.execute(select(model).order_by(column, model.id)))  # type: ignore[attr-defined]
            .scalars()
            .all()
        )
        return await _read(session, list(rows))

    @router.post("", response_model=read_schema, status_code=status.HTTP_201_CREATED)
    async def create_item(
        body: create_schema,  # type: ignore[valid-type]
        session: DbSession,
        _: User = Depends(require_role(*WRITE_ROLES)),
    ) -> Any:
        return (await _read(session, [await create_resource(session, spec, body)]))[0]

    @router.get("/{item_id}", response_model=read_schema)
    async def read_item(
        item_id: uuid.UUID,
        session: DbSession,
        _: User = Depends(require_role(*READ_ROLES)),
    ) -> Any:
        return (await _read(session, [await get_resource(session, spec, item_id)]))[0]

    @router.patch("/{item_id}", response_model=read_schema)
    async def update_item(
        item_id: uuid.UUID,
        body: update_schema,  # type: ignore[valid-type]
        session: DbSession,
        _: User = Depends(require_role(*WRITE_ROLES)),
    ) -> Any:
        item = await update_resource(
            session, spec, await get_resource(session, spec, item_id), body
        )
        # Counted after the flush, so an edit that moved other rows reports what
        # it actually touched rather than the zero a bare row would carry.
        return (await _read(session, [item]))[0]

    @router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_item(
        item_id: uuid.UUID,
        session: DbSession,
        _: User = Depends(require_role(*WRITE_ROLES)),
    ) -> None:
        item = await get_resource(session, spec, item_id)
        if in_use is not None:
            # The foreign keys are ON DELETE SET NULL or CASCADE, so this would
            # otherwise succeed and quietly strip the track off forty sessions,
            # or take the day's lunch break with it. Refusing is the sensible
            # outcome; unpicking it afterwards is not something an organiser can
            # do.
            blocked = await in_use(session, item_id)
            if blocked is not None:
                raise ConflictError(blocked, details={"blocked": True})
        await session.delete(item)

    return router
