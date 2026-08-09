from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    Computed,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, EventScoped, PrimaryKey, Timestamps, Uuid, pg_enum
from app.models.enums import DecisionStatus, SubmissionStatus


class Submission(Base, PrimaryKey, Timestamps, EventScoped):
    """A proposal against a Form.

    `code` is assigned at first save, not at submit, so a resumed draft keeps its
    identity. `decision_status` is the guard on mass email: setting a decision
    writes `pending_send` and sends nothing.
    """

    __tablename__ = "submissions"
    __table_args__ = (
        UniqueConstraint("event_id", "code"),
        Index("ix_submissions_event_id_status", "event_id", "status"),
        Index("ix_submissions_event_id_score_avg", "event_id", "score_avg"),
        Index("ix_submissions_event_id_decision_status", "event_id", "decision_status"),
        Index("ix_submissions_search_vector", "search_vector", postgresql_using="gin"),
    )

    form_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("forms.id", ondelete="RESTRICT"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(6), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    answers: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    track_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("tracks.id", ondelete="SET NULL"), nullable=True
    )
    session_format_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("session_formats.id", ondelete="SET NULL"), nullable=True
    )
    requested_duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    status: Mapped[SubmissionStatus] = mapped_column(
        pg_enum(SubmissionStatus, "submission_status"),
        nullable=False,
        default=SubmissionStatus.DRAFT,
    )
    decision_status: Mapped[DecisionStatus] = mapped_column(
        pg_enum(DecisionStatus, "decision_status"), nullable=False, default=DecisionStatus.NONE
    )
    decided_at: Mapped[datetime | None] = mapped_column(nullable=True)
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    coordinator_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Weighted mean over rubric criteria across scored reviews only; recomputed in
    # the same transaction as every review write. AI scores never contribute.
    score_avg: Mapped[Decimal | None] = mapped_column(Numeric(4, 2), nullable=True)
    review_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Lets an anonymous speaker resume an unsubmitted draft with no account.
    draft_token: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, unique=True)
    submitted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Maintained by Postgres, backing GET /v1/search. Declared here only so the
    # model matches the database; the DDL lives in the migration.
    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            "setweight(to_tsvector('english', coalesce(title, '')), 'A') || "
            "setweight(to_tsvector('english', coalesce(answers::text, '')), 'B')",
            persisted=True,
        ),
        nullable=True,
    )


class SubmissionSpeaker(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "submission_speakers"
    __table_args__ = (
        UniqueConstraint("submission_id", "speaker_id"),
        Index("ix_submission_speakers_speaker_id", "speaker_id"),
    )

    submission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    speaker_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("speakers.id", ondelete="CASCADE"), nullable=False
    )
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SubmissionTag(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "submission_tags"
    __table_args__ = (UniqueConstraint("submission_id", "label"),)

    submission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(80), nullable=False)


class SubmissionNote(Base, PrimaryKey, Timestamps, EventScoped):
    """Internal only. Never rendered on any speaker-facing surface."""

    __tablename__ = "submission_notes"

    submission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
