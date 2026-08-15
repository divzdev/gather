"""Membership scope — spec 0004, seam 1: the members and org HTTP surface.

Everything is observed through GET/PATCH members and PATCH orgs. The tiers
already exist (`OrgMember` = every event, `EventMember` = this event) and
already compose override-then-baseline; what is under test is the screen's
contract over them: which tier a person is on, moving them between tiers, the
guard matrix, and the reachability that is the reason this spec exists.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.tenancy import tenancy_disabled
from app.models import Event, EventMember, EventStatus, Organization, OrgMember, Role, User

PASSWORD = "a known password 42"


async def _sign_in(client: AsyncClient, email: str) -> dict[str, str]:
    login = await client.post("/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _person(session: AsyncSession, suffix: str, label: str) -> User:
    user = User(
        email=f"{label}-{suffix}@example.com",
        name=f"{label.title()} Person",
        password_hash=hash_password(PASSWORD),
        email_verified_at=datetime.now(UTC),
    )
    session.add(user)
    await session.flush()
    return user


class World:
    """One org, two events, and the cast the guard matrix needs."""

    def __init__(self) -> None:
        self.org: Organization
        self.event: Event
        self.sibling: Event
        self.owner: User
        self.admin: User
        self.coordinator: User
        self.event_only: User


@pytest.fixture
async def world(client: AsyncClient, session: AsyncSession) -> World:
    suffix = uuid.uuid4().hex[:8]
    built = World()
    with tenancy_disabled():
        org = Organization(name=f"Org {suffix}", slug=f"org-{suffix}")
        session.add(org)
        await session.flush()

        def _event(name: str, slug: str) -> Event:
            return Event(
                org_id=org.id,
                name=name,
                slug=slug,
                timezone="UTC",
                starts_on=date(2027, 5, 12),
                ends_on=date(2027, 5, 14),
                status=EventStatus.CFP_OPEN,
                cfp_closes_at=datetime.now(UTC) + timedelta(days=30),
            )

        event = _event("DevFlow Conf 2027", f"devflow-{suffix}")
        sibling = _event("Sibling Conf 2027", f"sibling-{suffix}")
        session.add_all([event, sibling])
        await session.flush()

        owner = await _person(session, suffix, "owner")
        admin = await _person(session, suffix, "admin")
        coordinator = await _person(session, suffix, "coordinator")
        event_only = await _person(session, suffix, "eventonly")

        # Owner and admin work on every event; the coordinator and the
        # event-only admin exist on one, which is what today's Team panel is
        # able to create.
        session.add_all(
            [
                OrgMember(org_id=org.id, user_id=owner.id, role=Role.OWNER),
                OrgMember(org_id=org.id, user_id=admin.id, role=Role.ADMIN),
                EventMember(
                    org_id=org.id,
                    event_id=event.id,
                    user_id=coordinator.id,
                    role=Role.COORDINATOR,
                ),
                EventMember(
                    org_id=org.id, event_id=event.id, user_id=event_only.id, role=Role.ADMIN
                ),
            ]
        )
        await session.commit()

    built.org, built.event, built.sibling = org, event, sibling
    built.owner, built.admin = owner, admin
    built.coordinator, built.event_only = coordinator, event_only
    return built


async def _members(client: AsyncClient, world: World, headers: dict[str, str]) -> dict[str, dict]:
    response = await client.get(f"/v1/events/{world.event.id}/members", headers=headers)
    assert response.status_code == 200, response.text
    return {row["email"]: row for row in response.json()}


# ─────────────────────────── the organisation itself ───────────────────────────


async def test_the_owner_reads_and_renames_the_organisation(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    headers = await _sign_in(client, world.owner.email)

    read = await client.get(f"/v1/orgs/{world.org.id}", headers=headers)
    renamed = await client.patch(
        f"/v1/orgs/{world.org.id}", json={"name": "DevFlow Collective"}, headers=headers
    )

    assert read.status_code == 200
    assert read.json()["event_count"] == 2
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "DevFlow Collective"
    with tenancy_disabled():
        await session.refresh(world.org)
        assert world.org.name == "DevFlow Collective"
        assert world.org.slug.startswith("org-")  # the slug is identity, not a label


async def test_an_admin_reads_but_cannot_rename(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """The workspace's identity stays with its owner."""
    headers = await _sign_in(client, world.admin.email)

    read = await client.get(f"/v1/orgs/{world.org.id}", headers=headers)
    renamed = await client.patch(f"/v1/orgs/{world.org.id}", json={"name": "Nope"}, headers=headers)

    assert read.status_code == 200
    assert renamed.status_code == 403


