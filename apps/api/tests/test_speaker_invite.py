"""Inviting a speaker into the portal, and setting their photo from the console.

Both existed only from the speaker's side. Portal access was something that
happened *to* a speaker — a link fell out of an acceptance email — so an
organiser asking "have you got in yet?" had no control to press, and a speaker
who emailed their headshot could not be helped at all.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.tenancy import tenancy_disabled
from app.models import (
    Event,
    EventSpeaker,
    EventStatus,
    MagicLink,
    Message,
    Organization,
    OrgMember,
    Role,
    Speaker,
    SpeakerStatus,
    User,
)

PASSWORD = "correct horse battery staple"

#: A 1x1 PNG. Small enough to inline, real enough that the upload check passes.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000a49444154789c6360000002000100ffff0300000600"
    "0557bfabd40000000049454e44ae426082"
)


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
            status=EventStatus.IN_REVIEW,
            cfp_closes_at=datetime.now(UTC) + timedelta(days=1),
        )
        session.add(event)
        await session.flush()
        owner = User(
            email=f"owner-{suffix}@example.com",
            name="Owner",
            password_hash=hash_password(PASSWORD),
            email_verified_at=datetime.now(UTC),
        )
        session.add(owner)
        await session.flush()
        session.add(OrgMember(org_id=org.id, user_id=owner.id, role=Role.OWNER))

        links = {}
        for label, status in (
            ("keen", SpeakerStatus.ACCEPTED),
            ("gone", SpeakerStatus.WITHDRAWN),
        ):
            person = Speaker(
                org_id=org.id,
                email=f"{label}-{suffix}@conference.test",
                name=f"{label.title()} One",
            )
            session.add(person)
            await session.flush()
            link = EventSpeaker(
                org_id=org.id, event_id=event.id, speaker_id=person.id, status=status
            )
            session.add(link)
            await session.flush()
            links[label] = link.id
        await session.commit()

    login = await client.post("/v1/auth/login", json={"email": owner.email, "password": PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    return headers, event, links


async def test_inviting_a_speaker_issues_a_link_and_records_the_send(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers, event, links = await _world(client, session)

    response = await client.post(
        f"/v1/events/{event.id}/speakers/invite",
        json={"event_speaker_ids": [str(links["keen"])]},
        headers=headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["invited"] == 1

    with tenancy_disabled():
        issued = (
            (await session.execute(select(MagicLink).where(MagicLink.event_id == event.id)))
            .scalars()
            .all()
        )
        # `purpose` lives on the template, not the row, so the outbox is
        # identified by who it went to.
        sent = (
            (await session.execute(select(Message).where(Message.event_id == event.id)))
            .scalars()
            .all()
        )
    assert len(issued) == 1
    assert len(sent) == 1, "the invite has to be visible in the outbox, not just sent"
    assert sent[0].subject == f"Your sign-in link for {event.name}"


async def test_a_withdrawn_speaker_is_skipped_and_named(
    client: AsyncClient, session: AsyncSession
) -> None:
    """A portal full of tasks for a talk they pulled out of is worse than no
    invite. "1 skipped" would not tell the organiser who."""
    headers, event, links = await _world(client, session)

    response = await client.post(
        f"/v1/events/{event.id}/speakers/invite",
        json={"event_speaker_ids": [str(links["keen"]), str(links["gone"])]},
        headers=headers,
    )

    body = response.json()
    assert body["invited"] == 1
    assert body["skipped"] == 1
    assert body["skipped_names"] == ["Gone One"]


async def test_inviting_twice_sends_twice(client: AsyncClient, session: AsyncSession) -> None:
    """Deliberately not deduplicated. A link expires in thirty minutes and losing
    one is the ordinary case; silently doing nothing on the second press is how
    an organiser concludes the button is broken."""
    headers, event, links = await _world(client, session)

    for _ in range(2):
        await client.post(
            f"/v1/events/{event.id}/speakers/invite",
            json={"event_speaker_ids": [str(links["keen"])]},
            headers=headers,
        )

    with tenancy_disabled():
        issued = (
            (await session.execute(select(MagicLink).where(MagicLink.event_id == event.id)))
            .scalars()
            .all()
        )
    assert len(issued) == 2


async def test_an_organiser_can_set_a_speakers_headshot(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers, event, links = await _world(client, session)

    response = await client.post(
        f"/v1/events/{event.id}/speakers/{links['keen']}/headshot",
        files={"file": ("face.png", PNG, "image/png")},
        headers=headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["headshot_file_id"] is not None

    roster = await client.get(f"/v1/events/{event.id}/speakers", headers=headers)
    keen = next(r for r in roster.json() if r["id"] == str(links["keen"]))
    assert keen["headshot_file_id"] == response.json()["headshot_file_id"], (
        "the photo has to survive the round trip, not just the response"
    )


async def test_replacing_a_headshot_keeps_the_version_group(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Nothing is ever overwritten here — a replacement is version + 1 in the same
    group, so the photo the speaker sent is still recoverable."""
    headers, event, links = await _world(client, session)

    first = await client.post(
        f"/v1/events/{event.id}/speakers/{links['keen']}/headshot",
        files={"file": ("face.png", PNG, "image/png")},
        headers=headers,
    )
    second = await client.post(
        f"/v1/events/{event.id}/speakers/{links['keen']}/headshot",
        files={"file": ("better.png", PNG, "image/png")},
        headers=headers,
    )

    assert first.json()["headshot_file_id"] != second.json()["headshot_file_id"]

    from app.models.file import File as FileRecord

    # Scoped to this event: other tests in this module upload their own photos,
    # and a table-wide count would be measuring them.
    with tenancy_disabled():
        rows = (
            (await session.execute(select(FileRecord).where(FileRecord.event_id == event.id)))
            .scalars()
            .all()
        )
    groups = {row.version_group_id for row in rows}
    assert len(groups) == 1, "a replacement started a new version group"
    assert sorted(row.version for row in rows) == [1, 2]


async def test_a_reviewer_cannot_invite_anyone(client: AsyncClient, session: AsyncSession) -> None:
    _, event, links = await _world(client, session)
    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        reviewer = User(
            email=f"rev-{suffix}@example.com",
            name="Reviewer",
            password_hash=hash_password(PASSWORD),
            email_verified_at=datetime.now(UTC),
        )
        session.add(reviewer)
        await session.flush()
        loaded = await session.get(Event, event.id)
        assert loaded is not None
        session.add(OrgMember(org_id=loaded.org_id, user_id=reviewer.id, role=Role.REVIEWER))
        await session.commit()

    login = await client.post(
        "/v1/auth/login", json={"email": reviewer.email, "password": PASSWORD}
    )
    response = await client.post(
        f"/v1/events/{event.id}/speakers/invite",
        json={"event_speaker_ids": [str(links["keen"])]},
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    )

    assert response.status_code == 403
