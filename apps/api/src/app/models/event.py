from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy import Enum as SaEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, EventScoped, OrgScoped, PrimaryKey, Timestamps, Uuid
from app.models.enums import EventStatus, Role


class Event(PrimaryKey, Timestamps, OrgScoped, Base):
    __tablename__ = "events"
    __table_args__ = (UniqueConstraint("org_id", "slug"),)

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    # IANA name. Storage is always UTC; this is how the client renders.
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    starts_on: Mapped[date] = mapped_column(nullable=False)
    ends_on: Mapped[date] = mapped_column(nullable=False)
    location: Mapped[str | None] = mapped_column(String(300), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[EventStatus] = mapped_column(
        SaEnum(
            EventStatus,
            name="event_status",
            native_enum=True,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=EventStatus.DRAFT,
        index=True,
    )

    cfp_opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cfp_closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    public_accent_hex: Mapped[str | None] = mapped_column(String(7), nullable=True)

    # Some organizers overlap tracks deliberately, so this class of conflict is
    # advisory and switchable per event.
    soft_conflicts_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    submission_limit_per_speaker: Mapped[int | None] = mapped_column(Integer, nullable=True)

    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EventMember(PrimaryKey, Timestamps, EventScoped, Base):
    """Per-event role override. Resolution is: this row if present, else org_members."""

    __tablename__ = "event_members"
    __table_args__ = (UniqueConstraint("event_id", "user_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[Role] = mapped_column(
        SaEnum(Role, name="role", native_enum=True, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
