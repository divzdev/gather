"""Templates with merge fields, and the preview that proves they resolve.

`MessageTemplate` sat in the schema from the first migration with no route
touching it, so writing to eighty speakers meant writing eighty times. The
preview matters as much as the template: finding out the merge field is wrong
before eighty people do is the whole point of looking first.
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
    EventSpeaker,
    EventStatus,
    Organization,
    OrgMember,
    Role,
    Session,
    SessionSpeaker,
    Speaker,
    SpeakerStatus,
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
            name="Owner",
            password_hash=hash_password(PASSWORD),
            email_verified_at=datetime.now(UTC),
        )
        session.add(owner)
        await session.flush()
        session.add(OrgMember(org_id=org.id, user_id=owner.id, role=Role.OWNER))

        # Two speakers on purpose: one with a session and one without, because
        # the second is where a naive resolver prints "None".
        priya = Speaker(org_id=org.id, email=f"priya-{suffix}@conf.test", name="Priya Raman")
        marcus = Speaker(org_id=org.id, email=f"marcus-{suffix}@conf.test", name="Marcus Okafor")
        session.add_all([priya, marcus])
        await session.flush()
        for person in (priya, marcus):
            session.add(
                EventSpeaker(
                    org_id=org.id,
                    event_id=event.id,
                    speaker_id=person.id,
                    status=SpeakerStatus.ACCEPTED,
                )
            )
        talk = Session(
            org_id=org.id,
            event_id=event.id,
            title="Taming 40-Minute CI",
            slug=f"ci-{suffix}",
            duration_minutes=30,
        )
        session.add(talk)
        await session.flush()
        session.add(
            SessionSpeaker(
                org_id=org.id, event_id=event.id, session_id=talk.id, speaker_id=priya.id
            )
        )
        await session.commit()

    login = await client.post("/v1/auth/login", json={"email": owner.email, "password": PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    return headers, event, priya, marcus


BODY = (
    "Hi {{speaker_first_name}},\n\n"
    "Your talk {{session_title}} is confirmed for {{event_name}}. "
    "Everything else lives in your portal: {{portal_link}}"
)


async def test_a_template_previews_against_a_real_speaker(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers, event, priya, _ = await _world(client, session)

    created = await client.post(
        f"/v1/events/{event.id}/message-templates",
        json={
            "name": "Acceptance",
            "subject": "You are on at {{event_name}}",
            "body_markdown": BODY,
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text

    preview = await client.get(
        f"/v1/events/{event.id}/message-templates/{created.json()['id']}/preview",
        params={"speaker_id": str(priya.id)},
        headers=headers,
    )

    body = preview.json()
    assert body["speaker_name"] == "Priya Raman"
    assert body["subject"] == "You are on at DevFlow Conf 2027"
    assert body["body"].startswith("Hi Priya,")
    assert "Taming 40-Minute CI" in body["body"]
    assert "{{" not in body["body"], "a token survived the resolver"


async def test_a_speaker_with_no_session_reads_as_a_sentence_not_as_none(
    client: AsyncClient, session: AsyncSession
) -> None:
    """The case a preview against a made-up example would never surface."""
    headers, event, _, marcus = await _world(client, session)
    created = await client.post(
        f"/v1/events/{event.id}/message-templates",
        json={"name": "Acceptance", "subject": "Hello", "body_markdown": BODY},
        headers=headers,
    )

    preview = await client.get(
        f"/v1/events/{event.id}/message-templates/{created.json()['id']}/preview",
        params={"speaker_id": str(marcus.id)},
        headers=headers,
    )

    assert "your session" in preview.json()["body"]
    assert "None" not in preview.json()["body"]


async def test_a_misspelled_merge_field_is_refused_at_write_time(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Not at send time, and not silently. An email that says
    `Dear {{speaker_naem}}` has already been sent by the time anyone notices."""
    headers, event, _, _ = await _world(client, session)

    response = await client.post(
        f"/v1/events/{event.id}/message-templates",
        json={"name": "Typo", "subject": "Hi", "body_markdown": "Dear {{speaker_naem}},"},
        headers=headers,
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "UNKNOWN_MERGE_FIELD"
    assert "speaker_naem" in response.json()["error"]["message"]


async def test_the_merge_field_list_matches_what_the_resolver_knows(
    client: AsyncClient, session: AsyncSession
) -> None:
    """The composer reads this list. If it drifted from the resolver it would
    offer tokens that render as themselves."""
    from app.features.messaging.templates import MERGE_FIELDS

    headers, event, _, _ = await _world(client, session)

    listed = await client.get(
        f"/v1/events/{event.id}/message-templates/merge-fields", headers=headers
    )

    tokens = {row["token"] for row in listed.json()}
    assert tokens == {f"{{{{{name}}}}}" for name in MERGE_FIELDS}


async def test_editing_a_template_is_checked_too(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers, event, _, _ = await _world(client, session)
    created = await client.post(
        f"/v1/events/{event.id}/message-templates",
        json={"name": "Fine", "subject": "Hi", "body_markdown": "Dear {{speaker_name}},"},
        headers=headers,
    )

    response = await client.patch(
        f"/v1/events/{event.id}/message-templates/{created.json()['id']}",
        json={"name": "Fine", "subject": "Hi", "body_markdown": "Dear {{nonsense}},"},
        headers=headers,
    )

    assert response.status_code == 422


async def test_a_coordinator_can_read_templates_but_not_write_them(
    client: AsyncClient, session: AsyncSession
) -> None:
    _, event, _, _ = await _world(client, session)
    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        loaded = await session.get(Event, event.id)
        assert loaded is not None
        coordinator = User(
            email=f"coord-{suffix}@example.com",
            name="Coordinator",
            password_hash=hash_password(PASSWORD),
            email_verified_at=datetime.now(UTC),
        )
        session.add(coordinator)
        await session.flush()
        session.add(OrgMember(org_id=loaded.org_id, user_id=coordinator.id, role=Role.COORDINATOR))
        await session.commit()
    login = await client.post(
        "/v1/auth/login", json={"email": coordinator.email, "password": PASSWORD}
    )
    theirs = {"Authorization": f"Bearer {login.json()['access_token']}"}

    assert (
        await client.get(f"/v1/events/{event.id}/message-templates", headers=theirs)
    ).status_code == 200
    assert (
        await client.post(
            f"/v1/events/{event.id}/message-templates",
            json={"name": "No", "subject": "No", "body_markdown": "No"},
            headers=theirs,
        )
    ).status_code == 403
