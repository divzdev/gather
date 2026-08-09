from __future__ import annotations

from typing import Any

from sqlalchemy import Boolean, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, EventScoped, PrimaryKey, Timestamps, pg_enum
from app.models.enums import PageVisibility


class Page(Base, PrimaryKey, Timestamps, EventScoped):
    """Block-based content. `embed` block HTML is sanitised server-side on write
    against a strict allowlist, never on render."""

    __tablename__ = "pages"
    __table_args__ = (UniqueConstraint("event_id", "slug"),)

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), nullable=False)
    blocks: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    visibility: Mapped[PageVisibility] = mapped_column(
        pg_enum(PageVisibility, "page_visibility"), nullable=False, default=PageVisibility.DRAFT
    )
    is_pinned_in_portal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
