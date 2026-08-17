from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, EventScoped, PrimaryKey, Timestamps, Uuid, pg_enum
from app.models.enums import MessagePurpose, MessageStatus


class MessageTemplate(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "message_templates"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    purpose: Mapped[MessagePurpose] = mapped_column(
        pg_enum(MessagePurpose, "message_purpose"), nullable=False, default=MessagePurpose.CUSTOM
    )
    subject: Mapped[str] = mapped_column(String(300), nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    attach_ics: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    include_calendar_links: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class MessageBatch(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "message_batches"

    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("message_templates.id", ondelete="SET NULL"), nullable=True
    )
    recipient_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    segment_description: Mapped[str | None] = mapped_column(String(400), nullable=True)
    status: Mapped[MessageStatus] = mapped_column(
        pg_enum(MessageStatus, "message_status"), nullable=False, default=MessageStatus.DRAFT
    )


class Message(Base, PrimaryKey, Timestamps, EventScoped):
    """The outbox: one row per recipient, so delivery state is per person."""

    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_event_status_sent", "event_id", "status", "sent_at"),
        Index("ix_messages_to_speaker_id", "to_speaker_id"),
    )

    message_template_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("message_templates.id", ondelete="SET NULL"), nullable=True
    )
    batch_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("message_batches.id", ondelete="SET NULL"), nullable=True, index=True
    )

    to_email: Mapped[str] = mapped_column(CITEXT(), nullable=False)
    to_speaker_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("speakers.id", ondelete="SET NULL"), nullable=True
    )
    to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    subject: Mapped[str] = mapped_column(String(300), nullable=False)
    body_rendered: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[MessageStatus] = mapped_column(
        pg_enum(MessageStatus, "message_status"), nullable=False, default=MessageStatus.DRAFT
    )
    ses_message_id: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    scheduled_for: Mapped[datetime | None] = mapped_column(nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(nullable=True)
    bounced_at: Mapped[datetime | None] = mapped_column(nullable=True)
    opened_at: Mapped[datetime | None] = mapped_column(nullable=True)
    ics_attached: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: The VCALENDAR text this message carries, if any. Held on the row rather
    #: than in the caller: the worker delivers messages it did not queue, and an
    #: invite that lived only in the queueing request would be gone by then.
    #: Never set apart from `ics_attached` — `mail.queue` derives one from the
    #: other, so the flag cannot claim an invite that is not here.
    ics_body: Mapped[str | None] = mapped_column(Text, nullable=True)
