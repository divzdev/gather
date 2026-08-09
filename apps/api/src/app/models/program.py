"""The program skeleton the agenda grid is drawn from."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, EventScoped, PrimaryKey, Timestamps, Uuid


class EventDay(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "event_days"
    __table_args__ = (UniqueConstraint("event_id", "day_date"),)

    day_date: Mapped[date] = mapped_column(nullable=False)
    starts_at_local: Mapped[time] = mapped_column(nullable=False)
    ends_at_local: Mapped[time] = mapped_column(nullable=False)
    label: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Room(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "rooms"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    av_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class RoomBlackout(Base, PrimaryKey, Timestamps, EventScoped):
    """A window where a room cannot hold sessions. Produces a hard room conflict."""

    __tablename__ = "room_blackouts"

    room_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    starts_at: Mapped[datetime] = mapped_column(nullable=False)
    ends_at: Mapped[datetime] = mapped_column(nullable=False)
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)


class Track(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "tracks"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 1-8, assigned in creation order and stored so the colour never shifts.
    hue_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SessionFormat(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "session_formats"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    default_duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    icon_key: Mapped[str | None] = mapped_column(String(60), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ScheduleBlock(Base, PrimaryKey, Timestamps, EventScoped):
    """Lunch, registration, breaks — grid furniture that is not a session."""

    __tablename__ = "schedule_blocks"

    event_day_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("event_days.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    spans_all_rooms: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    room_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("rooms.id", ondelete="CASCADE"), nullable=True
    )
