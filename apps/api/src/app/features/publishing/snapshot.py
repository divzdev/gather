"""Building and publishing the public schedule snapshot.

Publishing writes an immutable, versioned JSON document. Every public surface
reads that one row and never joins a live table, which means a public page is one
indexed lookup and an organizer mid-edit is never visible to the world.

Rollback is republishing an earlier version, so no state is ever destroyed.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.models import (
    ContentStatus,
    Event,
    EventDay,
    PublishedSchedule,
    Room,
    Session,
    SessionSpeaker,
    Speaker,
    Track,
)


def _sort_key(name: str) -> str:
    """Surname, for the speaker directory. Falls back to the whole name."""
    parts = name.strip().split()
    return (parts[-1] if parts else name).casefold()


async def build(session: AsyncSession, event: Event) -> dict[str, Any]:
    """Denormalise the whole public payload.

    Only approved sessions are included: an unreviewed abstract must not reach the
    public site just because someone published the schedule.
    """
    days = list(
        (await session.execute(select(EventDay).order_by(EventDay.day_date))).scalars().all()
    )
    rooms = list((await session.execute(select(Room).order_by(Room.sort_order))).scalars().all())
    tracks = list((await session.execute(select(Track).order_by(Track.sort_order))).scalars().all())

    sessions = list(
        (
            await session.execute(
                select(Session)
                .where(Session.content_status == ContentStatus.APPROVED)
                .order_by(Session.starts_at.nullslast(), Session.title)
            )
        )
        .scalars()
        .all()
    )
    session_ids = [s.id for s in sessions]

    speakers_by_session: dict[uuid.UUID, list[dict[str, Any]]] = {}
    everyone: dict[uuid.UUID, Speaker] = {}
    if session_ids:
        for link, speaker in (
            (
                await session.execute(
                    select(SessionSpeaker, Speaker)
                    .join(Speaker, Speaker.id == SessionSpeaker.speaker_id)
                    .where(SessionSpeaker.session_id.in_(session_ids))
                    .order_by(SessionSpeaker.sort_order)
                )
            )
            .tuples()
            .all()
        ):
            everyone[speaker.id] = speaker
            speakers_by_session.setdefault(link.session_id, []).append(
                {
                    "id": str(speaker.id),
                    "name": speaker.name,
                    "company": speaker.company,
                    "job_title": speaker.job_title,
                    "role": link.role.value,
                }
            )

    track_names = {t.id: t.name for t in tracks}
    room_names = {r.id: r.name for r in rooms}
    day_dates = {d.id: d.day_date.isoformat() for d in days}

    return {
        "event": {
            "name": event.name,
            "slug": event.slug,
            "description": event.description,
            "location": event.location,
            "timezone": event.timezone,
            "starts_on": event.starts_on.isoformat(),
            "ends_on": event.ends_on.isoformat(),
        },
        "days": [
            {
                "id": str(d.id),
                "date": d.day_date.isoformat(),
                "label": d.label,
                "starts_at_local": d.starts_at_local.isoformat(),
                "ends_at_local": d.ends_at_local.isoformat(),
            }
            for d in days
        ],
        "rooms": [
            {"id": str(r.id), "name": r.name, "capacity": r.capacity} for r in rooms if r.is_active
        ],
        "tracks": [
            {"id": str(t.id), "name": t.name, "hue_index": t.hue_index}
            for t in tracks
            if t.is_public
        ],
        "sessions": [
            {
                "id": str(s.id),
                "slug": s.slug,
                "title": s.title,
                "abstract": s.abstract,
                "duration_minutes": s.duration_minutes,
                "starts_at": s.starts_at.isoformat() if s.starts_at else None,
                "day": day_dates.get(s.event_day_id) if s.event_day_id else None,
                "room": room_names.get(s.room_id) if s.room_id else None,
                "track": track_names.get(s.track_id) if s.track_id else None,
                "tags": s.tags,
                "expertise_level": s.expertise_level.value if s.expertise_level else None,
                "language": s.language,
                "speakers": speakers_by_session.get(s.id, []),
            }
            for s in sessions
        ],
        "speakers": [
            {
                "id": str(p.id),
                "name": p.name,
                "company": p.company,
                "job_title": p.job_title,
                "bio": p.bio,
                # The snapshot is the only thing public pages read, so a gallery
                # without this shows initials in a grey circle forever.
                "headshot_file_id": None if p.headshot_file_id is None else str(p.headshot_file_id),
                "links": p.links,
                "sessions": [
                    {"id": str(s.id), "slug": s.slug, "title": s.title}
                    for s in sessions
                    if any(sp["id"] == str(p.id) for sp in speakers_by_session.get(s.id, []))
                ],
            }
            # Alphabetical by surname, which is how a printed programme reads.
            for p in sorted(everyone.values(), key=lambda x: _sort_key(x.name))
        ],
    }


async def _next_version(session: AsyncSession, event: Event) -> int:
    """The next version number, allocated under a lock on the event row.

    Read-the-max-then-insert is a race, and this table has a unique index on
    (event_id, version) that turns the race into a 500. Two publishes a second
    apart are not hypothetical here: the console polls the version list while an
    organiser presses publish, and rolling back is itself a publish. Locking the
    event serialises publishes per event and leaves every other event alone.
    """
    await session.execute(select(Event.id).where(Event.id == event.id).with_for_update())
    highest = await session.scalar(
        select(func.max(PublishedSchedule.version)).where(PublishedSchedule.event_id == event.id)
    )
    return int(highest or 0) + 1


async def publish(
    session: AsyncSession, *, event: Event, user_id: uuid.UUID | None, note: str | None = None
) -> PublishedSchedule:
    published = PublishedSchedule(
        # Taken from the event rather than left to the tenancy session event,
        # so publishing works from the seeder too — which runs with tenancy
        # deliberately disabled and would otherwise insert a null org_id.
        org_id=event.org_id,
        event_id=event.id,
        version=await _next_version(session, event),
        snapshot=await build(session, event),
        published_at=datetime.now(UTC),
        published_by_user_id=user_id,
        note=note,
    )
    session.add(published)
    await session.flush()
    return published


async def latest(session: AsyncSession) -> PublishedSchedule | None:
    published: PublishedSchedule | None = await session.scalar(
        select(PublishedSchedule).order_by(PublishedSchedule.version.desc()).limit(1)
    )
    return published


async def require_latest(session: AsyncSession) -> dict[str, Any]:
    published = await latest(session)
    if published is None:
        raise NotFoundError("This event has not published a schedule yet.")
    return dict(published.snapshot)


async def rollback(
    session: AsyncSession, *, event: Event, version: int, user_id: uuid.UUID | None
) -> PublishedSchedule:
    """Republish an earlier snapshot as a new version rather than deleting history."""
    target = await session.scalar(
        select(PublishedSchedule).where(PublishedSchedule.version == version)
    )
    if target is None:
        raise NotFoundError(f"No published version {version}.")

    restored = PublishedSchedule(
        org_id=event.org_id,
        event_id=event.id,
        version=await _next_version(session, event),
        snapshot=dict(target.snapshot),
        published_at=datetime.now(UTC),
        published_by_user_id=user_id,
        note=f"Rolled back to version {version}",
    )
    session.add(restored)
    await session.flush()
    return restored


def diff(current: dict[str, Any], previous: dict[str, Any] | None) -> dict[str, Any]:
    """What changed since the last publish, in the terms an organizer thinks in."""
    before = {s["id"]: s for s in (previous or {}).get("sessions", [])}
    after = {s["id"]: s for s in current.get("sessions", [])}

    added = [after[i]["title"] for i in after.keys() - before.keys()]
    removed = [before[i]["title"] for i in before.keys() - after.keys()]
    moved, retimed, respoken = [], [], []

    for session_id in after.keys() & before.keys():
        old, new = before[session_id], after[session_id]
        if (old["starts_at"], old["room"]) != (new["starts_at"], new["room"]):
            moved.append(
                {
                    "title": new["title"],
                    "from": {"starts_at": old["starts_at"], "room": old["room"]},
                    "to": {"starts_at": new["starts_at"], "room": new["room"]},
                }
            )
        if old["duration_minutes"] != new["duration_minutes"]:
            retimed.append(new["title"])
        if [s["id"] for s in old["speakers"]] != [s["id"] for s in new["speakers"]]:
            respoken.append(new["title"])

    return {
        "added": sorted(added),
        "removed": sorted(removed),
        "moved": moved,
        "duration_changed": sorted(retimed),
        "speakers_changed": sorted(respoken),
        "has_changes": bool(added or removed or moved or retimed or respoken),
    }
