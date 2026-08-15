"""The tenancy spine is the one mechanism whose failure is a cross-conference data
leak. Nothing else in the API is allowed to depend on it until these pass.
"""

from __future__ import annotations

import uuid
from datetime import date

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
from app.models import Event, EventStatus, Organization, Room


async def test_select_returns_only_the_active_org(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    org_a, _ = two_orgs
    with tenant_scope(org_a.id):
        events = (await session.execute(select(Event))).scalars().all()

    assert [e.name for e in events] == ["Alpha May 2027"]


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

    assert [e.name for e in first] == ["Alpha May 2027"]
    assert [e.name for e in second] == ["Beta 2026"]
    assert [e.name for e in third] == ["Alpha May 2027"]


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
    assert locations["Alpha May 2027"] == "Hall A"
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

    assert {e.name for e in events} == {"Alpha May 2027", "Beta 2026"}


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


async def test_a_paginated_count_is_scoped_to_the_tenant(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    """The bug this guards: `paginate` counted through an anonymous subquery, so
    the rows were correctly filtered but the total was not — a brand new
    organization could read another one's row count."""
    from app.core.pagination import ListQuery, paginate

    org_a, _ = two_orgs
    with tenant_scope(org_a.id):
        rows, meta = await paginate(session, select(Event), ListQuery())

    assert len(rows) == 1
    assert meta.total == 1


async def test_an_aggregate_over_a_table_column_is_refused(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    """`Event.__table__.c.id` is a plain Column, not the mapped attribute, so it
    carries no mapper for the criteria to attach to. It must not silently count
    every organization."""
    from sqlalchemy import func

    from app.core.tenancy import UnscopedStatementError

    org_a, _ = two_orgs
    with tenant_scope(org_a.id), pytest.raises(UnscopedStatementError):
        await session.execute(select(func.count(Event.__table__.c.id)))


async def test_a_scope_naming_an_event_hides_the_org_s_other_events(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    """Filtering on org alone is not enough. An organization running two
    conferences is the ordinary case, and it would show one event's rooms inside
    the other's agenda."""
    org_a, _org_b = two_orgs

    with tenancy_disabled():
        first = (
            (await session.execute(select(Event).where(Event.org_id == org_a.id))).scalars().first()
        )
        assert first is not None
        second = Event(
            org_id=org_a.id,
            name="Alpha 2027",
            slug="alpha-2027",
            timezone="UTC",
            starts_on=date(2027, 9, 1),
            ends_on=date(2027, 9, 3),
            status=EventStatus.CFP_OPEN,
        )
        session.add(second)
        await session.flush()
        session.add_all(
            [
                Room(org_id=org_a.id, event_id=first.id, name="This year's stage"),
                Room(org_id=org_a.id, event_id=second.id, name="Next year's stage"),
            ]
        )
        await session.commit()

    with tenant_scope(org_id=org_a.id, event_id=first.id):
        rooms = (await session.execute(select(Room))).scalars().all()

    assert [room.name for room in rooms] == ["This year's stage"]


async def test_a_scope_with_no_event_sees_the_whole_organization(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    """The speaker directory spans events on purpose, so an org-level scope must
    not be silently narrowed to one of them."""
    org_a, _org_b = two_orgs

    with tenancy_disabled():
        events = (
            (await session.execute(select(Event).where(Event.org_id == org_a.id))).scalars().all()
        )
        assert events
        for index, event in enumerate(events):
            session.add(Room(org_id=org_a.id, event_id=event.id, name=f"Room {index}"))
        await session.commit()

    with tenant_scope(org_id=org_a.id):
        rooms = (await session.execute(select(Room))).scalars().all()

    assert len(rooms) == len(events)
