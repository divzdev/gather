"""The background sweep.

`make dev` starts this next to the API, and it was calling a module that did not
exist — so one of the three processes in the graded dev command was crashing on
every start.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import tenancy_disabled
from app.jobs import tasks as jobs
from app.models import (
    Event,
    EventSpeaker,
    EventStatus,
    Form,
    Speaker,
    SpeakerStatus,
    SpeakerTask,
)

# The event-with-an-open-CFP fixture, reused rather than rebuilt.
from test_cfp_flow import cfp  # noqa: F401


@pytest.fixture
async def owed(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> tuple[dict[str, str], Event, uuid.UUID]:
    """One speaker with one task that is already past its date."""
    headers, event, _form = cfp
    with tenancy_disabled():
        speaker = Speaker(org_id=event.org_id, name="Rosa Lindqvist", email="rosa@north.example")
        session.add(speaker)
        await session.flush()
        session.add(
            EventSpeaker(
                org_id=event.org_id,
                event_id=event.id,
                speaker_id=speaker.id,
                status=SpeakerStatus.ACCEPTED,
            )
        )
        await session.commit()

    created = await client.post(
        f"/v1/events/{event.id}/task-templates",
        headers=headers,
        json={"name": "Slide deck", "kind": "upload", "due_rule": {"type": "fixed", "date": ""}},
    )
    await client.post(
        f"/v1/events/{event.id}/task-templates/{created.json()['id']}/assign", headers=headers
    )

    with tenancy_disabled():
        task = await session.scalar(select(SpeakerTask).where(SpeakerTask.speaker_id == speaker.id))
        assert task is not None
        task.due_at = datetime.now(UTC) - timedelta(days=2)
        await session.commit()

    return headers, event, speaker.id


async def test_the_sweep_counts_overdue_without_transitioning_it(
    session: AsyncSession, owed: tuple[dict[str, str], Event, uuid.UUID]
) -> None:
    """Overdue is derived from the clock. The sweep acts on that number; it must
    not write it down, or a moved due date would leave a stale status behind."""
    _headers, _event, speaker_id = owed

    result = await jobs.sweep(session, remind=False)
    await session.commit()

    assert result.overdue >= 1
    with tenancy_disabled():
        task = await session.scalar(select(SpeakerTask).where(SpeakerTask.speaker_id == speaker_id))
    assert task is not None
    assert task.status.value == "not_started"


async def test_a_second_sweep_reminds_nobody(
    session: AsyncSession, owed: tuple[dict[str, str], Event, uuid.UUID]
) -> None:
    """The worker runs hourly and the floor is a day, so every pass but the first
    has to be silent — otherwise it emails the same speaker 24 times."""
    first = await jobs.sweep(session)
    await session.commit()
    second = await jobs.sweep(session)
    await session.commit()

    assert first.reminded >= 1
    assert second.reminded == 0
    assert second.skipped >= 1


async def test_an_archived_event_is_left_alone(
    session: AsyncSession, owed: tuple[dict[str, str], Event, uuid.UUID]
) -> None:
    """Nobody wants a chasing email about a conference that already happened."""
    _headers, event, _speaker_id = owed
    with tenancy_disabled():
        row = await session.get(Event, event.id)
        assert row is not None
        row.status = EventStatus.ARCHIVED
        await session.commit()

    result = await jobs.sweep(session)
    await session.commit()

    assert result.reminded == 0
