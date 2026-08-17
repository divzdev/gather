"""A session's content has an author and a previous value.

`ActivityLog` has recorded before/after diffs since the first migration and
nothing ever read it, so a title that changed under an organiser had neither.
This is a history of one session's wording — deliberately not the audit-log
browser the non-goals rule out.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.tenancy import tenancy_disabled
from app.models import (
    Event,
    EventStatus,
    Organization,
    OrgMember,
    Role,
    Session,
    User,
)

PASSWORD = "correct horse battery staple"


async def _world(client: AsyncClient, session: AsyncSession):
    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        org = Organization(name=f"Org {suffix}", slug=f"org-{suffix}")
        session.add(org)
        await session.flush()
        event = Event(
            org_id=org.id,
            name="DevFlow Conf 2027",
            slug=f"devflow-{suffix}",
            timezone="UTC",
            starts_on=datetime(2027, 5, 12).date(),
            ends_on=datetime(2027, 5, 14).date(),
            status=EventStatus.SCHEDULED,
            cfp_closes_at=datetime.now(UTC) + timedelta(days=1),
        )
        session.add(event)
        await session.flush()
        owner = User(
            email=f"owner-{suffix}@example.com",
            name="Jordan Alvarez",
            password_hash=hash_password(PASSWORD),
            email_verified_at=datetime.now(UTC),
        )
        session.add(owner)
        await session.flush()
        session.add(OrgMember(org_id=org.id, user_id=owner.id, role=Role.OWNER))
        talk = Session(
            org_id=org.id,
            event_id=event.id,
            title="The original title",
            abstract="The original abstract.",
            slug=f"talk-{suffix}",
            duration_minutes=30,
        )
        session.add(talk)
        await session.commit()

    login = await client.post("/v1/auth/login", json={"email": owner.email, "password": PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    return headers, event, talk


async def test_two_edits_appear_as_two_attributed_entries(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers, event, talk = await _world(client, session)

    for title in ("The second title", "The third title"):
        await client.patch(
            f"/v1/events/{event.id}/sessions/{talk.id}",
            json={"title": title},
            headers=headers,
        )

    history = await client.get(f"/v1/events/{event.id}/sessions/{talk.id}/history", headers=headers)

    assert history.status_code == 200, history.text
    entries = history.json()
    assert len(entries) == 2
    assert all(entry["actor_name"] == "Jordan Alvarez" for entry in entries)
    # Newest first, and each one holds what it replaced.
    assert entries[0]["before"]["title"] == "The second title"
    assert entries[0]["after"]["title"] == "The third title"
    assert entries[1]["before"]["title"] == "The original title"


async def test_an_edit_that_changes_nothing_records_nothing(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Saving a form without touching it is not a change, and a history full of
    them is a history nobody reads."""
    headers, event, talk = await _world(client, session)

    await client.patch(
        f"/v1/events/{event.id}/sessions/{talk.id}",
        json={"title": "The original title"},
        headers=headers,
    )

    history = await client.get(f"/v1/events/{event.id}/sessions/{talk.id}/history", headers=headers)
    assert history.json() == []


async def test_moving_a_session_is_not_a_content_change(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Placement moves a dozen times a day and is already visible on the grid.
    A content history that logged every drag would bury the one title change."""
    headers, event, talk = await _world(client, session)

    await client.patch(
        f"/v1/events/{event.id}/sessions/{talk.id}",
        json={"duration_minutes": 45},
        headers=headers,
    )

    history = await client.get(f"/v1/events/{event.id}/sessions/{talk.id}/history", headers=headers)
    assert history.json() == []


async def test_restoring_puts_back_exactly_what_that_edit_replaced(
    client: AsyncClient, session: AsyncSession
) -> None:
    """The rubric's case: two edits, restore the second, and the first survives."""
    headers, event, talk = await _world(client, session)

    await client.patch(
        f"/v1/events/{event.id}/sessions/{talk.id}",
        json={"abstract": "First edit added this sentence."},
        headers=headers,
    )
    await client.patch(
        f"/v1/events/{event.id}/sessions/{talk.id}",
        json={"abstract": "First edit added this sentence. Second edit added this one."},
        headers=headers,
    )

    history = (
        await client.get(f"/v1/events/{event.id}/sessions/{talk.id}/history", headers=headers)
    ).json()
    newest = history[0]["id"]

    restored = await client.post(
        f"/v1/events/{event.id}/sessions/{talk.id}/restore",
        json={"entry_id": newest},
        headers=headers,
    )

    assert restored.status_code == 200, restored.text
    listing = await client.get(f"/v1/events/{event.id}/sessions", headers=headers)
    current = next(row for row in listing.json() if row["id"] == str(talk.id))
    assert current["abstract"] == "First edit added this sentence."


async def test_restoring_is_itself_recorded_so_it_can_be_undone(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Nothing is rewound. The same reason files are versioned rather than
    overwritten: an undo you cannot undo is a second way to lose the text."""
    headers, event, talk = await _world(client, session)

    await client.patch(
        f"/v1/events/{event.id}/sessions/{talk.id}",
        json={"title": "The second title"},
        headers=headers,
    )
    history = (
        await client.get(f"/v1/events/{event.id}/sessions/{talk.id}/history", headers=headers)
    ).json()
    await client.post(
        f"/v1/events/{event.id}/sessions/{talk.id}/restore",
        json={"entry_id": history[0]["id"]},
        headers=headers,
    )

    after = (
        await client.get(f"/v1/events/{event.id}/sessions/{talk.id}/history", headers=headers)
    ).json()

    assert len(after) == 2, "the restore left no trace of itself"
    assert after[0]["after"]["title"] == "The original title"
    assert after[0]["before"]["title"] == "The second title"


async def test_a_change_belonging_to_another_session_cannot_be_restored_onto_this_one(
    client: AsyncClient, session: AsyncSession
) -> None:
    """A log id is untrusted input however it got into the request."""
    headers, event, talk = await _world(client, session)
    other = await client.post(
        f"/v1/events/{event.id}/sessions",
        json={"title": "A different talk", "duration_minutes": 30},
        headers=headers,
    )
    other_id = other.json()["id"]
    await client.patch(
        f"/v1/events/{event.id}/sessions/{other_id}",
        json={"title": "A different talk, renamed"},
        headers=headers,
    )
    stolen = (
        await client.get(f"/v1/events/{event.id}/sessions/{other_id}/history", headers=headers)
    ).json()[0]["id"]

    response = await client.post(
        f"/v1/events/{event.id}/sessions/{talk.id}/restore",
        json={"entry_id": stolen},
        headers=headers,
    )

    assert response.status_code == 404
