"""Program setup: tracks, session formats, rooms, days.

Five identical resources, so they share the router factory in core/crud.py.
Tracks are the one with real behaviour — hue assignment — which the factory
supports through a create hook rather than by growing options.

Days have the other real behaviour: a session's `starts_at` is absolute UTC and
does not follow the day it sits on, so moving a day has to move its sessions too.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import event_resource_router
from app.core.errors import ApiError
from app.features.program import schemas
from app.models import EventDay, Room, ScheduleBlock, Session, SessionFormat, Track

TRACK_HUES = 8


async def _assign_hue(session: AsyncSession, track: Any) -> None:
    """Hues cycle 1-8 in creation order and are stored, so a track's colour never
    shifts when another is added or removed."""
    if track.hue_index is not None:
        return
    used = await session.scalar(select(func.count(Track.id)))
    track.hue_index = (int(used or 0) % TRACK_HUES) + 1


async def _count(session: AsyncSession, model: Any, column: Any, item_id: uuid.UUID) -> int:
    return int(await session.scalar(select(func.count(model.id)).where(column == item_id)) or 0)


def _usage_of(column: Any) -> Any:
    """Sessions per row of this resource, in one grouped query."""

    async def counts(session: AsyncSession) -> dict[uuid.UUID, int]:
        rows = await session.execute(
            select(column, func.count(Session.id)).where(column.is_not(None)).group_by(column)
        )
        return {item_id: int(total) for item_id, total in rows.tuples().all()}

    return counts


def _sessions(count: int) -> str:
    return f"{count} session{'s' if count != 1 else ''}"


def _used_by_sessions(column: Any, noun: str) -> Any:
    """Refuse the delete while sessions still point here, and say how many.

    The column is `ON DELETE SET NULL`, so going ahead would strip the value off
    every one of them at once with nothing to undo it from.
    """

    async def check(session: AsyncSession, item_id: uuid.UUID) -> str | None:
        used = await _count(session, Session, column, item_id)
        if used == 0:
            return None
        return (
            f"{_sessions(used)} still {'use' if used != 1 else 'uses'} this {noun}. "
            f"Move them to another {noun} first — deleting it would take it off all of them."
        )

    return check


async def _room_in_use(session: AsyncSession, item_id: uuid.UUID) -> str | None:
    """Sessions hold a room by SET NULL; schedule blocks hold one by CASCADE.

    The second is the quiet one: removing a room would delete the breaks scoped
    to it outright, which nothing on screen would ever have mentioned.
    """
    used = await _count(session, Session, Session.room_id, item_id)
    furniture = await _count(session, ScheduleBlock, ScheduleBlock.room_id, item_id)
    if used == 0 and furniture == 0:
        return None
    reasons = []
    if used > 0:
        reasons.append(f"{_sessions(used)} are in this room")
    if furniture > 0:
        reasons.append(f"{furniture} break{'s' if furniture != 1 else ''} belongs to it")
    return f"{' and '.join(reasons)}. Move them first — deleting the room would take them with it."


async def _day_in_use(session: AsyncSession, item_id: uuid.UUID) -> str | None:
    """The guard this resource never had.

    `sessions.event_day_id` is SET NULL while `starts_at`, `room_id` and
    `status` are left alone, so deleting a day used to leave every session on it
    in a state the agenda cannot draw and the tray does not list: scheduled, for
    a time, in a room, on no day. Schedule blocks on the day CASCADE away in the
    same breath.
    """
    placed = await _count(session, Session, Session.event_day_id, item_id)
    furniture = await _count(session, ScheduleBlock, ScheduleBlock.event_day_id, item_id)
    if placed == 0 and furniture == 0:
        return None
    reasons = []
    if placed > 0:
        reasons.append(f"{_sessions(placed)} are scheduled on this day")
    if furniture > 0:
        reasons.append(f"it holds {furniture} break{'s' if furniture != 1 else ''}")
    return (
        f"{' and '.join(reasons)}. Unschedule them first — "
        "deleting the day would strand them at a time with no day."
    )


async def _shift_sessions_with_the_day(
    session: AsyncSession, day: Any, before: dict[str, Any]
) -> None:
    """Moving a day moves everything placed on it, and a day still has to end
    after it starts.

    A session's `starts_at` is absolute UTC, so it does not follow the day row.
    Editing 12 May to 14 May without this leaves every talk sitting two days in
    the past, still marked scheduled, invisible on the tab it belongs to.
    """
    # A one-sided time edit cannot be checked by the schema, which never sees
    # the half it is not carrying. Here the row is merged and both are known.
    if day.starts_at_local >= day.ends_at_local:
        raise ApiError(
            "A day has to start before it ends.",
            code="VALIDATION_FAILED",
            status_code=422,
        )

    was: date | None = before.get("day_date")
    if was is None or was == day.day_date:
        return

    delta = timedelta(days=(day.day_date - was).days)
    placed = (
        (
            await session.execute(
                select(Session).where(
                    Session.event_day_id == day.id, Session.starts_at.is_not(None)
                )
            )
        )
        .scalars()
        .all()
    )
    for row in placed:
        if row.starts_at is not None:
            row.starts_at = row.starts_at + delta

    blocks = (
        (await session.execute(select(ScheduleBlock).where(ScheduleBlock.event_day_id == day.id)))
        .scalars()
        .all()
    )
    for block in blocks:
        block.starts_at = block.starts_at + delta


tracks_router = event_resource_router(
    model=Track,
    in_use=_used_by_sessions(Session.track_id, "track"),
    usage=_usage_of(Session.track_id),
    read_schema=schemas.TrackRead,
    create_schema=schemas.TrackCreate,
    update_schema=schemas.TrackUpdate,
    plural="tracks",
    tag="tracks",
    on_create=_assign_hue,
)

session_formats_router = event_resource_router(
    model=SessionFormat,
    in_use=_used_by_sessions(Session.session_format_id, "format"),
    usage=_usage_of(Session.session_format_id),
    read_schema=schemas.SessionFormatRead,
    create_schema=schemas.SessionFormatCreate,
    update_schema=schemas.SessionFormatUpdate,
    plural="session-formats",
    tag="session formats",
)

rooms_router = event_resource_router(
    model=Room,
    in_use=_room_in_use,
    usage=_usage_of(Session.room_id),
    read_schema=schemas.RoomRead,
    create_schema=schemas.RoomCreate,
    update_schema=schemas.RoomUpdate,
    plural="rooms",
    tag="rooms",
)

event_days_router = event_resource_router(
    model=EventDay,
    in_use=_day_in_use,
    usage=_usage_of(Session.event_day_id),
    on_update=_shift_sessions_with_the_day,
    read_schema=schemas.EventDayRead,
    create_schema=schemas.EventDayCreate,
    update_schema=schemas.EventDayUpdate,
    plural="days",
    tag="event days",
    order_by="day_date",
)

ROUTERS = [tracks_router, session_formats_router, rooms_router, event_days_router]
