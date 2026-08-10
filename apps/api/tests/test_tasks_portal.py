"""Speaker deliverables, file versions, and the fence around the portal.

The isolation test here is the important one: a valid speaker token is scoped to
an event, and the event is full of *other* speakers' tasks and files.
"""

from __future__ import annotations

import io
import uuid
import zipfile
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token
from app.core.tenancy import tenancy_disabled
from app.models import Event, EventSpeaker, Form, Speaker, SpeakerStatus, SpeakerTask, TaskStatus

# The event-with-an-open-CFP fixture, reused rather than rebuilt.
from test_cfp_flow import cfp  # noqa: F401

SPEAKER_TTL = timedelta(days=7)


@pytest.fixture(autouse=True)
def _isolated_storage(tmp_path: object, monkeypatch: pytest.MonkeyPatch) -> None:
    """Uploads land in the test's own directory, never in the repo."""
    monkeypatch.setattr(get_settings(), "storage_root", tmp_path)


def _token(speaker_id: uuid.UUID, event_id: uuid.UUID) -> dict[str, str]:
    raw = create_access_token(
        speaker_id,
        kind="speaker",
        expires_in=SPEAKER_TTL,
        claims={"event_id": str(event_id)},
    )
    return {"Authorization": f"Bearer {raw}"}


async def _add_speaker(session: AsyncSession, event: Event, name: str, email: str) -> Speaker:
    with tenancy_disabled():
        speaker = Speaker(org_id=event.org_id, name=name, email=email)
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
    return speaker


@pytest.fixture
async def onboarding(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> tuple[dict[str, str], Event, Speaker, Speaker, str]:
    """Two accepted speakers and one assigned upload task each."""
    headers, event, _form = cfp
    rosa = await _add_speaker(session, event, "Rosa Lindqvist", "rosa@northbound.example")
    tomas = await _add_speaker(session, event, "Tomas Eriksen", "tomas@harbourlabs.example")

    created = await client.post(
        f"/v1/events/{event.id}/task-templates",
        headers=headers,
        json={
            "name": "Slide deck",
            "kind": "upload",
            "due_rule": {"type": "relative", "days_before_event": 14},
            "accepted_file_types": {"extensions": ["pdf"]},
        },
    )
    template_id = created.json()["id"]
    await client.post(f"/v1/events/{event.id}/task-templates/{template_id}/assign", headers=headers)
    return headers, event, rosa, tomas, template_id


async def _own_task_id(client: AsyncClient, speaker: Speaker, event: Event) -> str:
    home = await client.get("/v1/portal/home", headers=_token(speaker.id, event.id))
    return str(home.json()["tasks"][0]["id"])


async def test_assigning_a_template_is_idempotent(
    client: AsyncClient, onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str]
) -> None:
    headers, event, _rosa, _tomas, template_id = onboarding

    again = await client.post(
        f"/v1/events/{event.id}/task-templates/{template_id}/assign", headers=headers
    )

    assert again.json()["assigned"] == 0
    summary = await client.get(f"/v1/events/{event.id}/tasks/summary", headers=headers)
    assert len(summary.json()) == 2


async def test_a_speaker_sees_only_their_own_tasks(
    client: AsyncClient, onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str]
) -> None:
    _headers, event, rosa, tomas, _template_id = onboarding

    home = await client.get("/v1/portal/home", headers=_token(rosa.id, event.id))

    body = home.json()
    assert body["speaker"]["email"] == "rosa@northbound.example"
    assert len(body["tasks"]) == 1
    assert body["progress"] == {"total": 1, "complete": 0, "outstanding": 1, "overdue": 0}

    tomas_task = await _own_task_id(client, tomas, event)
    trespass = await client.get(f"/v1/portal/tasks/{tomas_task}", headers=_token(rosa.id, event.id))
    assert trespass.status_code == 404


async def test_a_speaker_cannot_read_another_speakers_file(
    client: AsyncClient, onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str]
) -> None:
    _headers, event, rosa, tomas, _template_id = onboarding
    tomas_task = await _own_task_id(client, tomas, event)

    uploaded = await client.post(
        f"/v1/portal/tasks/{tomas_task}/files",
        headers=_token(tomas.id, event.id),
        files={"file": ("deck.pdf", b"%PDF-1.4 tomas", "application/pdf")},
    )
    file_id = uploaded.json()["files"][0]["id"]

    mine = await client.get(f"/v1/portal/files/{file_id}", headers=_token(tomas.id, event.id))
    theirs = await client.get(f"/v1/portal/files/{file_id}", headers=_token(rosa.id, event.id))

    assert mine.status_code == 200
    assert mine.content == b"%PDF-1.4 tomas"
    assert theirs.status_code == 404


