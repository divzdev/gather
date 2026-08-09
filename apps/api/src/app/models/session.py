from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, EventScoped, PrimaryKey, Timestamps, Uuid, pg_enum
from app.models.enums import ConflictKind, SessionSpeakerRole, SessionStatus


class Session(Base, PrimaryKey, Timestamps, EventScoped):
    """A talk on the agenda. Placement stays null until it is scheduled.

    Sessions are the draft; the public site reads a PublishedSchedule snapshot.
    """

    __tablename__ = "sessions"
    __table_args__ = (
        UniqueConstraint("event_id", "slug"),
        Index("ix_sessions_placement", "event_id", "event_day_id", "room_id", "starts_at"),
        Index("ix_sessions_event_id_status", "event_id", "status"),
    )

    submission_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("submissions.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    slug: Mapped[str] = mapped_column(String(200), nullable=False)

    track_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("tracks.id", ondelete="SET NULL"), nullable=True
    )
    session_format_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("session_formats.id", ondelete="SET NULL"), nullable=True
    )
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30)

    event_day_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("event_days.id", ondelete="SET NULL"), nullable=True
    )
    room_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True
    )
    starts_at: Mapped[datetime | None] = mapped_column(nullable=True)

    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[SessionStatus] = mapped_column(
        pg_enum(SessionStatus, "session_status"), nullable=False, default=SessionStatus.UNSCHEDULED
    )
    materials_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    recording_embed_url: Mapped[str | None] = mapped_column(String(500), nullable=True)


class SessionSpeaker(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "session_speakers"
    __table_args__ = (
        UniqueConstraint("session_id", "speaker_id"),
        Index("ix_session_speakers_speaker_id", "speaker_id"),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    speaker_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("speakers.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[SessionSpeakerRole] = mapped_column(
        pg_enum(SessionSpeakerRole, "session_speaker_role"),
        nullable=False,
        default=SessionSpeakerRole.SPEAKER,
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class PublishedSchedule(Base, PrimaryKey, Timestamps, EventScoped):
    """An immutable snapshot of the whole public payload.

    Public pages and the embed read only the latest row and never join live
    tables, which makes a public read one indexed lookup. Rollback is republishing
    an earlier version.
    """

    __tablename__ = "published_schedules"
    __table_args__ = (UniqueConstraint("event_id", "version"),)

    version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    published_at: Mapped[datetime] = mapped_column(nullable=False)
    published_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class ConflictDismissal(Base, PrimaryKey, Timestamps, EventScoped):
    """`conflict_key` is an order-independent hash of the conflict's participants,
    so a dismissal survives unrelated edits but reappears if the conflict changes.
    """

    __tablename__ = "conflict_dismissals"
    __table_args__ = (UniqueConstraint("event_id", "conflict_key"),)

    conflict_key: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[ConflictKind] = mapped_column(
        pg_enum(ConflictKind, "conflict_kind"), nullable=False
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    dismissed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    dismissed_at: Mapped[datetime] = mapped_column(nullable=False)
