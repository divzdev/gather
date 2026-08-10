"""Snapshot publishing and the five public surfaces.

Two properties carry the weight: nothing unapproved ever reaches the public site,
and the surfaces cannot disagree with each other because they are all views over
one published document.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.tenancy import tenancy_disabled
from app.models import (
    ContentStatus,
    Event,
    EventDay,
    EventStatus,
    Organization,
    OrgMember,
    Role,
    Room,
    Session,
    SessionSpeaker,
    Speaker,
    Track,
    User,
)

PASSWORD = "correct horse battery staple"


@dataclass
class World:
    headers: dict[str, str]
    event: Event
    sessions: list[uuid.UUID]
    day: str


@pytest.fixture
async def world(client: AsyncClient, session: AsyncSession) -> World:
    suffix = uuid.uuid4().hex[:8]
    day_date = datetime(2027, 5, 12).date()
    with tenancy_disabled():
        org = Organization(name=f"Org {suffix}", slug=f"org-{suffix}")
        session.add(org)
        await session.flush()
        event = Event(
            org_id=org.id,
            name="DevFlow Conf 2027",
            slug=f"devflow-{suffix}",
            timezone="UTC",
            starts_on=day_date,
            ends_on=datetime(2027, 5, 14).date(),
            status=EventStatus.SCHEDULED,
            cfp_closes_at=datetime.now(UTC) + timedelta(days=1),
        )
        session.add(event)
        await session.flush()

        common = {"org_id": org.id, "event_id": event.id}
        day = EventDay(**common, day_date=day_date, label="Day 1")
        room_a = Room(**common, name="Main Stage", sort_order=0)
        room_b = Room(**common, name="Room 2A", sort_order=1)
        track = Track(**common, name="AI Engineering", hue_index=1)
        session.add_all([day, room_a, room_b, track])

        user = User(
            email=f"admin-{suffix}@example.com",
            name="Jordan Alvarez",
            password_hash=hash_password(PASSWORD),
        )
        session.add(user)
        await session.flush()
        session.add(OrgMember(org_id=org.id, user_id=user.id, role=Role.OWNER))

        # Surnames deliberately out of alphabetical order to prove the sort.
        people = []
        for name, company in (
            ("Priya Raman", "Latticework"),
            ("Marcus Okafor", "Cloudreach"),
            ("Ada Byron", "Analytical"),
        ):
            speaker = Speaker(
                org_id=org.id,
                email=f"{name.split()[0].lower()}-{suffix}@example.com",
                name=name,
                company=company,
                bio=f"{name} does things.",
            )
            session.add(speaker)
            people.append(speaker)
        await session.flush()

        ids = []
        for index, (title, speaker) in enumerate(
            [("Taming CI", people[0]), ("Agents That Ship", people[1]), ("Hidden Talk", people[2])]
        ):
            talk = Session(
                **common,
                title=title,
                slug=f"{title.lower().replace(' ', '-')}-{suffix}",
                abstract=f"About {title}.",
                duration_minutes=30,
                track_id=track.id,
                event_day_id=day.id,
                room_id=room_a.id if index == 0 else room_b.id,
                starts_at=datetime(2027, 5, 12, 10 + index, 0, tzinfo=UTC),
                # The third stays pending, so it must never appear publicly.
                content_status=ContentStatus.APPROVED if index < 2 else ContentStatus.PENDING,
            )
            session.add(talk)
            await session.flush()
            session.add(SessionSpeaker(**common, session_id=talk.id, speaker_id=speaker.id))
            ids.append(talk.id)
        await session.commit()

    login = await client.post("/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    return World(
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
        event=event,
        sessions=ids,
        day=day_date.isoformat(),
    )


async def _publish(client: AsyncClient, world: World) -> int:
    response = await client.post(
        f"/v1/events/{world.event.id}/schedule/publish", json={}, headers=world.headers
    )
    return int(response.json()["version"])


async def test_public_surfaces_404_before_anything_is_published(
    client: AsyncClient, world: World
) -> None:
    """An unpublished event has no public schedule, rather than an empty one."""
    response = await client.get(f"/v1/public/events/{world.event.slug}/schedule")

    assert response.status_code == 404


async def test_publishing_reports_what_it_included(client: AsyncClient, world: World) -> None:
    response = await client.post(
        f"/v1/events/{world.event.id}/schedule/publish",
        json={"note": "First cut"},
        headers=world.headers,
    )

    body = response.json()
    assert body["version"] == 1
    assert body["sessions"] == 2  # the pending one is excluded
    assert body["speakers"] == 2


@pytest.mark.parametrize("path", ["schedule", "agenda", "speakers", "gallery", "itinerary"])
async def test_every_surface_is_reachable_with_no_login(
    client: AsyncClient, world: World, path: str
) -> None:
    await _publish(client, world)

    response = await client.get(f"/v1/public/events/{world.event.slug}/{path}")

    assert response.status_code == 200
    assert "authorization" not in {k.lower() for k in response.request.headers}


async def test_unapproved_content_never_reaches_a_public_surface(
    client: AsyncClient, world: World
) -> None:
    await _publish(client, world)

    for path in ("schedule", "agenda", "speakers", "gallery"):
        response = await client.get(f"/v1/public/events/{world.event.slug}/{path}")
        assert "Hidden Talk" not in response.text, path
        assert "Ada Byron" not in response.text, path


async def test_approving_then_republishing_reveals_it(client: AsyncClient, world: World) -> None:
    await _publish(client, world)
    await client.post(
        f"/v1/events/{world.event.id}/sessions/{world.sessions[2]}/approval",
        json={"content_status": "approved"},
        headers=world.headers,
    )

    stale = await client.get(f"/v1/public/events/{world.event.slug}/schedule")
    assert "Hidden Talk" not in stale.text  # not until it is republished

    await _publish(client, world)
    fresh = await client.get(f"/v1/public/events/{world.event.slug}/schedule")
    assert "Hidden Talk" in fresh.text


async def test_editing_a_session_does_not_change_the_public_site_until_publish(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """The snapshot is the point: an organizer mid-edit is invisible to the world."""
    await _publish(client, world)

    with tenancy_disabled():
        talk = await session.get(Session, world.sessions[0])
        assert talk is not None
        talk.title = "Renamed Mid-Edit"
        await session.commit()

    before = await client.get(f"/v1/public/events/{world.event.slug}/schedule")
    assert "Taming CI" in before.text
    assert "Renamed Mid-Edit" not in before.text

    await _publish(client, world)
    after = await client.get(f"/v1/public/events/{world.event.slug}/schedule")
    assert "Renamed Mid-Edit" in after.text


async def test_speakers_are_ordered_by_surname(client: AsyncClient, world: World) -> None:
    await _publish(client, world)

    response = await client.get(f"/v1/public/events/{world.event.slug}/speakers")

    # Okafor before Raman, and Byron is absent because their talk is unapproved.
    assert [p["name"] for p in response.json()["speakers"]] == [
        "Marcus Okafor",
        "Priya Raman",
    ]


async def test_the_agenda_groups_by_day_and_orders_by_time(
    client: AsyncClient, world: World
) -> None:
    await _publish(client, world)

    response = await client.get(f"/v1/public/events/{world.event.slug}/agenda")

    body = response.json()
    assert [r["name"] for r in body["rooms"]] == ["Main Stage", "Room 2A"]
    day = next(d for d in body["days"] if d["date"] == world.day)
    assert [s["title"] for s in day["sessions"]] == ["Taming CI", "Agents That Ship"]
    assert body["unscheduled"] == []


async def test_surfaces_agree_with_each_other(client: AsyncClient, world: World) -> None:
    """The consistency guarantee — one document behind every view."""
    await _publish(client, world)

    listed = (await client.get(f"/v1/public/events/{world.event.slug}/schedule")).json()
    agenda = (await client.get(f"/v1/public/events/{world.event.slug}/agenda")).json()
    first = listed["sessions"][0]
    same = next(s for d in agenda["days"] for s in d["sessions"] if s["id"] == first["id"])

    assert (same["title"], same["starts_at"], same["room"]) == (
        first["title"],
        first["starts_at"],
        first["room"],
    )
    detail = await client.get(f"/v1/public/events/{world.event.slug}/schedule/{first['slug']}")
    assert detail.json()["session"]["title"] == first["title"]


async def test_sessions_can_be_filtered(client: AsyncClient, world: World) -> None:
    await _publish(client, world)

    by_query = await client.get(f"/v1/public/events/{world.event.slug}/schedule?q=agents")
    by_track = await client.get(
        f"/v1/public/events/{world.event.slug}/schedule?track=AI%20Engineering"
    )
    by_missing = await client.get(
        f"/v1/public/events/{world.event.slug}/schedule?track=Nonexistent"
    )

    assert [s["title"] for s in by_query.json()["sessions"]] == ["Agents That Ship"]
    assert len(by_track.json()["sessions"]) == 2
    assert by_missing.json()["sessions"] == []


async def test_itinerary_builds_a_personal_schedule_and_flags_clashes(
    client: AsyncClient, world: World
) -> None:
    await _publish(client, world)
    listed = (await client.get(f"/v1/public/events/{world.event.slug}/schedule")).json()
    ids = ",".join(s["id"] for s in listed["sessions"])

    response = await client.get(f"/v1/public/events/{world.event.slug}/itinerary?session_ids={ids}")

    body = response.json()
    assert body["count"] == 2
    assert body["clashes"] == []  # the two are at different times


async def test_an_empty_itinerary_is_valid(client: AsyncClient, world: World) -> None:
    await _publish(client, world)

    response = await client.get(f"/v1/public/events/{world.event.slug}/itinerary")

    assert response.status_code == 200
    assert response.json()["count"] == 0


async def test_gallery_reports_a_session_count_per_speaker(
    client: AsyncClient, world: World
) -> None:
    await _publish(client, world)

    response = await client.get(f"/v1/public/events/{world.event.slug}/gallery")

    assert all(p["session_count"] == 1 for p in response.json()["speakers"])


async def test_speaker_detail_lists_their_sessions(client: AsyncClient, world: World) -> None:
    await _publish(client, world)
    listed = (await client.get(f"/v1/public/events/{world.event.slug}/speakers")).json()
    speaker_id = listed["speakers"][0]["id"]

    response = await client.get(f"/v1/public/events/{world.event.slug}/speakers/{speaker_id}")

    assert response.status_code == 200
    assert len(response.json()["speaker"]["sessions"]) == 1


async def test_unknown_slugs_are_404(client: AsyncClient, world: World) -> None:
    await _publish(client, world)

    assert (
        await client.get(f"/v1/public/events/{world.event.slug}/schedule/nope")
    ).status_code == 404
    assert (
        await client.get(f"/v1/public/events/{world.event.slug}/speakers/{uuid.uuid4()}")
    ).status_code == 404


async def test_diff_describes_what_publishing_would_change(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    await _publish(client, world)

    with tenancy_disabled():
        talk = await session.get(Session, world.sessions[0])
        assert talk is not None
        talk.starts_at = datetime(2027, 5, 12, 16, 0, tzinfo=UTC)
        await session.commit()

    response = await client.get(f"/v1/events/{world.event.id}/schedule/diff", headers=world.headers)

    body = response.json()
    assert body["has_changes"] is True
    assert [m["title"] for m in body["moved"]] == ["Taming CI"]


async def test_diff_is_quiet_when_nothing_changed(client: AsyncClient, world: World) -> None:
    await _publish(client, world)

    response = await client.get(f"/v1/events/{world.event.id}/schedule/diff", headers=world.headers)

    assert response.json()["has_changes"] is False


async def test_rollback_republishes_an_earlier_version(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """History is added to, never destroyed."""
    await _publish(client, world)

    with tenancy_disabled():
        talk = await session.get(Session, world.sessions[0])
        assert talk is not None
        talk.title = "Version Two Title"
        await session.commit()
    await _publish(client, world)
    assert (
        "Version Two Title"
        in (await client.get(f"/v1/public/events/{world.event.slug}/schedule")).text
    )

    restored = await client.post(
        f"/v1/events/{world.event.id}/schedule/rollback",
        json={"version": 1},
        headers=world.headers,
    )

    assert restored.json() == {"version": 3, "restored_from": 1}
    public = await client.get(f"/v1/public/events/{world.event.slug}/schedule")
    assert "Taming CI" in public.text
    assert "Version Two Title" not in public.text


async def test_versions_are_listed_newest_first(client: AsyncClient, world: World) -> None:
    await _publish(client, world)
    await _publish(client, world)

    response = await client.get(
        f"/v1/events/{world.event.id}/schedule/versions", headers=world.headers
    )

    assert [v["version"] for v in response.json()] == [2, 1]


async def test_a_coordinator_cannot_publish(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        event = await session.get(Event, world.event.id)
        assert event is not None
        user = User(
            email=f"coord-{suffix}@example.com",
            name="Coordinator",
            password_hash=hash_password(PASSWORD),
        )
        session.add(user)
        await session.flush()
        session.add(OrgMember(org_id=event.org_id, user_id=user.id, role=Role.COORDINATOR))
        await session.commit()
    login = await client.post("/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = await client.post(
        f"/v1/events/{world.event.id}/schedule/publish", json={}, headers=headers
    )

    assert response.status_code == 403


async def test_the_embed_serves_a_script_anyone_can_run(client: AsyncClient, world: World) -> None:
    """One script tag, no build step, and reachable with no credentials at all."""
    await _publish(client, world)

    response = await client.get(f"/v1/public/events/{world.event.slug}/embed.js?widget=schedule")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/javascript")
    assert response.headers["access-control-allow-origin"] == "*"
    # A minute, not the incumbent's hour: an embed is correct the moment you publish.
    assert response.headers["cache-control"] == "public, max-age=60"
    assert "gather-schedule" in response.text


async def test_the_embed_never_writes_untrusted_text_as_markup(
    client: AsyncClient, world: World
) -> None:
    """It runs inside somebody else's page, so a session title has to reach the
    DOM as characters. The script uses textContent and never innerHTML."""
    await _publish(client, world)

    response = await client.get(f"/v1/public/events/{world.event.slug}/embed.js")

    assert "innerHTML" not in response.text
    assert "textContent" in response.text
    # A closing tag inside the JSON payload would end the host page's script early.
    assert "</script>" not in response.text


async def test_an_unknown_widget_is_refused(client: AsyncClient, world: World) -> None:
    await _publish(client, world)

    response = await client.get(f"/v1/public/events/{world.event.slug}/embed.js?widget=payroll")

    assert response.status_code == 404
