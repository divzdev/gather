"""Adversarial probes at spec 0004's seam 1 (test-adversary, not the author).

Everything here is observed through the same HTTP seam the spec agreed. It
attacks what `test_membership_scope.py` asserts happily: another organisation,
a target who is not a member, a deactivated account, a replayed POST, an
organisation with no events, and a person who holds both an org row and an
event row at once.
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


async def _person(
    session: AsyncSession,
    label: str,
    *,
    verified: bool = True,
    active: bool = True,
) -> User:
    tag = uuid.uuid4().hex[:8]
    user = User(
        email=f"{label}-{tag}@example.com",
        name=f"{label.title()} {tag[:4]}",
        password_hash=hash_password(PASSWORD),
        email_verified_at=datetime.now(UTC) if verified else None,
        is_active=active,
    )
    session.add(user)
    await session.flush()
    return user


def _event(org_id: uuid.UUID, name: str) -> Event:
    tag = uuid.uuid4().hex[:8]
    return Event(
        org_id=org_id,
        name=name,
        slug=f"{name.lower().replace(' ', '-')}-{tag}",
        timezone="UTC",
        starts_on=date(2027, 5, 12),
        ends_on=date(2027, 5, 14),
        status=EventStatus.CFP_OPEN,
        cfp_closes_at=datetime.now(UTC) + timedelta(days=30),
    )


class Org:
    """An organisation, its owner, and however many events it was built with."""

    def __init__(self, org: Organization, owner: User, events: list[Event]) -> None:
        self.org, self.owner, self.events = org, owner, events


async def _org_with(session: AsyncSession, *, event_count: int) -> Org:
    tag = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        org = Organization(name=f"Org {tag}", slug=f"org-{tag}")
        session.add(org)
        await session.flush()
        events = [_event(org.id, f"Conf {i} {tag}") for i in range(event_count)]
        session.add_all(events)
        owner = await _person(session, "owner")
        session.add(OrgMember(org_id=org.id, user_id=owner.id, role=Role.OWNER))
        await session.commit()
    return Org(org, owner, events)


@pytest.fixture
async def home(client: AsyncClient, session: AsyncSession) -> Org:
    return await _org_with(session, event_count=2)


@pytest.fixture
async def foreign(client: AsyncClient, session: AsyncSession) -> Org:
    """A second organisation the first one must not be able to touch."""
    other = await _org_with(session, event_count=1)
    with tenancy_disabled():
        member = await _person(session, "theirs")
        session.add(OrgMember(org_id=other.org.id, user_id=member.id, role=Role.ADMIN))
        await session.commit()
    other.member = member  # type: ignore[attr-defined]
    return other


# ──────────────────────────── cross-tenant reach ────────────────────────────


async def test_an_owner_cannot_read_or_rename_another_organisation(
    client: AsyncClient, session: AsyncSession, home: Org, foreign: Org
) -> None:
    headers = await _sign_in(client, home.owner.email)

    read = await client.get(f"/v1/orgs/{foreign.org.id}", headers=headers)
    renamed = await client.patch(
        f"/v1/orgs/{foreign.org.id}", json={"name": "Mine now"}, headers=headers
    )

    assert read.status_code == 403, read.text
    assert renamed.status_code == 403, renamed.text
    with tenancy_disabled():
        await session.refresh(foreign.org)
        assert foreign.org.name.startswith("Org ")


async def test_an_owner_cannot_list_or_write_another_organisations_members(
    client: AsyncClient, session: AsyncSession, home: Org, foreign: Org
) -> None:
    headers = await _sign_in(client, home.owner.email)
    victim = foreign.member  # type: ignore[attr-defined]

    listed = await client.get(f"/v1/orgs/{foreign.org.id}/members", headers=headers)
    added = await client.post(
        f"/v1/orgs/{foreign.org.id}/members",
        json={
            "name": "Intruder",
            "email": f"intruder-{uuid.uuid4().hex[:6]}@example.com",
            "role": "admin",
        },
        headers=headers,
    )
    changed = await client.patch(
        f"/v1/orgs/{foreign.org.id}/members/{victim.id}", json={"role": "reviewer"}, headers=headers
    )
    removed = await client.delete(f"/v1/orgs/{foreign.org.id}/members/{victim.id}", headers=headers)

    assert [listed.status_code, added.status_code, changed.status_code, removed.status_code] == [
        403,
        403,
        403,
        403,
    ]
    with tenancy_disabled():
        still = await session.scalar(
            select(OrgMember).where(
                OrgMember.org_id == foreign.org.id, OrgMember.user_id == victim.id
            )
        )
    assert still is not None and still.role is Role.ADMIN


async def test_a_members_url_cannot_borrow_a_foreign_user_id(
    client: AsyncClient, session: AsyncSession, home: Org, foreign: Org
) -> None:
    """Own organisation in the path, someone else's member in it: not found,
    never a write."""
    headers = await _sign_in(client, home.owner.email)
    victim = foreign.member  # type: ignore[attr-defined]

    changed = await client.patch(
        f"/v1/orgs/{home.org.id}/members/{victim.id}", json={"role": "reviewer"}, headers=headers
    )
    removed = await client.delete(f"/v1/orgs/{home.org.id}/members/{victim.id}", headers=headers)

    assert changed.status_code == 404, changed.text
    assert removed.status_code == 404, removed.text
    with tenancy_disabled():
        untouched = await session.scalar(
            select(OrgMember).where(
                OrgMember.org_id == foreign.org.id, OrgMember.user_id == victim.id
            )
        )
    assert untouched is not None and untouched.role is Role.ADMIN


# ─────────────────────────── events_covered ───────────────────────────


async def test_an_organisation_with_no_events_covers_zero(
    client: AsyncClient, session: AsyncSession
) -> None:
    empty = await _org_with(session, event_count=0)
    headers = await _sign_in(client, empty.owner.email)

    read = await client.get(f"/v1/orgs/{empty.org.id}", headers=headers)
    members = await client.get(f"/v1/orgs/{empty.org.id}/members", headers=headers)

    assert read.json()["event_count"] == 0
    assert [row["events_covered"] for row in members.json()] == [0]


async def test_a_new_event_widens_what_every_event_means(
    client: AsyncClient, session: AsyncSession, home: Org
) -> None:
    """Story 5: someone added today works on an event created next month."""
    headers = await _sign_in(client, home.owner.email)
    before = await client.get(f"/v1/orgs/{home.org.id}", headers=headers)

    with tenancy_disabled():
        session.add(_event(home.org.id, "Next Month"))
        await session.commit()

    after = await client.get(f"/v1/orgs/{home.org.id}", headers=headers)

    assert before.json()["event_count"] == 2
    assert after.json()["event_count"] == 3


async def test_events_covered_counts_only_this_organisations_events(
    client: AsyncClient, session: AsyncSession, home: Org, foreign: Org
) -> None:
    headers = await _sign_in(client, home.owner.email)

    read = await client.get(f"/v1/orgs/{home.org.id}", headers=headers)

    # `foreign` has one event of its own; a cross-org count would read 3.
    assert read.json()["event_count"] == 2


# ─────────────────────────── the guard matrix's gaps ───────────────────────────


async def test_a_stranger_cannot_be_changed_or_removed(
    client: AsyncClient, session: AsyncSession, home: Org
) -> None:
    headers = await _sign_in(client, home.owner.email)
    with tenancy_disabled():
        stranger = await _person(session, "stranger")
        await session.commit()

    changed = await client.patch(
        f"/v1/orgs/{home.org.id}/members/{stranger.id}", json={"role": "admin"}, headers=headers
    )
    removed = await client.delete(f"/v1/orgs/{home.org.id}/members/{stranger.id}", headers=headers)
    ghost = await client.delete(f"/v1/orgs/{home.org.id}/members/{uuid.uuid4()}", headers=headers)

    assert [changed.status_code, removed.status_code, ghost.status_code] == [404, 404, 404]


async def test_a_deactivated_account_cannot_be_added(
    client: AsyncClient, session: AsyncSession, home: Org
) -> None:
    headers = await _sign_in(client, home.owner.email)
    with tenancy_disabled():
        gone = await _person(session, "deactivated", active=False)
        await session.commit()

    added = await client.post(
        f"/v1/orgs/{home.org.id}/members",
        json={"name": "Ignored", "email": gone.email, "role": "admin"},
        headers=headers,
    )

    assert added.status_code == 409, added.text
    with tenancy_disabled():
        row = await session.scalar(
            select(OrgMember).where(OrgMember.org_id == home.org.id, OrgMember.user_id == gone.id)
        )
    assert row is None


async def test_owner_cannot_be_granted_on_the_way_in(
    client: AsyncClient, session: AsyncSession, home: Org
) -> None:
    headers = await _sign_in(client, home.owner.email)
    email = f"aspirant-{uuid.uuid4().hex[:6]}@example.com"

    added = await client.post(
        f"/v1/orgs/{home.org.id}/members",
        json={"name": "Aspirant", "email": email, "role": "owner"},
        headers=headers,
    )

    assert added.status_code == 422, added.text
    with tenancy_disabled():
        user = await session.scalar(select(User).where(User.email == email))
    assert user is None, "a refused add must not leave a user behind"


async def test_a_coordinator_cannot_write_org_membership(
    client: AsyncClient, session: AsyncSession, home: Org
) -> None:
    with tenancy_disabled():
        coordinator = await _person(session, "coordinator")
        session.add(OrgMember(org_id=home.org.id, user_id=coordinator.id, role=Role.COORDINATOR))
        target = await _person(session, "target")
        session.add(OrgMember(org_id=home.org.id, user_id=target.id, role=Role.REVIEWER))
        await session.commit()
    headers = await _sign_in(client, coordinator.email)

    added = await client.post(
        f"/v1/orgs/{home.org.id}/members",
        json={"name": "X", "email": f"x-{uuid.uuid4().hex[:6]}@example.com", "role": "reviewer"},
        headers=headers,
    )
    changed = await client.patch(
        f"/v1/orgs/{home.org.id}/members/{target.id}", json={"role": "admin"}, headers=headers
    )
    removed = await client.delete(f"/v1/orgs/{home.org.id}/members/{target.id}", headers=headers)

    assert [added.status_code, changed.status_code, removed.status_code] == [403, 403, 403]


# ─────────────────────────── replay and repetition ───────────────────────────


async def test_adding_the_same_person_twice_is_refused_not_duplicated(
    client: AsyncClient, session: AsyncSession, home: Org
) -> None:
    headers = await _sign_in(client, home.owner.email)
    email = f"twice-{uuid.uuid4().hex[:6]}@example.com"
    body = {"name": "Twice Over", "email": email, "role": "coordinator"}

    first = await client.post(f"/v1/orgs/{home.org.id}/members", json=body, headers=headers)
    second = await client.post(f"/v1/orgs/{home.org.id}/members", json=body, headers=headers)

    assert first.status_code == 201, first.text
    assert second.status_code == 409, second.text
    with tenancy_disabled():
        rows = (
            await session.execute(
                select(OrgMember)
                .join(User, User.id == OrgMember.user_id)
                .where(OrgMember.org_id == home.org.id, User.email == email)
            )
        ).all()
    assert len(rows) == 1


async def test_a_replayed_add_does_not_add_twice(
    client: AsyncClient, session: AsyncSession, home: Org
) -> None:
    """The retry a flaky network produces: same Idempotency-Key, same body."""
    headers = await _sign_in(client, home.owner.email)
    headers["Idempotency-Key"] = str(uuid.uuid4())
    email = f"replay-{uuid.uuid4().hex[:6]}@example.com"
    body = {"name": "Replay Case", "email": email, "role": "reviewer"}

    first = await client.post(f"/v1/orgs/{home.org.id}/members", json=body, headers=headers)
    replay = await client.post(f"/v1/orgs/{home.org.id}/members", json=body, headers=headers)

    assert first.status_code == 201, first.text
    assert replay.status_code == 201, replay.text
    assert replay.json() == first.json()
    with tenancy_disabled():
        rows = (
            await session.execute(
                select(OrgMember)
                .join(User, User.id == OrgMember.user_id)
                .where(OrgMember.org_id == home.org.id, User.email == email)
            )
        ).all()
    assert len(rows) == 1


# ─────────────────────────── the name itself ───────────────────────────


@pytest.mark.parametrize("name", ["", "   ", "\t\n ", "x" * 201])
async def test_a_workspace_cannot_be_renamed_to_nothing(
    client: AsyncClient, session: AsyncSession, home: Org, name: str
) -> None:
    """The header prints this string on every screen. Blank is not a name, and
    `min_length` runs before the handler's `.strip()`."""
    headers = await _sign_in(client, home.owner.email)

    renamed = await client.patch(f"/v1/orgs/{home.org.id}", json={"name": name}, headers=headers)

    assert renamed.status_code == 422, f"accepted {name!r} -> {renamed.text}"
    with tenancy_disabled():
        await session.refresh(home.org)
        assert home.org.name.startswith("Org ")


