from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import CITEXT, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, EventScoped, OrgScoped, PrimaryKey, Timestamps, Uuid, pg_enum
from app.models.enums import SpeakerStatus


class Speaker(Base, PrimaryKey, Timestamps, OrgScoped):
    """A person, scoped to the organisation rather than one event — the CRM seam.

    Speakers never have a password; email is identity and a magic link is auth.
    """

    __tablename__ = "speakers"
    __table_args__ = (UniqueConstraint("org_id", "email"),)

    email: Mapped[str] = mapped_column(CITEXT(), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    pronouns: Mapped[str | None] = mapped_column(String(60), nullable=True)
    company: Mapped[str | None] = mapped_column(String(200), nullable=True)
    job_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    headshot_file_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    links: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    dietary_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    accessibility_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    av_notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class EventSpeaker(Base, PrimaryKey, Timestamps, EventScoped):
    """One speaker's participation in one event."""

    __tablename__ = "event_speakers"
    __table_args__ = (UniqueConstraint("event_id", "speaker_id"),)

    speaker_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("speakers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[SpeakerStatus] = mapped_column(
        pg_enum(SpeakerStatus, "speaker_status"),
        nullable=False,
        default=SpeakerStatus.PROSPECTIVE,
        index=True,
    )
    portal_last_seen_at: Mapped[datetime | None] = mapped_column(nullable=True)
