"""Program setup: tracks, session formats, rooms, days.

Five identical resources, so they share the router factory in core/crud.py.
Tracks are the one with real behaviour — hue assignment — which the factory
supports through a create hook rather than by growing options.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import event_resource_router
from app.features.program import schemas
from app.models import EventDay, Room, Session, SessionFormat, Track

TRACK_HUES = 8


async def _assign_hue(session: AsyncSession, track: Any) -> None:
    """Hues cycle 1-8 in creation order and are stored, so a track's colour never
    shifts when another is added or removed."""
    if track.hue_index is not None:
        return
    used = await session.scalar(select(func.count(Track.id)))
    track.hue_index = (int(used or 0) % TRACK_HUES) + 1


async def _sessions_using(session: AsyncSession, column: Any, item_id: uuid.UUID) -> int:
    """How many sessions still point at this row."""
    return int(await session.scalar(select(func.count(Session.id)).where(column == item_id)) or 0)


tracks_router = event_resource_router(
    model=Track,
    in_use=lambda session, item_id: _sessions_using(session, Session.track_id, item_id),
    read_schema=schemas.TrackRead,
    create_schema=schemas.TrackCreate,
    update_schema=schemas.TrackUpdate,
    plural="tracks",
    tag="tracks",
    on_create=_assign_hue,
)

session_formats_router = event_resource_router(
    model=SessionFormat,
    in_use=lambda session, item_id: _sessions_using(session, Session.session_format_id, item_id),
    read_schema=schemas.SessionFormatRead,
    create_schema=schemas.SessionFormatCreate,
    update_schema=schemas.SessionFormatUpdate,
    plural="session-formats",
    tag="session formats",
)

rooms_router = event_resource_router(
    model=Room,
    in_use=lambda session, item_id: _sessions_using(session, Session.room_id, item_id),
    read_schema=schemas.RoomRead,
    create_schema=schemas.RoomCreate,
    update_schema=schemas.RoomUpdate,
    plural="rooms",
    tag="rooms",
)

event_days_router = event_resource_router(
    model=EventDay,
    read_schema=schemas.EventDayRead,
    create_schema=schemas.EventDayCreate,
    update_schema=schemas.EventDayUpdate,
    plural="days",
    tag="event days",
    order_by="day_date",
)

ROUTERS = [tracks_router, session_formats_router, rooms_router, event_days_router]