async def test_a_unicode_name_survives_the_round_trip(
    client: AsyncClient, session: AsyncSession, home: Org
) -> None:
    headers = await _sign_in(client, home.org and home.owner.email)
    name = "Konferencja Współpracy 🎤 東京"

    renamed = await client.patch(f"/v1/orgs/{home.org.id}", json={"name": name}, headers=headers)
    read = await client.get(f"/v1/orgs/{home.org.id}", headers=headers)

    assert renamed.status_code == 200, renamed.text
    assert read.json()["name"] == name


# ─────────────────────── both tiers at once, and separation ───────────────────────


async def test_an_event_row_wins_the_scope_marker_over_an_org_row(
    client: AsyncClient, session: AsyncSession, home: Org
) -> None:
    """Someone holding both rows works here on the event's terms: the override
    is what applies, so the row must not read *Every event*."""
    headers = await _sign_in(client, home.owner.email)
    event = home.events[0]
    with tenancy_disabled():
        both = await _person(session, "both")
        session.add_all(
            [
                OrgMember(org_id=home.org.id, user_id=both.id, role=Role.ADMIN),
                EventMember(
                    org_id=home.org.id, event_id=event.id, user_id=both.id, role=Role.REVIEWER
                ),
            ]
        )
        await session.commit()

    listed = await client.get(f"/v1/events/{event.id}/members", headers=headers)
    row = next(r for r in listed.json() if r["email"] == both.email)

    assert row["scope"] == "event"
    assert row["role"] == "reviewer"
    # And exactly once — the union must not print them twice.
    assert sum(1 for r in listed.json() if r["email"] == both.email) == 1


