"""The cross-event speaker directory.

The property under test throughout: this view spans events on purpose, while the
per-event roster does not. Both have to stay true at once.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import tenancy_disabled
from app.models import (
    Event,
    EventSpeaker,
    EventStatus,
    Form,
    Message,
    Speaker,
    SpeakerStatus,
)

# The event-with-an-open-CFP fixture, reused rather than rebuilt.
from test_cfp_flow import cfp  # noqa: F401

CSV = (
    "name,email,company,tags\n"
    "Rosa Lindqvist,rosa@northbound.example,Northbound Systems,keynote;infra\n"
    "Tomas Eriksen,tomas@harbourlabs.example,Harbour Labs,workshop\n"
    ",missing@example.com,No Name Co,\n"
)


@pytest.fixture
async def two_years(
    session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> tuple[dict[str, str], Event, Event, uuid.UUID]:
    """One organisation, two conferences, one speaker who did the older one."""
    headers, this_year, _form = cfp

    with tenancy_disabled():
        last_year = Event(
            org_id=this_year.org_id,
            name="DevFlow Conf 2026",
            slug=f"devflow-2026-{uuid.uuid4().hex[:6]}",
            timezone="UTC",
            starts_on=date(2026, 5, 12),
            ends_on=date(2026, 5, 14),
            status=EventStatus.ARCHIVED,
        )
        session.add(last_year)
        await session.flush()

        veteran = Speaker(
            org_id=this_year.org_id, name="Priya Raman", email="priya@lattice.example"
        )
        session.add(veteran)
        await session.flush()
        session.add(
            EventSpeaker(
                org_id=this_year.org_id,
                event_id=last_year.id,
                speaker_id=veteran.id,
                status=SpeakerStatus.CONFIRMED,
            )
        )
        await session.commit()

    return headers, this_year, last_year, veteran.id


async def test_the_directory_shows_someone_from_an_event_they_no_longer_speak_at(
    client: AsyncClient, two_years: tuple[dict[str, str], Event, Event, uuid.UUID]
) -> None:
    """The whole reason the directory exists. She is not on this year's roster,
    and she must still be findable, with last year's appearance attached."""
    headers, this_year, last_year, veteran_id = two_years

    directory = await client.get(f"/v1/orgs/{this_year.org_id}/directory", headers=headers)
    roster = await client.get(f"/v1/events/{this_year.id}/speakers", headers=headers)

    found = next(row for row in directory.json() if row["id"] == str(veteran_id))
    assert found["name"] == "Priya Raman"
    assert [entry["event_name"] for entry in found["events"]] == ["DevFlow Conf 2026"]
    assert str(veteran_id) not in [row["speaker_id"] for row in roster.json()]
    assert last_year.id is not None


async def test_pushing_a_contact_onto_an_event_is_idempotent(
    client: AsyncClient, two_years: tuple[dict[str, str], Event, Event, uuid.UUID]
) -> None:
    """The handoff the directory exists for: last year's keynote onto this year."""
    headers, this_year, _last_year, veteran_id = two_years

    first = await client.post(
        f"/v1/orgs/{this_year.org_id}/directory/{veteran_id}/push",
        headers=headers,
        json={"event_id": str(this_year.id)},
    )
    second = await client.post(
        f"/v1/orgs/{this_year.org_id}/directory/{veteran_id}/push",
        headers=headers,
        json={"event_id": str(this_year.id)},
    )

    assert first.json() == {"added": 1, "already_there": 0}
    assert second.json() == {"added": 0, "already_there": 1}

    roster = await client.get(f"/v1/events/{this_year.id}/speakers", headers=headers)
    assert str(veteran_id) in [row["speaker_id"] for row in roster.json()]


async def test_importing_the_same_file_twice_creates_nobody_the_second_time(
    client: AsyncClient, two_years: tuple[dict[str, str], Event, Event, uuid.UUID]
) -> None:
    headers, this_year, _last_year, _veteran_id = two_years
    url = f"/v1/orgs/{this_year.org_id}/directory/import"

    first = await client.post(url, headers=headers, files={"file": ("people.csv", CSV, "text/csv")})
    second = await client.post(
        url, headers=headers, files={"file": ("people.csv", CSV, "text/csv")}
    )

    assert first.json()["created"] == 2
    assert first.json()["skipped"] == 1
    assert any("Row 4" in message for message in first.json()["errors"])

    assert second.json()["created"] == 0
    assert second.json()["matched"] == 2


async def test_import_carries_semicolon_separated_tags(
    client: AsyncClient, two_years: tuple[dict[str, str], Event, Event, uuid.UUID]
) -> None:
    headers, this_year, _last_year, _veteran_id = two_years

    await client.post(
        f"/v1/orgs/{this_year.org_id}/directory/import",
        headers=headers,
        files={"file": ("people.csv", CSV, "text/csv")},
    )

    directory = await client.get(f"/v1/orgs/{this_year.org_id}/directory", headers=headers)
    rosa = next(row for row in directory.json() if row["email"] == "rosa@northbound.example")
    assert rosa["tags"] == ["infra", "keynote"]


async def test_a_pipeline_status_outside_the_vocabulary_is_refused(
    client: AsyncClient, two_years: tuple[dict[str, str], Event, Event, uuid.UUID]
) -> None:
    headers, this_year, _last_year, veteran_id = two_years

    good = await client.patch(
        f"/v1/orgs/{this_year.org_id}/directory/{veteran_id}",
        headers=headers,
        json={"crm_status": "invited", "tags": ["keynote", " keynote ", ""]},
    )
    bad = await client.patch(
        f"/v1/orgs/{this_year.org_id}/directory/{veteran_id}",
        headers=headers,
        json={"crm_status": "maybe-someday"},
    )

    assert good.status_code == 200
    assert good.json()["crm_status"] == "invited"
    # Whitespace and blanks collapse rather than becoming three distinct tags.
    assert good.json()["tags"] == ["keynote"]
    assert bad.status_code == 422


async def test_bulk_email_personalises_each_message(
    client: AsyncClient,
    session: AsyncSession,
    two_years: tuple[dict[str, str], Event, Event, uuid.UUID],
) -> None:
    headers, this_year, _last_year, veteran_id = two_years

    response = await client.post(
        f"/v1/orgs/{this_year.org_id}/directory/email",
        headers=headers,
        json={
            "speaker_ids": [str(veteran_id)],
            "subject": "Speaking at {{name}}'s favourite conference",
            "body": "<p>Hi {{first_name}}, would you join us again?</p>",
            "event_id": str(this_year.id),
        },
    )

    assert response.json() == {"sent": 1}
    with tenancy_disabled():
        message = await session.scalar(select(Message).where(Message.to_speaker_id == veteran_id))
    assert message is not None
    assert message.subject == "Speaking at Priya Raman's favourite conference"
    assert "Hi Priya," in message.body_rendered


async def test_the_directory_refuses_a_caller_from_another_organisation(
    client: AsyncClient, two_years: tuple[dict[str, str], Event, Event, uuid.UUID]
) -> None:
    headers, _this_year, _last_year, _veteran_id = two_years

    response = await client.get(f"/v1/orgs/{uuid.uuid4()}/directory", headers=headers)

    assert response.status_code == 403
