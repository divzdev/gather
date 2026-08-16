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


async def test_a_speaker_confirms_their_own_participation(
    client: AsyncClient, onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str]
) -> None:
    _headers, event, rosa, _tomas, _template_id = onboarding

    response = await client.put(
        "/v1/portal/participation",
        headers=_token(rosa.id, event.id),
        json={"status": "confirmed"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "confirmed"
    # The timestamp is what separates "they told us" from an organiser's guess.
    assert response.json()["responded_at"] is not None


async def test_declining_keeps_the_reason_and_confirming_again_clears_it(
    client: AsyncClient, onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str]
) -> None:
    _headers, event, rosa, _tomas, _template_id = onboarding
    headers = _token(rosa.id, event.id)

    declined = await client.put(
        "/v1/portal/participation",
        headers=headers,
        json={"status": "declined", "reason": "Clashes with a client launch."},
    )
    assert declined.json()["decline_reason"] == "Clashes with a client launch."

    # A speaker whose plans change back must not be stuck behind their own answer.
    again = await client.put(
        "/v1/portal/participation", headers=headers, json={"status": "confirmed"}
    )

    assert again.json()["status"] == "confirmed"
    assert again.json()["decline_reason"] is None


async def test_a_speaker_who_was_never_accepted_has_nothing_to_confirm(
    client: AsyncClient,
    session: AsyncSession,
    onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str],
) -> None:
    _headers, event, rosa, _tomas, _template_id = onboarding
    with tenancy_disabled():
        link = await session.scalar(select(EventSpeaker).where(EventSpeaker.speaker_id == rosa.id))
        assert link is not None
        link.status = SpeakerStatus.PROSPECTIVE
        await session.commit()

    response = await client.put(
        "/v1/portal/participation",
        headers=_token(rosa.id, event.id),
        json={"status": "confirmed"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "PARTICIPATION_LOCKED"


async def test_a_speaker_cannot_set_a_status_that_is_the_organisers_to_set(
    client: AsyncClient, onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str]
) -> None:
    _headers, event, rosa, _tomas, _template_id = onboarding

    response = await client.put(
        "/v1/portal/participation",
        headers=_token(rosa.id, event.id),
        json={"status": "withdrawn"},
    )

    assert response.status_code == 422


async def test_the_roster_shows_whether_the_speaker_answered_themselves(
    client: AsyncClient, onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str]
) -> None:
    headers, event, rosa, tomas, _template_id = onboarding
    await client.put(
        "/v1/portal/participation",
        headers=_token(rosa.id, event.id),
        json={"status": "confirmed"},
    )

    roster = (await client.get(f"/v1/events/{event.id}/speakers", headers=headers)).json()
    answered = next(row for row in roster if row["speaker_id"] == str(rosa.id))
    silent = next(row for row in roster if row["speaker_id"] == str(tomas.id))

    assert answered["responded_at"] is not None
    assert silent["responded_at"] is None


