"""The tenancy spine is the one mechanism whose failure is a cross-conference data
leak. Nothing else in the API is allowed to depend on it until these pass.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import (
    CrossTenantWriteError,
    MissingTenantError,
    UnscopedBulkStatementError,
    tenancy_disabled,
    tenant_scope,
)
from app.models import Event, Organization


async def test_select_returns_only_the_active_org(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    org_a, _ = two_orgs
    with tenant_scope(org_a.id):
        events = (await session.execute(select(Event))).scalars().all()

    assert [e.name for e in events] == ["Alpha 2026"]


async def test_switching_tenant_switches_results(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    """Guards the real risk in this design: SQLAlchemy caches lambda criteria, so a
    stale closure would pin every later query to the first tenant seen."""
    org_a, org_b = two_orgs

    with tenant_scope(org_a.id):
        first = (await session.execute(select(Event))).scalars().all()
    with tenant_scope(org_b.id):
        second = (await session.execute(select(Event))).scalars().all()
    with tenant_scope(org_a.id):
        third = (await session.execute(select(Event))).scalars().all()

    assert [e.name for e in first] == ["Alpha 2026"]
    assert [e.name for e in second] == ["Beta 2026"]
    assert [e.name for e in third] == ["Alpha 2026"]


async def test_other_tenants_row_is_invisible_by_id(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    """A direct lookup of a known id must miss, not leak."""
    org_a, org_b = two_orgs
    with tenancy_disabled():
        beta = (await session.execute(select(Event).where(Event.org_id == org_b.id))).scalar_one()

    with tenant_scope(org_a.id):
        found = (
            await session.execute(select(Event).where(Event.id == beta.id))
        ).scalar_one_or_none()

    assert found is None


async def test_query_without_tenant_raises_instead_of_returning_everything(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    """Fail closed. Forgetting the scope must be loud, not permissive."""
    with pytest.raises(MissingTenantError):
        await session.execute(select(Event))


async def test_insert_is_stamped_with_the_active_org(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    org_a, _ = two_orgs
    from datetime import date

    with tenant_scope(org_a.id):
        event = Event(
            name="Alpha Workshop",
            slug="alpha-workshop",
            timezone="UTC",
            starts_on=date(2026, 9, 5),
            ends_on=date(2026, 9, 5),
        )
        session.add(event)
        await session.flush()

    assert event.org_id == org_a.id


async def test_write_into_another_org_is_rejected(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    org_a, org_b = two_orgs
    from datetime import date

    with tenant_scope(org_a.id), pytest.raises(CrossTenantWriteError):
        session.add(
            Event(
                org_id=org_b.id,
                name="Smuggled",
                slug="smuggled",
                timezone="UTC",
                starts_on=date(2026, 9, 5),
                ends_on=date(2026, 9, 5),
            )
        )
        await session.flush()


async def test_updating_another_orgs_row_is_rejected(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    org_a, org_b = two_orgs
    with tenancy_disabled():
        beta = (await session.execute(select(Event).where(Event.org_id == org_b.id))).scalar_one()

    beta.name = "Renamed by the wrong tenant"
    with tenant_scope(org_a.id), pytest.raises(CrossTenantWriteError):
        await session.flush()


async def test_bulk_update_without_a_tenant_predicate_raises(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    """The documented gap in with_loader_criteria, closed explicitly."""
    org_a, _ = two_orgs
    with tenant_scope(org_a.id), pytest.raises(UnscopedBulkStatementError):
        await session.execute(update(Event).values(name="clobbered"))


async def test_bulk_delete_without_a_tenant_predicate_raises(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    org_a, _ = two_orgs
    with tenant_scope(org_a.id), pytest.raises(UnscopedBulkStatementError):
        await session.execute(delete(Event))


async def test_bulk_update_with_a_tenant_predicate_is_allowed_and_scoped(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    org_a, org_b = two_orgs
    with tenant_scope(org_a.id):
        await session.execute(
            update(Event).where(Event.org_id == org_a.id).values(location="Hall A")
        )

    with tenancy_disabled():
        rows = (
            await session.execute(
                select(Event.name, Event.location).where(Event.org_id.in_([org_a.id, org_b.id]))
            )
        ).all()

    locations = dict(rows)
    assert locations["Alpha 2026"] == "Hall A"
    assert locations["Beta 2026"] is None


async def test_tenancy_disabled_sees_every_org(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    org_a, org_b = two_orgs
    with tenancy_disabled():
        events = (
            (await session.execute(select(Event).where(Event.org_id.in_([org_a.id, org_b.id]))))
            .scalars()
            .all()
        )

    assert {e.name for e in events} == {"Alpha 2026", "Beta 2026"}


async def test_unknown_tenant_sees_nothing(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    with tenant_scope(uuid.uuid4()):
        events = (await session.execute(select(Event))).scalars().all()

    assert events == []


async def test_aggregate_without_an_orm_entity_is_refused(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    """`select(func.count()).select_from(Model)` puts no entity in the columns
    clause, so with_loader_criteria has nothing to attach to and the query would
    silently count every organization. It must raise instead."""
    from sqlalchemy import func

    from app.core.tenancy import UnscopedStatementError

    org_a, _ = two_orgs
    with tenant_scope(org_a.id), pytest.raises(UnscopedStatementError):
        await session.execute(select(func.count()).select_from(Event))


async def test_the_entity_form_of_the_same_count_is_filtered(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    from sqlalchemy import func

    org_a, _ = two_orgs
    with tenant_scope(org_a.id):
        count = await session.scalar(select(func.count(Event.id)))

    assert count == 1


async def test_tenancy_disabled_still_allows_the_unmapped_aggregate(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    """Seeds and admin reads legitimately count across organizations."""
    from sqlalchemy import func

    with tenancy_disabled():
        count = await session.scalar(select(func.count()).select_from(Event))

    assert count is not None and count >= 2
