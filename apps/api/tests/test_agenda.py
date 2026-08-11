"""Placement and the three classes of conflict.

The rule under test everywhere here: a conflicting drop is *accepted*. The API
never refuses a placement because it collides; it persists it and reports.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import tenancy_disabled
from app.models import (
    Event,
    EventDay,
    EventSpeaker,
    Form,
    Message,
    Room,
    Session,
    SessionSpeaker,
    Speaker,
    SpeakerStatus,
    Track,
)

# The event-with-an-open-CFP fixture, reused rather than rebuilt.
from test_cfp_flow import cfp  # noqa: F401

NINE_AM = datetime(2027, 5, 12, 9, 0, tzinfo=UTC)


@pytest.fixture
async def grid(
    session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> tuple[dict[str, str], Event, dict[str, uuid.UUID]]:
    """Two rooms, one day, one track, and three unscheduled sessions."""
    headers, event, _form = cfp
    ids: dict[str, uuid.UUID] = {}

    with tenancy_disabled():
        day = EventDay(org_id=event.org_id, event_id=event.id, day_date=NINE_AM.date())
        main = Room(org_id=event.org_id, event_id=event.id, name="Main stage", sort_order=0)
        side = Room(org_id=event.org_id, event_id=event.id, name="Workshop room", sort_order=1)
        track = Track(org_id=event.org_id, event_id=event.id, name="Infrastructure")
        session.add_all([day, main, side, track])
        await session.flush()
        ids |= {"day": day.id, "main": main.id, "side": side.id, "track": track.id}

        rosa = Speaker(org_id=event.org_id, name="Rosa Lindqvist", email="rosa@north.example")
        session.add(rosa)
        await session.flush()
        session.add(
            EventSpeaker(
                org_id=event.org_id,
                event_id=event.id,
                speaker_id=rosa.id,
                status=SpeakerStatus.ACCEPTED,
            )
        )
        ids["rosa"] = rosa.id

        for index, title in enumerate(("Opening keynote", "Spot fleets", "Retrieval at scale")):
            talk = Session(
                org_id=event.org_id,
                event_id=event.id,
                title=title,
                slug=f"talk-{index}",
                track_id=track.id,
                duration_minutes=30,
            )
            session.add(talk)
            await session.flush()
            ids[f"talk{index}"] = talk.id
            # Rosa is on the first two, which is what makes a speaker clash possible.
            if index < 2:
                session.add(
                    SessionSpeaker(
                        org_id=event.org_id,
                        event_id=event.id,
                        session_id=talk.id,
                        speaker_id=rosa.id,
                    )
                )
        await session.commit()

    return headers, event, ids


async def _place(
    client: AsyncClient,
    headers: dict[str, str],
    event: Event,
    session_id: uuid.UUID,
    *,
    room: uuid.UUID,
    day: uuid.UUID,
    at: datetime,
    minutes: int = 30,
) -> dict[str, object]:
    response = await client.patch(
        f"/v1/events/{event.id}/sessions/{session_id}/placement",
        headers=headers,
        json={
            "event_day_id": str(day),
            "room_id": str(room),
            "starts_at": at.isoformat(),
            "duration_minutes": minutes,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()  # type: ignore[no-any-return]


async def test_back_to_back_sessions_do_not_conflict(
    client: AsyncClient, grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]]
) -> None:
    """Overlap is half-open. One ending exactly as the next begins is a handover,
    and calling it a clash makes a correct agenda look broken everywhere."""
    headers, event, ids = grid

    await _place(client, headers, event, ids["talk0"], room=ids["main"], day=ids["day"], at=NINE_AM)
    result = await _place(
        client,
        headers,
        event,
        ids["talk2"],
        room=ids["main"],
        day=ids["day"],
        at=NINE_AM + timedelta(minutes=30),
    )

    assert result["conflicts"] == []


async def test_two_sessions_in_one_room_conflict_but_the_drop_still_lands(
    client: AsyncClient, grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]]
) -> None:
    headers, event, ids = grid

    await _place(client, headers, event, ids["talk0"], room=ids["main"], day=ids["day"], at=NINE_AM)
    result = await _place(
        client,
        headers,
        event,
        ids["talk2"],
        room=ids["main"],
        day=ids["day"],
        at=NINE_AM + timedelta(minutes=15),
    )

    # The placement was accepted: the session really is where it was dropped.
    assert result["session"]["room_id"] == str(ids["main"])
    assert result["session"]["status"] == "scheduled"

    rooms = [row for row in result["conflicts"] if row["kind"] == "room"]
    assert len(rooms) == 1
    assert rooms[0]["severity"] == "hard"
    assert rooms[0]["label"] == "Main stage"
    assert sorted(rooms[0]["session_ids"]) == sorted([str(ids["talk0"]), str(ids["talk2"])])


async def test_one_speaker_in_two_rooms_is_a_hard_conflict(
    client: AsyncClient, grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]]
) -> None:
    headers, event, ids = grid

    await _place(client, headers, event, ids["talk0"], room=ids["main"], day=ids["day"], at=NINE_AM)
    result = await _place(
        client,
        headers,
        event,
        ids["talk1"],
        room=ids["side"],
        day=ids["day"],
        at=NINE_AM + timedelta(minutes=10),
    )

    speakers = [row for row in result["conflicts"] if row["kind"] == "speaker"]
    assert len(speakers) == 1
    assert speakers[0]["severity"] == "hard"
    assert speakers[0]["label"] == "Rosa Lindqvist"


async def test_a_track_collision_is_soft_and_can_be_switched_off(
    client: AsyncClient,
    session: AsyncSession,
    grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]],
) -> None:
    """Some organisers overlap tracks deliberately, so the event decides."""
    headers, event, ids = grid

    await _place(client, headers, event, ids["talk0"], room=ids["main"], day=ids["day"], at=NINE_AM)
    result = await _place(
        client,
        headers,
        event,
        ids["talk2"],
        room=ids["side"],
        day=ids["day"],
        at=NINE_AM + timedelta(minutes=10),
    )
    tracks = [row for row in result["conflicts"] if row["kind"] == "track"]
    assert len(tracks) == 1
    assert tracks[0]["severity"] == "soft"

    with tenancy_disabled():
        row = await session.get(Event, event.id)
        assert row is not None
        row.soft_conflicts_enabled = False
        await session.commit()

    after = await client.get(f"/v1/events/{event.id}/conflicts", headers=headers)
    assert [row for row in after.json() if row["kind"] == "track"] == []


async def test_dismissing_a_conflict_needs_a_reason_and_then_hides_it(
    client: AsyncClient, grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]]
) -> None:
    headers, event, ids = grid
    await _place(client, headers, event, ids["talk0"], room=ids["main"], day=ids["day"], at=NINE_AM)
    result = await _place(
        client,
        headers,
        event,
        ids["talk2"],
        room=ids["main"],
        day=ids["day"],
        at=NINE_AM + timedelta(minutes=15),
    )
    key = next(row["conflict_key"] for row in result["conflicts"] if row["kind"] == "room")

    without_reason = await client.post(
        f"/v1/events/{event.id}/conflicts/dismiss", headers=headers, json={"conflict_key": key}
    )
    dismissed = await client.post(
        f"/v1/events/{event.id}/conflicts/dismiss",
        headers=headers,
        json={"conflict_key": key, "reason": "The second talk moved to the foyer."},
    )

    assert without_reason.status_code == 422
    assert dismissed.status_code == 200
    assert [row for row in dismissed.json() if row["conflict_key"] == key] == []


async def test_a_dismissal_reappears_once_the_conflict_actually_changes(
    client: AsyncClient, grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]]
) -> None:
    """The key is derived from the participants, so an unrelated edit keeps the
    dismissal and a real change brings the warning back."""
    headers, event, ids = grid
    await _place(client, headers, event, ids["talk0"], room=ids["main"], day=ids["day"], at=NINE_AM)
    clash = await _place(
        client,
        headers,
        event,
        ids["talk2"],
        room=ids["main"],
        day=ids["day"],
        at=NINE_AM + timedelta(minutes=15),
    )
    key = next(row["conflict_key"] for row in clash["conflicts"] if row["kind"] == "room")
    await client.post(
        f"/v1/events/{event.id}/conflicts/dismiss",
        headers=headers,
        json={"conflict_key": key, "reason": "Deliberate."},
    )

    # A third session dropped on top of the same pair is a genuinely different
    # conflict, so it must not inherit the dismissal.
    after = await _place(
        client,
        headers,
        event,
        ids["talk1"],
        room=ids["main"],
        day=ids["day"],
        at=NINE_AM + timedelta(minutes=10),
    )

    rooms = [row for row in after["conflicts"] if row["kind"] == "room"]
    assert key not in [row["conflict_key"] for row in rooms]
    assert len(rooms) == 2


async def test_unscheduling_returns_a_session_to_the_tray(
    client: AsyncClient, grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]]
) -> None:
    headers, event, ids = grid
    await _place(client, headers, event, ids["talk0"], room=ids["main"], day=ids["day"], at=NINE_AM)

    response = await client.post(
        f"/v1/events/{event.id}/sessions/{ids['talk0']}/unschedule", headers=headers
    )

    assert response.status_code == 200
    assert response.json()["session"]["starts_at"] is None
    assert response.json()["session"]["status"] == "unscheduled"

    draft = await client.get(f"/v1/events/{event.id}/schedule/draft", headers=headers)
    assert str(ids["talk0"]) in [row["id"] for row in draft.json()["unscheduled"]]


async def test_a_locked_session_refuses_to_move(
    client: AsyncClient,
    session: AsyncSession,
    grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]],
) -> None:
    """The one refusal on this endpoint, and it is an organiser's instruction
    rather than a judgement about the schedule."""
    headers, event, ids = grid
    with tenancy_disabled():
        talk = await session.get(Session, ids["talk0"])
        assert talk is not None
        talk.is_locked = True
        await session.commit()

    response = await client.patch(
        f"/v1/events/{event.id}/sessions/{ids['talk0']}/placement",
        headers=headers,
        json={
            "event_day_id": str(ids["day"]),
            "room_id": str(ids["main"]),
            "starts_at": NINE_AM.isoformat(),
        },
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SESSION_LOCKED"


async def test_the_draft_returns_the_whole_grid_in_one_request(
    client: AsyncClient, grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]]
) -> None:
    headers, event, ids = grid
    await _place(client, headers, event, ids["talk0"], room=ids["main"], day=ids["day"], at=NINE_AM)

    response = await client.get(f"/v1/events/{event.id}/schedule/draft", headers=headers)

    body = response.json()
    assert [room["name"] for room in body["rooms"]] == ["Main stage", "Workshop room"]
    assert len(body["days"]) == 1
    assert len(body["scheduled"]) == 1
    assert len(body["unscheduled"]) == 2


async def test_publishing_over_a_double_booking_takes_a_deliberate_acknowledgement(
    client: AsyncClient, grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]]
) -> None:
    """Not a block. Organisers do publish over a known clash, but never by
    accident, so the first attempt refuses and names the count."""
    headers, event, ids = grid
    await _place(client, headers, event, ids["talk0"], room=ids["main"], day=ids["day"], at=NINE_AM)
    await _place(
        client,
        headers,
        event,
        ids["talk2"],
        room=ids["main"],
        day=ids["day"],
        at=NINE_AM + timedelta(minutes=15),
    )

    refused = await client.post(f"/v1/events/{event.id}/schedule/publish", headers=headers, json={})
    allowed = await client.post(
        f"/v1/events/{event.id}/schedule/publish",
        headers=headers,
        json={"acknowledge_conflicts": True},
    )

    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "UNRESOLVED_CONFLICTS"
    assert refused.json()["error"]["details"]["count"] == 1
    assert allowed.status_code == 201


async def test_a_dismissed_conflict_no_longer_blocks_publishing(
    client: AsyncClient, grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]]
) -> None:
    headers, event, ids = grid
    await _place(client, headers, event, ids["talk0"], room=ids["main"], day=ids["day"], at=NINE_AM)
    clash = await _place(
        client,
        headers,
        event,
        ids["talk2"],
        room=ids["main"],
        day=ids["day"],
        at=NINE_AM + timedelta(minutes=15),
    )
    key = next(row["conflict_key"] for row in clash["conflicts"] if row["kind"] == "room")
    await client.post(
        f"/v1/events/{event.id}/conflicts/dismiss",
        headers=headers,
        json={"conflict_key": key, "reason": "Second talk moved to the foyer."},
    )

    response = await client.post(
        f"/v1/events/{event.id}/schedule/publish", headers=headers, json={}
    )

    assert response.status_code == 201


async def _approve_and_publish(
    client: AsyncClient, headers: dict[str, str], event: Event, **body: object
) -> dict[str, object]:
    sessions = await client.get(f"/v1/events/{event.id}/sessions", headers=headers)
    for row in sessions.json():
        await client.post(
            f"/v1/events/{event.id}/sessions/{row['id']}/approval",
            headers=headers,
            json={"content_status": "approved"},
        )
    response = await client.post(
        f"/v1/events/{event.id}/schedule/publish",
        headers=headers,
        json={"acknowledge_conflicts": True, **body},
    )
    assert response.status_code == 201, response.text
    return response.json()  # type: ignore[no-any-return]


async def test_only_speakers_whose_slot_moved_are_emailed(
    client: AsyncClient,
    session: AsyncSession,
    grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]],
) -> None:
    """Publishing a tidy-up must not mail everyone. Rosa is on talk0 and talk1;
    moving only talk0 should reach her once and nobody else."""
    headers, event, ids = grid
    await _place(client, headers, event, ids["talk0"], room=ids["main"], day=ids["day"], at=NINE_AM)
    await _place(
        client,
        headers,
        event,
        ids["talk2"],
        room=ids["side"],
        day=ids["day"],
        at=NINE_AM + timedelta(hours=2),
    )
    first = await _approve_and_publish(client, headers, event, notify_affected=True)
    assert first["notified"] == 1

    # Republishing with nothing changed must email nobody at all.
    unchanged = await _approve_and_publish(client, headers, event, notify_affected=True)
    assert unchanged["notified"] == 0

    # Now move one session; only its speaker hears about it.
    await _place(
        client,
        headers,
        event,
        ids["talk0"],
        room=ids["main"],
        day=ids["day"],
        at=NINE_AM + timedelta(minutes=45),
    )
    after = await _approve_and_publish(client, headers, event, notify_affected=True)

    assert after["notified"] == 1
    with tenancy_disabled():
        messages = (
            (
                await session.execute(
                    select(Message)
                    .where(Message.ics_attached.is_(True))
                    .order_by(Message.created_at)
                )
            )
            .scalars()
            .all()
        )
    latest = messages[-1]
    assert "Previously" in latest.body_rendered
    assert "BEGIN:VCALENDAR" in latest.body_rendered


async def test_publishing_without_the_flag_emails_nobody(
    client: AsyncClient,
    session: AsyncSession,
    grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]],
) -> None:
    """Deciding to publish is not deciding to notify, the same separation the
    product draws everywhere else."""
    headers, event, ids = grid
    await _place(client, headers, event, ids["talk0"], room=ids["main"], day=ids["day"], at=NINE_AM)

    result = await _approve_and_publish(client, headers, event)

    assert result["notified"] == 0


async def test_the_calendar_entry_keeps_one_uid_and_climbs_the_sequence() -> None:
    """A stable UID is what makes a speaker's calendar update the entry it already
    has instead of growing a second one on every republish."""
    from app.features.publishing import ics

    talk = {
        "id": "8f14e45f-ceea-467a-9c3a-1b2c3d4e5f60",
        "title": "Serving LLMs; on spot fleets, without tears",
        "starts_at": "2027-05-12T09:00:00+00:00",
        "duration_minutes": 45,
        "room": "Main stage",
        "speakers": [{"name": "Rosa Lindqvist"}],
        "abstract": "A talk.",
    }
    event = {"name": "DevFlow", "location": "Fort Mason"}
    now = datetime(2027, 1, 1, tzinfo=UTC)

    first = ics.build(talk, event=event, sequence=1, now=now)
    second = ics.build(talk, event=event, sequence=2, now=now)

    uid = f"UID:{ics.uid_for(str(talk['id']))}"
    assert uid in first
    assert uid in second
    assert "SEQUENCE:1" in first
    assert "SEQUENCE:2" in second
    # Semicolons and commas in a title are separators in RFC 5545 and have to be
    # escaped, or the entry parses as several broken properties.
    assert r"Serving LLMs\; on spot fleets\, without tears" in first
    assert "DTEND:20270512T094500Z" in first


async def test_editing_a_session_keeps_its_public_url(
    client: AsyncClient, grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]]
) -> None:
    headers, event, ids = grid
    before = await client.get(f"/v1/events/{event.id}/sessions", headers=headers)
    slug = next(row["slug"] for row in before.json() if row["id"] == str(ids["talk0"]))

    response = await client.patch(
        f"/v1/events/{event.id}/sessions/{ids['talk0']}",
        headers=headers,
        json={"title": "Opening keynote, revised"},
    )

    assert response.status_code == 200
    assert response.json()["title"] == "Opening keynote, revised"
    # A published schedule puts the slug in inboxes and calendar entries.
    assert response.json()["slug"] == slug


async def test_a_patch_sets_facets_and_an_explicit_null_clears_the_track(
    client: AsyncClient, grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]]
) -> None:
    headers, event, ids = grid

    await client.patch(
        f"/v1/events/{event.id}/sessions/{ids['talk1']}",
        headers=headers,
        json={
            "tags": ["Kubernetes", "kubernetes ", "Cost"],
            "expertise_level": "advanced",
            "language": "English",
            "track_id": None,
        },
    )

    rows = (await client.get(f"/v1/events/{event.id}/sessions", headers=headers)).json()
    edited = next(row for row in rows if row["id"] == str(ids["talk1"]))
    # Case- and whitespace-duplicates collapse, or the public filter grows a
    # checkbox per typo.
    assert edited["tags"] == ["Kubernetes", "Cost"]
    assert edited["expertise_level"] == "advanced"
    assert edited["language"] == "English"
    assert edited["track_id"] is None


async def test_a_locked_session_keeps_its_length_but_not_its_typos(
    client: AsyncClient,
    session: AsyncSession,
    grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]],
) -> None:
    """Locking pins a session's footprint on the grid. It was never a reason to
    make an organiser live with a misspelled title."""
    headers, event, ids = grid
    with tenancy_disabled():
        talk = await session.get(Session, ids["talk2"])
        assert talk is not None
        talk.is_locked = True
        await session.commit()

    refused = await client.patch(
        f"/v1/events/{event.id}/sessions/{ids['talk2']}",
        headers=headers,
        json={"duration_minutes": 60},
    )
    allowed = await client.patch(
        f"/v1/events/{event.id}/sessions/{ids['talk2']}",
        headers=headers,
        json={"abstract": "Now with an abstract."},
    )

    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "SESSION_LOCKED"
    assert allowed.status_code == 200


async def test_patching_a_session_that_is_not_in_this_event_is_a_404(
    client: AsyncClient, grid: tuple[dict[str, str], Event, dict[str, uuid.UUID]]
) -> None:
    headers, event, _ids = grid

    response = await client.patch(
        f"/v1/events/{event.id}/sessions/{uuid.uuid4()}",
        headers=headers,
        json={"title": "Nowhere"},
    )

    assert response.status_code == 404