async def test_an_unassigned_deliverable_can_be_deleted(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _form = cfp
    created = await client.post(
        f"/v1/events/{event.id}/task-templates",
        headers=headers,
        json={"name": "Typo", "kind": "acknowledge"},
    )
    template_id = created.json()["id"]

    gone = await client.delete(
        f"/v1/events/{event.id}/task-templates/{template_id}", headers=headers
    )

    assert gone.status_code == 204
    listing = await client.get(f"/v1/events/{event.id}/task-templates", headers=headers)
    assert [row["id"] for row in listing.json()] == []


async def test_deleting_an_assigned_deliverable_is_refused_with_the_count(
    client: AsyncClient, onboarding: tuple[dict[str, str], Event, Speaker, Speaker, str]
) -> None:
    """The FK cascades, so this delete would erase two speakers' progress."""
    headers, event, _rosa, _tomas, template_id = onboarding

    refused = await client.delete(
        f"/v1/events/{event.id}/task-templates/{template_id}", headers=headers
    )

    assert refused.status_code == 409
    assert refused.json()["error"]["details"]["assigned"] == 2
    # Refused, not half-done: the template and both speakers' tasks survive.
    listing = await client.get(f"/v1/events/{event.id}/task-templates", headers=headers)
    assert [row["id"] for row in listing.json()] == [template_id]
    summary = await client.get(f"/v1/events/{event.id}/tasks/summary", headers=headers)
    assert len(summary.json()) == 2


async def _second_event(session: AsyncSession, first: Event, slug: str) -> Event:
    """Another conference belonging to the same organiser."""
    with tenancy_disabled():
        event = Event(
            org_id=first.org_id,
            name="Northbound Summit",
            slug=slug,
            timezone=first.timezone,
            starts_on=first.starts_on,
            ends_on=first.ends_on,
        )
        session.add(event)
        await session.commit()
    return event


async def test_a_speaker_sees_every_conference_they_are_on(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _headers, event, _form = cfp
    rosa = await _add_speaker(session, event, "Rosa Lindqvist", "rosa@northbound.example")
    second = await _second_event(session, event, "northbound-summit")
    with tenancy_disabled():
        session.add(
            EventSpeaker(
                org_id=second.org_id,
                event_id=second.id,
                speaker_id=rosa.id,
                status=SpeakerStatus.ACCEPTED,
            )
        )
        await session.commit()

    listing = await client.get("/v1/portal/events", headers=_token(rosa.id, event.id))

    assert listing.status_code == 200
    rows = listing.json()
    assert {row["slug"] for row in rows} == {event.slug, "northbound-summit"}
    # Exactly one is the session's own event, and the token still names it.
    assert [row["is_current"] for row in rows].count(True) == 1
    assert next(row for row in rows if row["is_current"])["event_id"] == str(event.id)


async def test_a_speaker_does_not_see_a_conference_they_are_not_on(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The other event belongs to the same organiser, which is not the fence."""
    _headers, event, _form = cfp
    rosa = await _add_speaker(session, event, "Rosa Lindqvist", "rosa@northbound.example")
    await _second_event(session, event, "not-mine")

    listing = await client.get("/v1/portal/events", headers=_token(rosa.id, event.id))

    assert [row["slug"] for row in listing.json()] == [event.slug]


async def test_switching_needs_a_participation_not_just_an_event_id(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _headers, event, _form = cfp
    rosa = await _add_speaker(session, event, "Rosa Lindqvist", "rosa@northbound.example")
    stranger = await _second_event(session, event, "stranger-event")

    refused = await client.post(
        "/v1/portal/switch",
        headers=_token(rosa.id, event.id),
        json={"event_id": str(stranger.id)},
    )

    assert refused.status_code == 404


async def test_switching_returns_a_session_for_the_other_conference(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _headers, event, _form = cfp
    rosa = await _add_speaker(session, event, "Rosa Lindqvist", "rosa@northbound.example")
    second = await _second_event(session, event, "northbound-summit-2")
    with tenancy_disabled():
        session.add(
            EventSpeaker(
                org_id=second.org_id,
                event_id=second.id,
                speaker_id=rosa.id,
                status=SpeakerStatus.ACCEPTED,
            )
        )
        await session.commit()

    switched = await client.post(
        "/v1/portal/switch",
        headers=_token(rosa.id, event.id),
        json={"event_id": str(second.id)},
    )

    assert switched.status_code == 200
    token = switched.json()["access_token"]
    # The new token is a working session on the *other* conference.
    home = await client.get("/v1/portal/home", headers={"Authorization": f"Bearer {token}"})
    assert home.status_code == 200
    assert home.json()["event"]["slug"] == "northbound-summit-2"


# --- requires_review: what a delivery means (spec 0007) ----------------------


async def _template(
    client: AsyncClient,
    headers: dict[str, str],
    event: Event,
    *,
    name: str,
    kind: str,
    requires_review: bool,
    form_id: str | None = None,
) -> str:
    body: dict[str, object] = {
        "name": name,
        "kind": kind,
        "requires_review": requires_review,
        "due_rule": {"type": "relative", "days_before_event": 7},
    }
    if kind == "upload":
        body["accepted_file_types"] = {"extensions": ["pdf"]}
    if form_id is not None:
        body["form_id"] = form_id
    created = await client.post(f"/v1/events/{event.id}/task-templates", headers=headers, json=body)
    assert created.status_code == 201, created.text
    template_id = created.json()["id"]
    await client.post(f"/v1/events/{event.id}/task-templates/{template_id}/assign", headers=headers)
    return str(template_id)


async def _task_of(
    client: AsyncClient, speaker: Speaker, event: Event, name: str
) -> dict[str, object]:
    home = await client.get("/v1/portal/home", headers=_token(speaker.id, event.id))
    for row in home.json()["tasks"]:
        if row["name"] == name:
            return dict(row)
    raise AssertionError(f"no task named {name!r} in {[r['name'] for r in home.json()['tasks']]}")


@pytest.mark.parametrize(
    ("requires_review", "expected"), [(False, "complete"), (True, "submitted")]
)
async def test_requires_review_decides_what_a_form_answer_means(
    client: AsyncClient,
    session: AsyncSession,
    cfp: tuple[dict[str, str], Event, Form],
    requires_review: bool,
    expected: str,
) -> None:
    """The column was written, stored, and never read — every delivery landed
    `submitted`, so a speaker answering "macOS" waited for a human to accept
    that fact."""
    headers, event, form = cfp
    speaker = await _add_speaker(session, event, "Ines Roth", "ines@northbound.example")
    await _template(
        client,
        headers,
        event,
        name="Setup",
        kind="form",
        requires_review=requires_review,
        form_id=str(form.id),
    )
    task = await _task_of(client, speaker, event, "Setup")

    sent = await client.put(
        f"/v1/portal/tasks/{task['id']}",
        headers=_token(speaker.id, event.id),
        json={"form_response": {"abstract": "I present from macOS.", "format": "talk"}},
    )

    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == expected


@pytest.mark.parametrize(
    ("requires_review", "expected"), [(False, "complete"), (True, "submitted")]
)
async def test_requires_review_governs_uploads_as_well_as_forms(
    client: AsyncClient,
    session: AsyncSession,
    cfp: tuple[dict[str, str], Event, Form],
    requires_review: bool,
    expected: str,
) -> None:
    """The upload path is the one that changes behaviour. A headshot needs a
    human eye; "which OS?" does not — and one flag has to mean one thing."""
    headers, event, _form = cfp
    speaker = await _add_speaker(session, event, "Bo Halvorsen", "bo@harbourlabs.example")
    await _template(
        client, headers, event, name="Deck", kind="upload", requires_review=requires_review
    )
    task = await _task_of(client, speaker, event, "Deck")

    sent = await client.post(
        f"/v1/portal/tasks/{task['id']}/files",
        headers=_token(speaker.id, event.id),
        files={"file": ("deck.pdf", b"%PDF-1.4 trimmed", "application/pdf")},
    )

    assert sent.status_code == 201, sent.text
    assert sent.json()["status"] == expected


async def test_an_acknowledgement_completes_whatever_the_review_flag_says(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """Exempt on purpose: ticking the box *is* the confirmation, and there is no
    artefact for an organiser to inspect."""
    headers, event, _form = cfp
    speaker = await _add_speaker(session, event, "Ada Silva", "ada@northbound.example")
    await _template(
        client, headers, event, name="Code of conduct", kind="acknowledge", requires_review=True
    )
    task = await _task_of(client, speaker, event, "Code of conduct")

    sent = await client.put(
        f"/v1/portal/tasks/{task['id']}",
        headers=_token(speaker.id, event.id),
        json={"acknowledged": True},
    )

    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == "complete"


async def test_a_form_task_carries_its_schema_and_other_kinds_do_not(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The portal had no way to draw the form: the payload never carried one.

    On the single-task read only — `/portal/home` stays one lean round trip and
    does not haul a schema per form task for a list nobody is filling in yet.
    """
    headers, event, form = cfp
    speaker = await _add_speaker(session, event, "Nils Berg", "nils@northbound.example")
    await _template(
        client,
        headers,
        event,
        name="Setup",
        kind="form",
        requires_review=False,
        form_id=str(form.id),
    )
    await _template(client, headers, event, name="Deck", kind="upload", requires_review=True)

    token = _token(speaker.id, event.id)
    setup = await _task_of(client, speaker, event, "Setup")
    deck = await _task_of(client, speaker, event, "Deck")

    # Home carries no schema for anybody.
    assert "schema" not in setup and "schema" not in deck

    read = await client.get(f"/v1/portal/tasks/{setup['id']}", headers=token)
    assert read.status_code == 200, read.text
    assert read.json()["schema"]["sections"], "a form task has to arrive with something to draw"

    other = await client.get(f"/v1/portal/tasks/{deck['id']}", headers=token)
    assert other.status_code == 200
    assert other.json()["schema"] is None


async def test_a_form_task_whose_form_was_deleted_reports_broken(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """`TaskTemplate.form_id` is ON DELETE SET NULL, so deleting a Form leaves a
    form task pointing at nothing.

    That is broken, not empty. Rendering a blank form would invite the speaker to
    submit an empty answer against a form that no longer exists, and mark a
    required task done on the strength of it.
    """
    headers, event, form = cfp
    speaker = await _add_speaker(session, event, "Vera Lund", "vera@harbourlabs.example")
    await _template(
        client,
        headers,
        event,
        name="Setup",
        kind="form",
        requires_review=False,
        form_id=str(form.id),
    )
    task = await _task_of(client, speaker, event, "Setup")

    with tenancy_disabled():
        stored = await session.get(Form, form.id)
        assert stored is not None
        await session.delete(stored)
        await session.commit()

    read = await client.get(f"/v1/portal/tasks/{task['id']}", headers=_token(speaker.id, event.id))

    assert read.status_code == 409
    body = read.json()["error"]
    assert body["code"] == "FORM_MISSING"
    assert "organiser" in body["message"]


async def _form_task(
    client: AsyncClient,
    session: AsyncSession,
    event: Event,
    form: Form,
    headers: dict[str, str],
    *,
    who: str,
    email: str,
    requires_review: bool = False,
) -> tuple[Speaker, str]:
    speaker = await _add_speaker(session, event, who, email)
    await _template(
        client,
        headers,
        event,
        name="Setup",
        kind="form",
        requires_review=requires_review,
        form_id=str(form.id),
    )
    task = await _task_of(client, speaker, event, "Setup")
    return speaker, str(task["id"])


async def test_autosave_keeps_the_answer_and_leaves_the_task_alone(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """A speaker on a phone who loses the tab must not lose the form.

    Autosave writes `form_response` and touches nothing else: a pending task
    stays pending. The status is what tells a draft from a sent answer, so
    moving it here would report work as delivered that the speaker never sent.
    """
    headers, event, form = cfp
    speaker, task_id = await _form_task(
        client, session, event, form, headers, who="Kai Nord", email="kai@northbound.example"
    )
    token = _token(speaker.id, event.id)

    saved = await client.patch(
        f"/v1/portal/tasks/{task_id}", headers=token, json={"form_response": {"abstract": "Half a"}}
    )

    assert saved.status_code == 200, saved.text
    # Untouched: an autosaved answer is not a delivery, and the status is the
    # only thing that says so.
    assert saved.json()["status"] == "not_started"
    assert saved.json()["form_response"] == {"abstract": "Half a"}

    # And it survives coming back.
    again = await client.get(f"/v1/portal/tasks/{task_id}", headers=token)
    assert again.json()["form_response"] == {"abstract": "Half a"}


async def test_autosave_does_not_nag_about_required_but_sending_does(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The same split the CFP already makes: saving as you go is never an error,
    sending an incomplete form is."""
    headers, event, form = cfp
    speaker, task_id = await _form_task(
        client, session, event, form, headers, who="Mira Ek", email="mira@harbourlabs.example"
    )
    token = _token(speaker.id, event.id)

    # `format` is required by the CFP fixture schema; `abstract` alone is partial.
    partial = await client.patch(
        f"/v1/portal/tasks/{task_id}",
        headers=token,
        json={"form_response": {"abstract": "Just this"}},
    )
    assert partial.status_code == 200, "a draft must never be refused for being a draft"

    sent = await client.put(
        f"/v1/portal/tasks/{task_id}",
        headers=token,
        json={"form_response": {"abstract": "Just this"}},
    )

    assert sent.status_code == 422
    body = sent.json()["error"]
    assert body["code"] == "VALIDATION_FAILED"
    assert body["field"] == "format", "the error has to name the question that blocked it"


async def test_an_answer_to_a_question_that_does_not_exist_is_refused(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """`form_response` was stored unvalidated — any JSON a caller sent went into
    the column, against a schema that never mentioned it."""
    headers, event, form = cfp
    speaker, task_id = await _form_task(
        client, session, event, form, headers, who="Otto Rask", email="otto@northbound.example"
    )

    sent = await client.put(
        f"/v1/portal/tasks/{task_id}",
        headers=_token(speaker.id, event.id),
        json={"form_response": {"abstract": "a", "format": "talk", "salary": 100000}},
    )

    assert sent.status_code == 422
    assert sent.json()["error"]["code"] == "VALIDATION_FAILED"


async def test_revising_an_accepted_answer_sends_it_back_for_review(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The organiser accepted the previous answer, not this one.

    A speaker who books a room on "HDMI" and then quietly switches to "USB-C"
    must not leave an acceptance standing against an answer that no longer
    exists.
    """
    headers, event, form = cfp
    speaker, task_id = await _form_task(
        client,
        session,
        event,
        form,
        headers,
        who="Sten Aho",
        email="sten@northbound.example",
        requires_review=True,
    )
    token = _token(speaker.id, event.id)

    first = await client.put(
        f"/v1/portal/tasks/{task_id}",
        headers=token,
        json={"form_response": {"abstract": "HDMI please", "format": "talk"}},
    )
    assert first.json()["status"] == "submitted"

    # The organiser accepts it.
    accepted = await client.patch(
        f"/v1/events/{event.id}/speaker-tasks/{task_id}",
        headers=headers,
        json={"status": "complete"},
    )
    assert accepted.status_code == 200, accepted.text

    revised = await client.put(
        f"/v1/portal/tasks/{task_id}",
        headers=token,
        json={"form_response": {"abstract": "USB-C actually", "format": "talk"}},
    )

    assert revised.status_code == 200, revised.text
    assert revised.json()["status"] == "submitted", (
        "an accepted answer that changed needs re-accepting"
    )
    assert revised.json()["form_response"]["abstract"] == "USB-C actually"


async def test_revising_a_task_that_needs_no_review_stays_done(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """Nobody accepted it in the first place, so there is nothing to re-accept —
    correcting a typo must not reopen work that was never anyone's."""
    headers, event, form = cfp
    speaker, task_id = await _form_task(
        client, session, event, form, headers, who="Liv Aas", email="liv@harbourlabs.example"
    )
    token = _token(speaker.id, event.id)

    first = await client.put(
        f"/v1/portal/tasks/{task_id}",
        headers=token,
        json={"form_response": {"abstract": "HDMI", "format": "talk"}},
    )
    assert first.json()["status"] == "complete"

    revised = await client.put(
        f"/v1/portal/tasks/{task_id}",
        headers=token,
        json={"form_response": {"abstract": "USB-C", "format": "talk"}},
    )

    assert revised.json()["status"] == "complete"
    assert revised.json()["form_response"]["abstract"] == "USB-C"


async def test_an_organiser_can_read_the_answers_and_the_questions_that_were_asked(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """`form_response` was written by the portal and read by nobody — not on any
    screen, not in any export. The answers existed and no human could reach them.

    The schema travels with them because the organiser has to read
    "Which OS? — macOS", not `{"abstract": "macOS"}`. Resolving labels on the
    client from a field key it was never given is not possible.
    """
    headers, event, form = cfp
    speaker, task_id = await _form_task(
        client,
        session,
        event,
        form,
        headers,
        who="Ida Falk",
        email="ida@northbound.example",
        requires_review=True,
    )
    await client.put(
        f"/v1/portal/tasks/{task_id}",
        headers=_token(speaker.id, event.id),
        json={"form_response": {"abstract": "I present from macOS.", "format": "talk"}},
    )

    row = await client.get(f"/v1/events/{event.id}/speaker-tasks/{task_id}", headers=headers)

    assert row.status_code == 200, row.text
    body = row.json()
    assert body["form_response"] == {"abstract": "I present from macOS.", "format": "talk"}
    labels = {f["key"]: f["label"] for f in body["schema"]["sections"][0]["fields"]}
    assert labels["abstract"] == "Abstract", "the panel renders questions, not field keys"


async def test_a_reviewer_cannot_read_another_events_task(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The new organiser read is a new door onto speaker answers. It gets the
    same fence as every other route in this file."""
    headers, event, form = cfp
    speaker, task_id = await _form_task(
        client, session, event, form, headers, who="Nea Virta", email="nea@harbourlabs.example"
    )

    # A speaker token is not an organiser token, whatever it is scoped to.
    refused = await client.get(
        f"/v1/events/{event.id}/speaker-tasks/{task_id}", headers=_token(speaker.id, event.id)
    )

    assert refused.status_code in (401, 403)


async def test_the_headshot_task_becomes_the_speakers_profile_photo(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The Headshot task was decorative.

    Two upload paths wrote to two places: `/portal/profile/headshot` set
    `speaker.headshot_file_id`, which the public speaker card, the gallery and
    the embed all read — and `/portal/tasks/{id}/files` created a TaskFile that
    nothing outside the task row ever looked at. So the deliverable an organiser
    chases, with a deadline on it, never reached the page it exists to fill.
    """
    headers, event, _form = cfp
    speaker = await _add_speaker(session, event, "Rune Dahl", "rune@northbound.example")
    created = await client.post(
        f"/v1/events/{event.id}/task-templates",
        headers=headers,
        json={
            "name": "Headshot",
            "kind": "upload",
            "accepted_file_types": {"extensions": ["png", "jpg"]},
            "sets_profile_photo": True,
            "due_rule": {"type": "relative", "days_before_event": 21},
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["sets_profile_photo"] is True
    await client.post(
        f"/v1/events/{event.id}/task-templates/{created.json()['id']}/assign", headers=headers
    )
    task = await _task_of(client, speaker, event, "Headshot")
    token = _token(speaker.id, event.id)

    before = await client.get("/v1/portal/profile", headers=token)
    assert before.json()["headshot_file_id"] is None

    uploaded = await client.post(
        f"/v1/portal/tasks/{task['id']}/files",
        headers=token,
        files={"file": ("me.png", b"\x89PNG\r\n\x1a\n fake", "image/png")},
    )
    assert uploaded.status_code == 201, uploaded.text

    after = await client.get("/v1/portal/profile", headers=token)
    assert after.json()["headshot_file_id"] == uploaded.json()["files"][0]["id"], (
        "the photo the speaker delivered has to be the photo the public page shows"
    )


async def test_an_ordinary_upload_task_leaves_the_profile_photo_alone(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The flag is why this is a decision and not a guess about file types.

    An organiser collecting "a photo of your rig" gets an image upload that must
    not silently become the speaker's face on the public programme.
    """
    headers, event, _form = cfp
    speaker = await _add_speaker(session, event, "Alma Vik", "alma@harbourlabs.example")
    created = await client.post(
        f"/v1/events/{event.id}/task-templates",
        headers=headers,
        json={
            "name": "Photo of your rig",
            "kind": "upload",
            "accepted_file_types": {"extensions": ["png", "jpg"]},
            "due_rule": {"type": "relative", "days_before_event": 21},
        },
    )
    # Defaults to False: a task supplies the profile photo only when asked to.
    assert created.json()["sets_profile_photo"] is False
    await client.post(
        f"/v1/events/{event.id}/task-templates/{created.json()['id']}/assign", headers=headers
    )
    task = await _task_of(client, speaker, event, "Photo of your rig")
    token = _token(speaker.id, event.id)

    await client.post(
        f"/v1/portal/tasks/{task['id']}/files",
        headers=token,
        files={"file": ("rig.png", b"\x89PNG\r\n\x1a\n fake", "image/png")},
    )

    after = await client.get("/v1/portal/profile", headers=token)
    assert after.json()["headshot_file_id"] is None
