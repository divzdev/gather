from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, EventScoped, PrimaryKey, Timestamps, Uuid, pg_enum
from app.models.enums import TaskKind, TaskStatus


class TaskTemplate(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "task_templates"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[TaskKind] = mapped_column(pg_enum(TaskKind, "task_kind"), nullable=False)
    form_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("forms.id", ondelete="SET NULL"), nullable=True
    )
    external_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # {"type":"fixed","date":"..."} | {"type":"relative","days_before_event":14}
    due_rule: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    # {"scope":"all"} | {"scope":"track","ids":[...]} | {"scope":"format","ids":[...]}
    applies_to: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    accepted_file_types: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    max_file_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requires_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SpeakerTask(Base, PrimaryKey, Timestamps, EventScoped):
    """`submitted` means the speaker provided something; `complete` means an
    organiser accepted it, or the type self-completes.

    A non-null `completed_by_user_id` means an organiser completed it on the
    speaker's behalf, which the UI surfaces.
    """

    __tablename__ = "speaker_tasks"
    __table_args__ = (
        UniqueConstraint("speaker_id", "task_template_id"),
        Index("ix_speaker_tasks_event_status_due", "event_id", "status", "due_at"),
    )

    speaker_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("speakers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    task_template_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("task_templates.id", ondelete="CASCADE"), nullable=False
    )
    due_at: Mapped[datetime | None] = mapped_column(nullable=True)
    status: Mapped[TaskStatus] = mapped_column(
        pg_enum(TaskStatus, "task_status"), nullable=False, default=TaskStatus.NOT_STARTED
    )
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    completed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    form_response: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # Enforces the 24-hour floor between nudges for one speaker and task.
    last_nudged_at: Mapped[datetime | None] = mapped_column(nullable=True)


class TaskFile(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "task_files"
    __table_args__ = (UniqueConstraint("speaker_task_id", "file_id"),)

    speaker_task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("speaker_tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("files.id", ondelete="CASCADE"), nullable=False
    )
