"""Who cannot be in two places at once, and which rooms cannot hold two talks.

Three classes. `room` and `speaker` are hard: physics. `track` is soft, because
some organisers overlap tracks deliberately and an event can switch it off.

Overlap is half-open — `[start, start + duration)` — so a session ending exactly
as the next begins is a clean handover, not a clash. Getting that wrong makes a
correctly built agenda look broken in every back-to-back slot.

The scan buckets by the thing that can collide (a room, a speaker, a track) and
sweeps each bucket in start order, so the cost is sorting rather than comparing
every session with every other one.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ConflictKind,
    Room,
    RoomBlackout,
    Session,
    SessionSpeaker,
    Speaker,
    Track,
)

HARD = (ConflictKind.ROOM, ConflictKind.SPEAKER)


@dataclass(frozen=True, slots=True)
class Conflict:
    conflict_key: str
    kind: ConflictKind
    label: str
    starts_at: datetime
    ends_at: datetime
    session_ids: tuple[uuid.UUID, ...]

    @property
    def is_hard(self) -> bool:
        return self.kind in HARD


@dataclass(slots=True)
class Placed:
    """One session reduced to what a collision actually depends on."""

    id: uuid.UUID
    title: str
    starts_at: datetime
    duration_minutes: int
    room_id: uuid.UUID | None
    track_id: uuid.UUID | None
    speaker_ids: list[uuid.UUID] = field(default_factory=list)

    @property
    def ends_at(self) -> datetime:
        return self.starts_at + timedelta(minutes=self.duration_minutes)


def overlaps(left: Placed, right: Placed) -> bool:
    return left.starts_at < right.ends_at and right.starts_at < left.ends_at


def build_key(kind: ConflictKind, scope: str, session_ids: tuple[uuid.UUID, ...]) -> str:
    """Order-independent, so a dismissal survives an unrelated edit.

    Re-deriving it from the participants means moving one of the two sessions
    changes the key, and the dismissal correctly stops applying.
    """
    parts = ":".join(sorted(str(value) for value in session_ids))
    digest = hashlib.sha1(f"{kind.value}:{scope}:{parts}".encode(), usedforsecurity=False)
    return f"{kind.value}-{digest.hexdigest()[:24]}"


async def load_placed(session: AsyncSession) -> list[Placed]:
    rows = (
        (
            await session.execute(
                select(Session).where(Session.starts_at.is_not(None)).order_by(Session.starts_at)
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return []

    placed = {
        row.id: Placed(
            id=row.id,
            title=row.title,
            starts_at=row.starts_at,  # type: ignore[arg-type]  # filtered non-null above
            duration_minutes=row.duration_minutes,
            room_id=row.room_id,
            track_id=row.track_id,
        )
        for row in rows
    }
    links = (
        (
            await session.execute(
                select(SessionSpeaker.session_id, SessionSpeaker.speaker_id).where(
                    SessionSpeaker.session_id.in_(list(placed))
                )
            )
        )
        .tuples()
        .all()
    )
    for session_id, speaker_id in links:
        placed[session_id].speaker_ids.append(speaker_id)
    return list(placed.values())


def _sweep(
    kind: ConflictKind, buckets: dict[uuid.UUID, list[Placed]], names: dict[uuid.UUID, str]
) -> list[Conflict]:
    """Every overlapping pair inside each bucket.

    Pairwise within a bucket rather than globally: two talks can only clash if
    they share a room, a speaker or a track, and each bucket is small.
    """
    found: list[Conflict] = []
    for scope_id, members in buckets.items():
        members.sort(key=lambda item: item.starts_at)
        for index, earlier in enumerate(members):
            for later in members[index + 1 :]:
                # Sorted by start, so once one begins after this ends, so does
                # everything after it.
                if later.starts_at >= earlier.ends_at:
                    break
                if not overlaps(earlier, later):
                    continue
                pair = (earlier.id, later.id)
                found.append(
                    Conflict(
                        conflict_key=build_key(kind, str(scope_id), pair),
                        kind=kind,
                        label=names.get(scope_id, "Unknown"),
                        starts_at=max(earlier.starts_at, later.starts_at),
                        ends_at=min(earlier.ends_at, later.ends_at),
                        session_ids=pair,
                    )
                )
    return found


def _bucket(placed: list[Placed], key: str) -> dict[uuid.UUID, list[Placed]]:
    buckets: dict[uuid.UUID, list[Placed]] = {}
    for item in placed:
        scope = getattr(item, key)
        if scope is not None:
            buckets.setdefault(scope, []).append(item)
    return buckets


async def detect(session: AsyncSession, *, soft_enabled: bool = True) -> list[Conflict]:
    placed = await load_placed(session)
    if not placed:
        return []

    rooms = dict((await session.execute(select(Room.id, Room.name))).tuples().all())
    tracks = dict((await session.execute(select(Track.id, Track.name))).tuples().all())
    speakers = dict((await session.execute(select(Speaker.id, Speaker.name))).tuples().all())

    by_speaker: dict[uuid.UUID, list[Placed]] = {}
    for item in placed:
        for speaker_id in item.speaker_ids:
            by_speaker.setdefault(speaker_id, []).append(item)

    found = [
        *_sweep(ConflictKind.ROOM, _bucket(placed, "room_id"), rooms),
        *_sweep(ConflictKind.SPEAKER, by_speaker, speakers),
        *await _blackouts(session, placed, rooms),
    ]
    if soft_enabled:
        found.extend(_sweep(ConflictKind.TRACK, _bucket(placed, "track_id"), tracks))
    return found


async def _blackouts(
    session: AsyncSession, placed: list[Placed], rooms: dict[uuid.UUID, str]
) -> list[Conflict]:
    """A room closed for maintenance is a hard room conflict with one session."""
    windows = (await session.execute(select(RoomBlackout))).scalars().all()
    if not windows:
        return []

    found: list[Conflict] = []
    for window in windows:
        for item in placed:
            if item.room_id != window.room_id:
                continue
            if not (item.starts_at < window.ends_at and window.starts_at < item.ends_at):
                continue
            found.append(
                Conflict(
                    conflict_key=build_key(ConflictKind.ROOM, f"blackout:{window.id}", (item.id,)),
                    kind=ConflictKind.ROOM,
                    label=f"{rooms.get(window.room_id, 'Room')} is closed"
                    + (f": {window.reason}" if window.reason else ""),
                    starts_at=max(item.starts_at, window.starts_at),
                    ends_at=min(item.ends_at, window.ends_at),
                    session_ids=(item.id,),
                )
            )
    return found
