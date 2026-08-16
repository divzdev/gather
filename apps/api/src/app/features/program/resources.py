"""What a room, a track, a session format and a day *are* — hooks and all.

Separate from `router.py` because the routes are no longer the only caller. The
assistant can propose a program change (spec 0008), and applying one runs the
same `create_resource` / `update_resource` the routes run, against these same
four specs. A service importing a router to reach them would break the layering
rule; describing them twice would let them drift. So they are data, here.

Tracks have real behaviour — hue assignment — through a create hook rather than
by the factory growing options. Days have the other: a session's `starts_at` is
absolute UTC and does not follow the day it sits on, so moving a day has to move
its sessions too.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import ResourceSpec
from app.core.errors import ApiError
from app.core.tenancy import current_tenant, tenancy_disabled
from app.features.program import schemas
from app.models import Event, EventDay, Room, ScheduleBlock, Session, SessionFormat, Track

TRACK_HUES = 8


async def _day_within_the_event(session: AsyncSession, day: Any) -> None:
    """A day of the conference has to be a date the conference runs.

    The window is the whole rule, and it is stricter than "not in the past" —
    which is the version everyone reaches for first. A day in 2099 is exactly as
    wrong as a day in 2019: both draw an agenda tab for a date nobody is in the
    building, and only one of them looks obviously wrong. Checking against the
    event's own dates catches both, and needs no clock.

    Deliberately *not* a schema validator: the schema never sees the event, and
    fetching it there would put a query inside parsing. This runs on create and
    on edit, because the edit drawer is the same date field and moving a day
    drags every session placed on it along with it.
    """
    tenant = current_tenant()
    with tenancy_disabled():
        event = await session.get(Event, tenant.event_id)
    if event is None:  # pragma: no cover - bind_tenant proved it exists
        return
    if event.starts_on <= day.day_date <= event.ends_on:
        return
    raise ApiError(
        f"{day.day_date:%-d %b %Y} is outside the event. "
        f"{event.name} runs {event.starts_on:%-d %b %Y} to {event.ends_on:%-d %b %Y} "
        f"({event.starts_on.isoformat()} to {event.ends_on.isoformat()}) — "
        "pick a date inside that, or move the event's dates in Settings first.",
        code="VALIDATION_FAILED",
        status_code=422,
        field="day_date",
    )


async def _assign_hue(session: AsyncSession, track: Any) -> None:
    """Hues cycle 1-8 in creation order and are stored, so a track's colour never
    shifts when another is added or removed."""
    if track.hue_index is not None:
        return
    used = await session.scalar(select(func.count(Track.id)))
    track.hue_index = (int(used or 0) % TRACK_HUES) + 1


async def _count(session: AsyncSession, model: Any, column: Any, item_id: uuid.UUID) -> int:
    return int(await session.scalar(select(func.count(model.id)).where(column == item_id)) or 0)


async def _session_counts(session: AsyncSession, column: Any) -> dict[uuid.UUID, int]:
    rows = await session.execute(
        select(column, func.count(Session.id)).where(column.is_not(None)).group_by(column)
    )
    return {item_id: int(total) for item_id, total in rows.tuples().all()}


def _usage_of(column: Any) -> Any:
    """Sessions per row of this resource, in one grouped query."""

    async def extras(session: AsyncSession) -> dict[uuid.UUID, dict[str, Any]]:
        return {
            item_id: {"session_count": total}
            for item_id, total in (await _session_counts(session, column)).items()
        }

    return extras


async def _day_extras(session: AsyncSession) -> dict[uuid.UUID, dict[str, Any]]:
    """What each day actually holds.

    A row that shows only a date and a window says nothing about whether the day
    is full, empty or half-built — which is the whole question an organiser is
    asking when they look at this list. All of it is derived, so none of it is
    another field to keep true by hand.
    """
    counts = await _session_counts(session, Session.event_day_id)

    spans = await session.execute(
        select(
            Session.event_day_id,
            func.min(Session.starts_at),
            func.max(Session.starts_at),
            func.count(func.distinct(Session.room_id)),
        )
        .where(Session.event_day_id.is_not(None), Session.starts_at.is_not(None))
        .group_by(Session.event_day_id)
    )
    breaks = await session.execute(
        select(ScheduleBlock.event_day_id, func.count(ScheduleBlock.id)).group_by(
            ScheduleBlock.event_day_id
        )
    )

    built: dict[uuid.UUID, dict[str, Any]] = {
        day_id: {"session_count": total} for day_id, total in counts.items()
    }
    # The group-by columns are nullable in the schema and never null in these
    # results, since both queries filter them out; mypy cannot see that.
    for day_id, first, last, rooms in spans.tuples().all():
        if day_id is not None:
            built.setdefault(day_id, {}).update(
                first_session_at=first, last_session_at=last, room_count=int(rooms)
            )
    for day_id, total in breaks.tuples().all():
        built.setdefault(day_id, {}).update(break_count=int(total))
    return built


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
    await _day_within_the_event(session, day)

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


TRACK = ResourceSpec(
    model=Track,
    in_use=_used_by_sessions(Session.track_id, "track"),
    extras=_usage_of(Session.track_id),
    duplicate="This event already has a track with that name.",
    read_schema=schemas.TrackRead,
    create_schema=schemas.TrackCreate,
    update_schema=schemas.TrackUpdate,
    plural="tracks",
    tag="tracks",
    on_create=_assign_hue,
)

SESSION_FORMAT = ResourceSpec(
    model=SessionFormat,
    in_use=_used_by_sessions(Session.session_format_id, "format"),
    extras=_usage_of(Session.session_format_id),
    duplicate="This event already has a format with that name.",
    read_schema=schemas.SessionFormatRead,
    create_schema=schemas.SessionFormatCreate,
    update_schema=schemas.SessionFormatUpdate,
    plural="session-formats",
    tag="session formats",
)

ROOM = ResourceSpec(
    model=Room,
    in_use=_room_in_use,
    extras=_usage_of(Session.room_id),
    duplicate="This event already has a room with that name.",
    read_schema=schemas.RoomRead,
    create_schema=schemas.RoomCreate,
    update_schema=schemas.RoomUpdate,
    plural="rooms",
    tag="rooms",
)

EVENT_DAY = ResourceSpec(
    model=EventDay,
    in_use=_day_in_use,
    extras=_day_extras,
    duplicate="That date is already an event day. Edit the existing one instead.",
    on_create=_day_within_the_event,
    on_update=_shift_sessions_with_the_day,
    read_schema=schemas.EventDayRead,
    create_schema=schemas.EventDayCreate,
    update_schema=schemas.EventDayUpdate,
    plural="days",
    tag="event days",
    #: A day is named by its date in conversation, not by its optional label.
    label_column="day_date",
    order_by="day_date",
)

#: Every resource the setup screens and the assistant share, in the order the
#: setup navigation lists them.
SPECS = [ROOM, TRACK, SESSION_FORMAT, EVENT_DAY]