async def test_an_event_only_member_cannot_reach_the_organisation(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    headers = await _sign_in(client, world.event_only.email)

    read = await client.get(f"/v1/orgs/{world.org.id}", headers=headers)

    assert read.status_code == 403


# ─────────────────────────── organisation members ───────────────────────────


async def _org_members(
    client: AsyncClient, world: World, headers: dict[str, str]
) -> dict[str, dict]:
    response = await client.get(f"/v1/orgs/{world.org.id}/members", headers=headers)
    assert response.status_code == 200, response.text
    return {row["email"]: row for row in response.json()}


async def test_the_list_is_org_members_only_and_counts_their_events(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    headers = await _sign_in(client, world.owner.email)

    rows = await _org_members(client, world, headers)

    assert set(rows) == {world.owner.email, world.admin.email}
    assert rows[world.admin.email]["events_covered"] == 2
    assert world.coordinator.email not in rows  # event-tier people are not org members


async def test_adding_someone_gives_them_every_event(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    headers = await _sign_in(client, world.owner.email)

    added = await client.post(
        f"/v1/orgs/{world.org.id}/members",
        json={
            "name": "Casey Reyes",
            "email": f"casey-{uuid.uuid4().hex[:6]}@example.com",
            "role": "coordinator",
        },
        headers=headers,
    )

    assert added.status_code == 201
    assert added.json()["events_covered"] == 2
    with tenancy_disabled():
        row = await session.scalar(
            select(OrgMember).where(
                OrgMember.org_id == world.org.id,
                OrgMember.user_id == uuid.UUID(added.json()["user_id"]),
            )
        )
    assert row is not None
    assert row.role is Role.COORDINATOR


async def test_an_existing_event_person_can_be_added_to_the_organisation(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """Their per-event row survives: it is an override, and an override of the
    same role is harmless."""
    headers = await _sign_in(client, world.owner.email)

    added = await client.post(
        f"/v1/orgs/{world.org.id}/members",
        json={"name": "Ignored", "email": world.event_only.email, "role": "admin"},
        headers=headers,
    )

    assert added.status_code == 201
    theirs = await _sign_in(client, world.event_only.email)
    sibling = await client.get(f"/v1/events/{world.sibling.id}", headers=theirs)
    assert sibling.status_code == 200


async def test_changing_an_org_members_role(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    headers = await _sign_in(client, world.owner.email)

    changed = await client.patch(
        f"/v1/orgs/{world.org.id}/members/{world.admin.id}",
        json={"role": "coordinator"},
        headers=headers,
    )

    assert changed.status_code == 200
    assert changed.json()["role"] == "coordinator"


async def test_removing_from_the_organisation_costs_every_event(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    headers = await _sign_in(client, world.owner.email)

    removed = await client.delete(
        f"/v1/orgs/{world.org.id}/members/{world.admin.id}", headers=headers
    )

    assert removed.status_code == 204
    theirs = await _sign_in(client, world.admin.email)
    gone = await client.get(f"/v1/events/{world.event.id}", headers=theirs)
    assert gone.status_code == 403


async def test_removal_leaves_per_event_overrides_standing(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """Two tiers, honestly: removal deletes the org row, not the events someone
    was individually added to. Removal is not a hidden mass-revocation."""
    headers = await _sign_in(client, world.owner.email)
    with tenancy_disabled():
        session.add(
            EventMember(
                org_id=world.org.id,
                event_id=world.event.id,
                user_id=world.admin.id,
                role=Role.REVIEWER,
            )
        )
        await session.commit()

    await client.delete(f"/v1/orgs/{world.org.id}/members/{world.admin.id}", headers=headers)

    theirs = await _sign_in(client, world.admin.email)
    kept = await client.get(f"/v1/events/{world.event.id}", headers=theirs)
    lost = await client.get(f"/v1/events/{world.sibling.id}", headers=theirs)
    assert kept.status_code == 200
    assert lost.status_code == 403


async def test_an_admin_may_add_org_members(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """One authority rule, not two. The escalation is lateral: OWNER stays
    ungrantable, and the added person gains the Directory and the org key."""
    headers = await _sign_in(client, world.admin.email)

    added = await client.post(
        f"/v1/orgs/{world.org.id}/members",
        json={"name": "Ignored", "email": world.coordinator.email, "role": "coordinator"},
        headers=headers,
    )

    assert added.status_code == 201


# ─────────────────────────── the guard matrix ───────────────────────────


async def test_the_owner_cannot_be_removed(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """Registration always makes the owner an org member and no path removes
    them, so the organisation can never reach zero members."""
    headers = await _sign_in(client, world.admin.email)

    removed = await client.delete(
        f"/v1/orgs/{world.org.id}/members/{world.owner.id}", headers=headers
    )

    assert removed.status_code == 409
    with tenancy_disabled():
        still = await session.scalar(
            select(OrgMember).where(
                OrgMember.org_id == world.org.id, OrgMember.user_id == world.owner.id
            )
        )
    assert still is not None


async def test_nobody_edits_their_own_org_membership(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    headers = await _sign_in(client, world.admin.email)

    changed = await client.patch(
        f"/v1/orgs/{world.org.id}/members/{world.admin.id}",
        json={"role": "reviewer"},
        headers=headers,
    )
    removed = await client.delete(
        f"/v1/orgs/{world.org.id}/members/{world.admin.id}", headers=headers
    )

    assert changed.status_code == 409
    assert removed.status_code == 409


async def test_a_coordinator_cannot_reach_org_membership(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    headers = await _sign_in(client, world.coordinator.email)

    listed = await client.get(f"/v1/orgs/{world.org.id}/members", headers=headers)

    assert listed.status_code == 403


async def test_ownership_is_not_grantable(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    headers = await _sign_in(client, world.owner.email)

    granted = await client.patch(
        f"/v1/orgs/{world.org.id}/members/{world.admin.id}",
        json={"role": "owner"},
        headers=headers,
    )

    assert granted.status_code == 422


# ────────────────── the event side: a marker, and nothing more ──────────────────


async def test_the_event_list_marks_which_tier_each_row_is(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """The event screen says who works here, including org members, and marks
    the rows whose decisions live elsewhere."""
    headers = await _sign_in(client, world.owner.email)

    response = await client.get(f"/v1/events/{world.event.id}/members", headers=headers)
    rows = {row["email"]: row for row in response.json()}

    assert rows[world.admin.email]["scope"] == "org"
    assert rows[world.coordinator.email]["scope"] == "event"


async def test_no_org_tier_write_is_reachable_from_an_event_route(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """The separation, asserted rather than reviewed: a later edit that quietly
    re-merges the tiers fails here."""
    headers = await _sign_in(client, world.owner.email)

    merged = await client.patch(
        f"/v1/events/{world.event.id}/members/{world.event_only.id}",
        json={"scope": "org"},
        headers=headers,
    )

    assert merged.status_code == 422


# ─────────────────────── the reason this spec exists ───────────────────────


async def test_joining_the_organisation_unlocks_an_org_scoped_surface(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """An event-only admin is refused by the org key today. Adding them to the
    organisation is the fix, and this is the assertion that proves it."""
    theirs = await _sign_in(client, world.event_only.email)
    before = await client.get(f"/v1/orgs/{world.org.id}/ai-key", headers=theirs)

    owner = await _sign_in(client, world.owner.email)
    await client.post(
        f"/v1/orgs/{world.org.id}/members",
        json={"name": "Ignored", "email": world.event_only.email, "role": "admin"},
        headers=owner,
    )
    after = await client.get(f"/v1/orgs/{world.org.id}/ai-key", headers=theirs)

    assert before.status_code == 403
    assert after.status_code == 200
