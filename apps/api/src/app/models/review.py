from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, EventScoped, PrimaryKey, Timestamps, Uuid, pg_enum
from app.models.enums import DuplicateStatus, ReviewRoundStatus, ReviewStatus


class ReviewRound(Base, PrimaryKey, Timestamps, EventScoped):
    """`is_blind` is set by an admin per round; reviewers cannot toggle it."""

    __tablename__ = "review_rounds"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_blind: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    opens_at: Mapped[datetime | None] = mapped_column(nullable=True)
    closes_at: Mapped[datetime | None] = mapped_column(nullable=True)
    # {"type": "threshold", "min_score": 7.5} | {"type": "manual"}
    advance_rule: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[ReviewRoundStatus] = mapped_column(
        pg_enum(ReviewRoundStatus, "review_round_status"),
        nullable=False,
        default=ReviewRoundStatus.DRAFT,
    )


class RubricCriterion(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "rubric_criteria"

    review_round_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("review_rounds.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    scale_min: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    scale_max: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    weight: Mapped[Decimal] = mapped_column(Numeric(3, 2), nullable=False, default=Decimal("1.00"))
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ReviewerAssignment(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "reviewer_assignments"
    __table_args__ = (
        UniqueConstraint("review_round_id", "submission_id", "user_id"),
        Index(
            "ix_reviewer_assignments_user_round_completed",
            "user_id",
            "review_round_id",
            "completed_at",
        ),
    )

    review_round_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("review_rounds.id", ondelete="CASCADE"), nullable=False
    )
    submission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    assigned_at: Mapped[datetime | None] = mapped_column(nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class Review(Base, PrimaryKey, Timestamps, EventScoped):
    """`conflict_of_interest` excludes this review from the mean and flags the
    submission — it is not the same as skipping."""

    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("review_round_id", "submission_id", "user_id"),
        Index("ix_reviews_round_user_status", "review_round_id", "user_id", "status"),
    )

    review_round_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("review_rounds.id", ondelete="CASCADE"), nullable=False
    )
    submission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Organiser-only; never returned on a speaker-facing surface.
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[ReviewStatus] = mapped_column(
        pg_enum(ReviewStatus, "review_status"), nullable=False, default=ReviewStatus.PENDING
    )
    conflict_of_interest: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    submitted_at: Mapped[datetime | None] = mapped_column(nullable=True)


class ReviewScore(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "review_scores"
    __table_args__ = (UniqueConstraint("review_id", "rubric_criterion_id"),)

    review_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("reviews.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rubric_criterion_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("rubric_criteria.id", ondelete="CASCADE"), nullable=False
    )
    value: Mapped[int] = mapped_column(Integer, nullable=False)


class AiScore(Base, PrimaryKey, Timestamps, EventScoped):
    """Deliberately a separate table. AI scores are never averaged with human
    scores and never pre-fill a reviewer's input."""

    __tablename__ = "ai_scores"
    __table_args__ = (UniqueConstraint("review_round_id", "submission_id", "rubric_criterion_id"),)

    review_round_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("review_rounds.id", ondelete="CASCADE"), nullable=False
    )
    submission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rubric_criterion_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("rubric_criteria.id", ondelete="CASCADE"), nullable=False
    )
    value: Mapped[int] = mapped_column(Integer, nullable=False)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)


class DuplicateFlag(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "duplicate_flags"
    __table_args__ = (UniqueConstraint("submission_a_id", "submission_b_id"),)

    submission_a_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    submission_b_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False
    )
    similarity: Mapped[Decimal] = mapped_column(Numeric(4, 3), nullable=False)
    overlap_spans: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[DuplicateStatus] = mapped_column(
        pg_enum(DuplicateStatus, "duplicate_status"), nullable=False, default=DuplicateStatus.OPEN
    )
    resolved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(nullable=True)
