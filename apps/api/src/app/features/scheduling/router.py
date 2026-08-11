"""Dropping a session onto the grid, and telling the truth about what it hit.

**A conflicting placement is always accepted.** The drop persists and the
response carries the resulting conflicts. A builder that refuses the drop is one
organisers fight: they park a session in a bad slot on purpose, then resolve it.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.core.deps import DbSession, bind_tenant, require_role
from app.core.errors import ApiError, NotFoundError
from app.core.tenancy import current_tenant, tenancy_disabled
from app.features.scheduling import conflicts as engine
from app.models import (
    ConflictDismissal,
    ConflictKind,
    Event,
    EventDay,
    Role,
    Room,
    ScheduleBlock,
    Session,
    SessionSpeaker,
    SessionStatus,
    Track,
    User,
)

router = APIRouter(
    prefix="/v1/events/{event_id}",
    tags=["scheduling"],
    dependencies=[Depends(bind_tenant)],
)

READ = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)
WRITE = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)


class ConflictRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conflict_key: str
    kind: ConflictKind
    severity: str
    label: str
    starts_at: datetime
    ends_at: datetime
    session_ids: list[uuid.UUID]


class PlacementUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_day_id: uuid.UUID
    room_id: uuid.UUID
    starts_at: datetime
    duration_minutes: int | None = Field(default=None, ge=5, le=600)


class PlacedSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    title: str
    # Carried so the grid can spot a speaker double-booking *before* the drop
    # lands. Without it the browser can only see room and track clashes, and the
    # speaker one is the clash organisers most want warning about.
    speaker_ids: list[uuid.UUID] = Field(default_factory=list)
    event_day_id: uuid.UUID | None
    room_id: uuid.UUID | None
    track_id: uuid.UUID | None
    starts_at: datetime | None
    duration_minutes: int
    status: SessionStatus
    is_locked: bool


class PlacementResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session: PlacedSession
    conflicts: list[ConflictRead]


class BulkPlacement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    placements: list[dict[str, object]] = Field(min_length=1, max_length=500)


class DismissRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conflict_key: str = Field(min_length=1, max_length=120)
    reason: str = Field(min_length=1, max_length=500)


class GridRoom(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    name: str
    sort_order: int


class GridDay(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    day_date: str
    starts_at_local: str
    ends_at_local: str
    label: str | None


class GridBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    event_day_id: uuid.UUID
    label: str
    starts_at: datetime
    duration_minutes: int
    spans_all_rooms: bool
    room_id: uuid.UUID | None


class Draft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    days: list[GridDay]
    rooms: list[GridRoom]
    tracks: list[dict[str, str]]
    blocks: list[GridBlock]
    scheduled: list[PlacedSession]
    unscheduled: list[PlacedSession]
    conflicts: list[ConflictRead]


def _read(row: Session, speakers: dict[uuid.UUID, list[uuid.UUID]] | None = None) -> PlacedSession:
    return PlacedSession(
        id=row.id,
        title=row.title,
        speaker_ids=(speakers or {}).get(row.id, []),
        event_day_id=row.event_day_id,
        room_id=row.room_id,
        track_id=row.track_id,
        starts_at=row.starts_at,
        duration_minutes=row.duration_minutes,
        status=row.status,
        is_locked=row.is_locked,
    )


async def _soft_enabled(session: DbSession) -> bool:
    # Read the tenant before disabling it: inside the block there is none.
    tenant = current_tenant()
    with tenancy_disabled():
        event = await session.get(Event, tenant.event_id)
    return event is not None and event.soft_conflicts_enabled


async def _live_conflicts(session: DbSession) -> list[ConflictRead]:
    """Everything currently colliding, minus what an organiser has waved through."""
    found = await engine.detect(session, soft_enabled=await _soft_enabled(session))
    dismissed = set((await session.execute(select(ConflictDismissal.conflict_key))).scalars().all())
    return [
        ConflictRead(
            conflict_key=item.conflict_key,
            kind=item.kind,
            severity="hard" if item.is_hard else "soft",
            label=item.label,
            starts_at=item.starts_at,
            ends_at=item.ends_at,
            session_ids=list(item.session_ids),
        )
        for item in found
        if item.conflict_key not in dismissed
    ]


def _must_be_on_the_day(day: EventDay, starts_at: datetime) -> None:
    """A placement's day and its time have to agree.

    The grid draws a card at (starts_at - the day's opening) minutes, so a
    session filed under Monday at a Tuesday time lands hours below the canvas:
    still `scheduled`, gone from the tray, and unreachable by the drag that
    would have fixed it. Nothing in the console can produce this — every caller
    derives the time from the day it is dropping onto — which is exactly why it
    should be refused rather than trusted.
    """
    if starts_at.date() != day.day_date:
        raise ApiError(
            f"{starts_at:%d %b %H:%M} is not on {day.day_date:%d %b}. "
            "A session's time has to fall on the day it is placed on.",
            code="PLACEMENT_OFF_DAY",
            status_code=422,
        )


async def _load(session: DbSession, session_id: uuid.UUID) -> Session:
    row = await session.get(Session, session_id)
    if row is None:
        raise NotFoundError(f"No session with id {session_id}.")
    return row


@router.patch("/sessions/{session_id}/placement", response_model=PlacementResult)
async def place(
    session_id: uuid.UUID,
    body: PlacementUpdate,
    session: DbSession,
    _: User = Depends(require_role(*WRITE)),
) -> PlacementResult:
    """Persist the drop, then report what it collided with.

    Two refusals, and neither is a judgement about the schedule: a locked
    session, which is an explicit instruction from an organiser, and a time that
    is not on the day it is being placed on, which is incoherent rather than
    merely conflicting.
    """
    row = await _load(session, session_id)
    if row.is_locked:
        raise ApiError(
            f"{row.title} is locked. Unlock it before moving it.",
            code="SESSION_LOCKED",
            status_code=409,
        )
    day = await session.get(EventDay, body.event_day_id)
    if day is None:
        raise NotFoundError(f"No event day with id {body.event_day_id}.")
    if await session.get(Room, body.room_id) is None:
        raise NotFoundError(f"No room with id {body.room_id}.")
    _must_be_on_the_day(day, body.starts_at)

    row.event_day_id = body.event_day_id
    row.room_id = body.room_id
    row.starts_at = body.starts_at
    if body.duration_minutes is not None:
        row.duration_minutes = body.duration_minutes
    row.status = SessionStatus.SCHEDULED
    await session.flush()

    return PlacementResult(session=_read(row), conflicts=await _live_conflicts(session))


@router.post("/sessions/{session_id}/unschedule", response_model=PlacementResult)
async def unschedule(
    session_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*WRITE))
) -> PlacementResult:
    """Back to the tray. Placement is cleared; the session itself survives."""
    row = await _load(session, session_id)
    if row.is_locked:
        raise ApiError(
            f"{row.title} is locked. Unlock it before moving it.",
            code="SESSION_LOCKED",
            status_code=409,
        )
    row.event_day_id = None
    row.room_id = None
    row.starts_at = None
    row.status = SessionStatus.UNSCHEDULED
    await session.flush()

    return PlacementResult(session=_read(row), conflicts=await _live_conflicts(session))


@router.post("/sessions/bulk-placement", response_model=list[PlacementResult])
async def bulk_place(
    body: BulkPlacement, session: DbSession, _: User = Depends(require_role(*WRITE))
) -> list[PlacementResult]:
    """Accepting a whole proposed grid in one go.

    Conflicts are computed once at the end: reporting them per row would describe
    a half-applied schedule that never existed.
    """
    placed: list[PlacedSession] = []
    for entry in body.placements:
        parsed = PlacementUpdate.model_validate(
            {key: value for key, value in entry.items() if key != "session_id"}
        )
        raw_id = entry.get("session_id")
        if raw_id is None:
            raise ApiError(
                "Every placement needs a session_id.",
                code="VALIDATION_FAILED",
                status_code=422,
                field="placements",
            )
        row = await _load(session, uuid.UUID(str(raw_id)))
        if row.is_locked:
            continue
        day = await session.get(EventDay, parsed.event_day_id)
        if day is None:
            raise NotFoundError(f"No event day with id {parsed.event_day_id}.")
        _must_be_on_the_day(day, parsed.starts_at)
        row.event_day_id = parsed.event_day_id
        row.room_id = parsed.room_id
        row.starts_at = parsed.starts_at
        if parsed.duration_minutes is not None:
            row.duration_minutes = parsed.duration_minutes
        row.status = SessionStatus.SCHEDULED
        placed.append(_read(row))
    await session.flush()

    live = await _live_conflicts(session)
    return [PlacementResult(session=row, conflicts=live) for row in placed]


@router.get("/conflicts", response_model=list[ConflictRead])
async def list_conflicts(
    session: DbSession, _: User = Depends(require_role(*READ))
) -> list[ConflictRead]:
    return await _live_conflicts(session)


@router.post("/conflicts/dismiss", response_model=list[ConflictRead])
async def dismiss(
    body: DismissRequest,
    session: DbSession,
    user: User = Depends(require_role(*WRITE)),
) -> list[ConflictRead]:
    """Waving one through, on the record.

    A reason is required because the next organiser reading the agenda needs to
    know this was a decision rather than an oversight.
    """
    live = await engine.detect(session, soft_enabled=await _soft_enabled(session))
    match = next((item for item in live if item.conflict_key == body.conflict_key), None)
    if match is None:
        raise NotFoundError("That conflict is no longer present.")

    existing = await session.scalar(
        select(ConflictDismissal).where(ConflictDismissal.conflict_key == body.conflict_key)
    )
    if existing is None:
        session.add(
            ConflictDismissal(
                conflict_key=body.conflict_key,
                kind=match.kind,
                reason=body.reason,
                dismissed_by_user_id=user.id,
                dismissed_at=datetime.now(UTC),
            )
        )
        await session.flush()
    return await _live_conflicts(session)


@router.get("/schedule/draft", response_model=Draft)
async def draft(session: DbSession, _: User = Depends(require_role(*READ))) -> Draft:
    """Everything the grid needs, in one request.

    The agenda opens on a drag-heavy screen; five round trips before the first
    card renders is what makes a builder feel slow.
    """
    days = (await session.execute(select(EventDay).order_by(EventDay.day_date))).scalars().all()
    rooms = (await session.execute(select(Room).order_by(Room.sort_order))).scalars().all()
    tracks = (await session.execute(select(Track).order_by(Track.name))).scalars().all()
    blocks = (
        (await session.execute(select(ScheduleBlock).order_by(ScheduleBlock.starts_at)))
        .scalars()
        .all()
    )
    sessions = (
        (await session.execute(select(Session).order_by(Session.starts_at, Session.title)))
        .scalars()
        .all()
    )
    links = (
        (
            (
                await session.execute(
                    select(SessionSpeaker.session_id, SessionSpeaker.speaker_id).where(
                        SessionSpeaker.session_id.in_([row.id for row in sessions])
                    )
                )
            )
            .tuples()
            .all()
        )
        if sessions
        else []
    )
    by_session: dict[uuid.UUID, list[uuid.UUID]] = {}
    for session_id, speaker_id in links:
        by_session.setdefault(session_id, []).append(speaker_id)

    return Draft(
        days=[
            GridDay(
                id=day.id,
                day_date=day.day_date.isoformat(),
                starts_at_local=day.starts_at_local.isoformat(),
                ends_at_local=day.ends_at_local.isoformat(),
                label=day.label,
            )
            for day in days
        ],
        rooms=[GridRoom.model_validate(room) for room in rooms],
        tracks=[
            {"id": str(track.id), "name": track.name, "hue_index": str(track.hue_index)}
            for track in tracks
        ],
        blocks=[
            GridBlock(
                id=block.id,
                event_day_id=block.event_day_id,
                label=block.label,
                starts_at=block.starts_at,
                duration_minutes=block.duration_minutes,
                spans_all_rooms=block.spans_all_rooms,
                room_id=block.room_id,
            )
            for block in blocks
        ],
        scheduled=[_read(row, by_session) for row in sessions if row.starts_at is not None],
        unscheduled=[_read(row, by_session) for row in sessions if row.starts_at is None],
        conflicts=await _live_conflicts(session),
    )