async def test_replacing_a_file_makes_version_two_and_keeps_version_one(
    client: AsyncClient, onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str]
) -> None:
    _headers, event, rosa, _tomas, _template_id = onboarding
    task_id = await _own_task_id(client, rosa, event)
    auth = _token(rosa.id, event.id)

    first = await client.post(
        f"/v1/portal/tasks/{task_id}/files",
        headers=auth,
        files={"file": ("deck.pdf", b"draft one", "application/pdf")},
    )
    second = await client.post(
        f"/v1/portal/tasks/{task_id}/files",
        headers=auth,
        files={"file": ("deck.pdf", b"draft two", "application/pdf")},
    )

    versions = [row["version"] for row in second.json()["files"]]
    assert sorted(versions) == [1, 2]

    older = first.json()["files"][0]["id"]
    still_there = await client.get(f"/v1/portal/files/{older}", headers=auth)
    assert still_there.status_code == 200
    assert still_there.content == b"draft one"


async def test_an_upload_of_the_wrong_type_is_refused_by_name(
    client: AsyncClient, onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str]
) -> None:
    _headers, event, rosa, _tomas, _template_id = onboarding
    task_id = await _own_task_id(client, rosa, event)

    response = await client.post(
        f"/v1/portal/tasks/{task_id}/files",
        headers=_token(rosa.id, event.id),
        files={"file": ("notes.txt", b"not a deck", "text/plain")},
    )

    assert response.status_code == 422
    assert "pdf" in response.json()["error"]["message"]


async def test_overdue_is_derived_from_the_due_date_not_stored(
    client: AsyncClient,
    session: AsyncSession,
    onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str],
) -> None:
    headers, event, rosa, _tomas, _template_id = onboarding
    with tenancy_disabled():
        task = await session.scalar(select(SpeakerTask).where(SpeakerTask.speaker_id == rosa.id))
        assert task is not None
        assert task.status is TaskStatus.NOT_STARTED
        task.due_at = datetime.now(UTC) - timedelta(days=1)
        await session.commit()

    summary = await client.get(f"/v1/events/{event.id}/tasks/summary", headers=headers)
    mine = [row for row in summary.json() if row["speaker_id"] == str(rosa.id)]

    assert mine[0]["status"] == TaskStatus.OVERDUE.value


async def test_a_second_nudge_inside_the_floor_is_skipped_and_counted(
    client: AsyncClient, onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str]
) -> None:
    headers, event, _rosa, _tomas, _template_id = onboarding

    first = await client.post(f"/v1/events/{event.id}/tasks/nudge", headers=headers, json={})
    second = await client.post(f"/v1/events/{event.id}/tasks/nudge", headers=headers, json={})

    assert first.json() == {"sent": 2, "skipped": 0}
    assert second.json() == {"sent": 0, "skipped": 2}


async def test_the_zip_holds_the_newest_version_grouped_by_speaker(
    client: AsyncClient, onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str]
) -> None:
    headers, event, rosa, _tomas, _template_id = onboarding
    task_id = await _own_task_id(client, rosa, event)
    auth = _token(rosa.id, event.id)

    await client.post(
        f"/v1/portal/tasks/{task_id}/files",
        headers=auth,
        files={"file": ("deck.pdf", b"draft one", "application/pdf")},
    )
    await client.post(
        f"/v1/portal/tasks/{task_id}/files",
        headers=auth,
        files={"file": ("deck.pdf", b"draft two", "application/pdf")},
    )

    response = await client.get(f"/v1/events/{event.id}/tasks/download.zip", headers=headers)

    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
        assert len(names) == 1
        assert names[0].startswith("Rosa-Lindqvist/")
        assert archive.read(names[0]) == b"draft two"


async def test_an_organiser_completing_a_task_shows_who_did_it(
    client: AsyncClient, onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str]
) -> None:
    headers, event, rosa, _tomas, _template_id = onboarding
    summary = await client.get(f"/v1/events/{event.id}/tasks/summary", headers=headers)
    task_id = next(row["id"] for row in summary.json() if row["speaker_id"] == str(rosa.id))

    response = await client.patch(
        f"/v1/events/{event.id}/speaker-tasks/{task_id}",
        headers=headers,
        json={"status": "complete"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "complete"
    assert response.json()["completed_at"] is not None


async def test_a_speaker_token_for_another_event_is_refused(
    client: AsyncClient, onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str]
) -> None:
    _headers, _event, rosa, _tomas, _template_id = onboarding

    response = await client.get("/v1/portal/home", headers=_token(rosa.id, uuid.uuid4()))

    assert response.status_code == 401
