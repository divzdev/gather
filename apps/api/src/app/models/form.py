from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, EventScoped, PrimaryKey, Timestamps, Uuid, pg_enum
from app.models.enums import FormKind, FormStatus


class Form(Base, PrimaryKey, Timestamps, EventScoped):
    """One JSON-schema engine serves both CFP forms and portal task forms.

    `is_locked` flips true on the first submission: fields stay addable and labels
    editable, but nothing can be deleted or change type, so existing answers keep
    their meaning.
    """

    __tablename__ = "forms"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[FormKind] = mapped_column(pg_enum(FormKind, "form_kind"), nullable=False)
    schema: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[FormStatus] = mapped_column(
        pg_enum(FormStatus, "form_status"), nullable=False, default=FormStatus.DRAFT
    )
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    opens_at: Mapped[datetime | None] = mapped_column(nullable=True)
    closes_at: Mapped[datetime | None] = mapped_column(nullable=True)


class FormFieldStats(Base, PrimaryKey, Timestamps, EventScoped):
    """Denormalised count backing the builder's lock banner."""

    __tablename__ = "form_field_stats"

    form_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("forms.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    submission_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