async def test_removing_from_the_organisation_leaves_the_event_row_in_the_database(
    client: AsyncClient, session: AsyncSession, home: Org
) -> None:
    headers = await _sign_in(client, home.owner.email)
    event = home.events[0]
    with tenancy_disabled():
        both = await _person(session, "both")
        session.add_all(
            [
                OrgMember(org_id=home.org.id, user_id=both.id, role=Role.ADMIN),
                EventMember(
                    org_id=home.org.id, event_id=event.id, user_id=both.id, role=Role.REVIEWER
                ),
            ]
        )
        await session.commit()

    removed = await client.delete(f"/v1/orgs/{home.org.id}/members/{both.id}", headers=headers)

    assert removed.status_code == 204, removed.text
    with tenancy_disabled():
        org_row = await session.scalar(
            select(OrgMember).where(OrgMember.org_id == home.org.id, OrgMember.user_id == both.id)
        )
        event_row = await session.scalar(
            select(EventMember).where(
                EventMember.event_id == event.id, EventMember.user_id == both.id
            )
        )
    assert org_row is None
    assert event_row is not None and event_row.role is Role.REVIEWER


async def test_an_event_route_cannot_remove_an_organisation_member(
    client: AsyncClient, session: AsyncSession, home: Org
) -> None:
    """The separation in the direction the `extra="forbid"` canary cannot see:
    a real event-route write aimed at an org row."""
    headers = await _sign_in(client, home.owner.email)
    event = home.events[0]
    with tenancy_disabled():
        org_wide = await _person(session, "orgwide")
        session.add(OrgMember(org_id=home.org.id, user_id=org_wide.id, role=Role.ADMIN))
        await session.commit()

    removed = await client.delete(f"/v1/events/{event.id}/members/{org_wide.id}", headers=headers)

    assert removed.status_code in (403, 404, 409), removed.text
    with tenancy_disabled():
        still = await session.scalar(
            select(OrgMember).where(
                OrgMember.org_id == home.org.id, OrgMember.user_id == org_wide.id
            )
        )
    assert still is not None, "an event route must not delete an org membership"
