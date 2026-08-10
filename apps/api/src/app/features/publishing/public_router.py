"""The five public surfaces.

Sessions list, speakers list, agenda, itinerary and speaker gallery — all
anonymous, all reading the same published snapshot. Because every one of them is
a view over one document, they cannot disagree with each other: a session shows
identical times and speakers wherever it appears.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Query, Request, Response

from app.core import storage
from app.core.deps import DbSession, PublicEvent
from app.core.errors import NotFoundError
from app.features.publishing import embed, ics, snapshot
from app.models.file import File as FileRecord

router = APIRouter(prefix="/v1/public/events/{event_slug}", tags=["public"])


def _matches(session: dict[str, Any], track: str | None, day: str | None, q: str | None) -> bool:
    if track and session.get("track") != track:
        return False
    if day and session.get("day") != day:
        return False
    if q:
        haystack = " ".join(
            [
                session.get("title") or "",
                session.get("abstract") or "",
                *[s["name"] for s in session.get("speakers", [])],
            ]
        ).casefold()
        if q.casefold() not in haystack:
            return False
    return True


@router.get("/schedule")
async def sessions_list(
    event: PublicEvent,
    session: DbSession,
    track: str | None = Query(default=None),
    day: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=200),
) -> dict[str, Any]:
    """Every published session, filterable. The 'sessions list' widget."""
    data = await snapshot.require_latest(session)
    return {
        "event": data["event"],
        "tracks": data["tracks"],
        "days": data["days"],
        "sessions": [s for s in data["sessions"] if _matches(s, track, day, q)],
    }


@router.get("/schedule/{session_slug}")
async def session_detail(
    session_slug: str, event: PublicEvent, session: DbSession
) -> dict[str, Any]:
    data = await snapshot.require_latest(session)
    found = next((s for s in data["sessions"] if s["slug"] == session_slug), None)
    if found is None:
        raise NotFoundError("No such session.")
    return {"event": data["event"], "session": found}


@router.get("/agenda")
async def agenda(
    event: PublicEvent,
    session: DbSession,
    day: str | None = Query(default=None),
) -> dict[str, Any]:
    """Per-day grid: rooms across, time down. Unscheduled sessions are listed
    separately rather than silently dropped."""
    data = await snapshot.require_latest(session)
    days = [d for d in data["days"] if day is None or d["date"] == day]

    by_day: dict[str, list[dict[str, Any]]] = defaultdict(list)
    unscheduled = []
    for item in data["sessions"]:
        if item["day"] and item["starts_at"]:
            by_day[item["day"]].append(item)
        else:
            unscheduled.append(item)

    return {
        "event": data["event"],
        "rooms": data["rooms"],
        "tracks": data["tracks"],
        "days": [
            {
                **d,
                "sessions": sorted(
                    by_day.get(d["date"], []), key=lambda s: (s["starts_at"], s["room"] or "")
                ),
            }
            for d in days
        ],
        "unscheduled": unscheduled,
    }


@router.get("/itinerary")
async def itinerary(
    event: PublicEvent,
    session: DbSession,
    session_ids: str | None = Query(default=None, max_length=4000),
) -> dict[str, Any]:
    """A personal schedule built from ids the attendee picked.

    Held in the query string rather than server-side: an attendee should be able
    to share or bookmark their plan without an account.
    """
    data = await snapshot.require_latest(session)
    picked = {s.strip() for s in (session_ids or "").split(",") if s.strip()}
    chosen = [s for s in data["sessions"] if s["id"] in picked]

    clashes = []
    by_time: dict[str, list[str]] = defaultdict(list)
    for item in chosen:
        if item["starts_at"]:
            by_time[item["starts_at"]].append(item["title"])
    for starts_at, titles in by_time.items():
        if len(titles) > 1:
            clashes.append({"starts_at": starts_at, "sessions": sorted(titles)})

    return {
        "event": data["event"],
        "sessions": sorted(chosen, key=lambda s: (s["starts_at"] or "", s["title"])),
        "clashes": clashes,
        "count": len(chosen),
    }


@router.get("/speakers")
async def speakers_list(
    event: PublicEvent,
    session: DbSession,
    q: str | None = Query(default=None, max_length=200),
) -> dict[str, Any]:
    """The speaker directory, ordered by surname."""
    data = await snapshot.require_latest(session)
    people = data["speakers"]
    if q:
        needle = q.casefold()
        people = [
            p
            for p in people
            if needle in (p["name"] or "").casefold() or needle in (p["company"] or "").casefold()
        ]
    return {"event": data["event"], "speakers": people}


@router.get("/speakers/{speaker_id}")
async def speaker_detail(speaker_id: str, event: PublicEvent, session: DbSession) -> dict[str, Any]:
    data = await snapshot.require_latest(session)
    found = next((p for p in data["speakers"] if p["id"] == speaker_id), None)
    if found is None:
        raise NotFoundError("No such speaker.")
    return {"event": data["event"], "speaker": found}


@router.get("/gallery")
async def gallery(event: PublicEvent, session: DbSession) -> dict[str, Any]:
    """The speaker gallery: the same people, shaped for a grid of cards."""
    data = await snapshot.require_latest(session)
    return {
        "event": data["event"],
        "speakers": [
            {
                "id": p["id"],
                "name": p["name"],
                "company": p["company"],
                "job_title": p["job_title"],
                "session_count": len(p["sessions"]),
                "sessions": p["sessions"],
            }
            for p in data["speakers"]
        ],
    }


@router.get("/speakers/{file_id}/photo")
async def speaker_photo(file_id: uuid.UUID, event: PublicEvent, session: DbSession) -> Response:
    """A published speaker's headshot, to anyone.

    Deliberately narrow. It serves a file only when the latest published
    snapshot names it as a speaker's headshot, so knowing a file id is not
    enough to read a slide deck or anyone else's upload — the snapshot is the
    allow-list, which is the same rule every other public surface follows.
    """
    published = await snapshot.latest(session)
    if published is None:
        raise NotFoundError("Nothing is published for this event yet.")

    allowed = {
        person.get("headshot_file_id")
        for person in published.snapshot.get("speakers", [])
        if person.get("headshot_file_id")
    }
    if str(file_id) not in allowed:
        raise NotFoundError("No published photo with that id.")

    record = await session.get(FileRecord, file_id)
    if record is None:  # pragma: no cover - the snapshot named it a moment ago
        raise NotFoundError("No published photo with that id.")

    return Response(
        content=await storage.read(record.s3_key),
        media_type=record.content_type,
        headers={
            "Content-Disposition": f'inline; filename="{record.filename}"',
            # Immutable: replacing a headshot writes a new row at a new id.
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )


@router.get("/embed.js", response_class=Response)
async def embed_script(
    event: PublicEvent,
    request: Request,
    widget: str = Query(default="schedule"),
    theme: str = Query(default="light"),
    track: str | None = Query(default=None, max_length=80),
) -> Response:
    """The embeddable widget, as one self-contained script.

    Cached for a minute rather than an hour: the incumbent's embeds go stale for
    sixty minutes after a publish, and being correct immediately is the point.
    """
    if widget not in embed.WIDGETS:
        raise NotFoundError(f"No embed widget called {widget!r}.")

    origin = str(request.base_url).rstrip("/")
    body = embed.build_script(
        origin=origin,
        slug=event.slug,
        widget=widget,
        theme=theme if theme in embed.PALETTES else "light",
        track=track,
        mount=f"gather-{widget}",
    )
    return Response(
        content=body,
        media_type="application/javascript; charset=utf-8",
        headers={
            "Cache-Control": "public, max-age=60",
            # It is meant to be run by other people's pages; that is the feature.
            "Access-Control-Allow-Origin": "*",
        },
    )


def _calendar(body: str, filename: str) -> Response:
    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}.ics"',
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/schedule.ics")
async def whole_schedule_ics(event: PublicEvent, session: DbSession) -> Response:
    """The entire published programme as one calendar file.

    SEQUENCE is the published version, so re-importing after a republish updates
    every entry in place rather than duplicating the conference.
    """
    data = await snapshot.require_latest(session)
    latest = await snapshot.latest(session)
    version = latest.version if latest else 1
    now = datetime.now(UTC)

    events = [
        body
        for talk in data["sessions"]
        if (body := ics.build(talk, event=data["event"], sequence=version, now=now))
    ]
    if not events:
        raise NotFoundError("Nothing on this schedule has a time yet.")
    return _calendar(ics.merge(events), event.slug)


@router.get("/sessions/{session_slug}.ics")
async def session_ics(session_slug: str, event: PublicEvent, session: DbSession) -> Response:
    """One session, for the speaker or an attendee who wants only that talk."""
    data = await snapshot.require_latest(session)
    found = next((s for s in data["sessions"] if s["slug"] == session_slug), None)
    if found is None:
        raise NotFoundError("No such session.")

    latest = await snapshot.latest(session)
    body = ics.build(
        found,
        event=data["event"],
        sequence=latest.version if latest else 1,
        now=datetime.now(UTC),
    )
    if body == "":
        raise NotFoundError("That session has no time yet.")
    return _calendar(body, session_slug)
