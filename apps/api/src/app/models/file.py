from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, OrgScoped, PrimaryKey, Timestamps, Uuid


class File(Base, PrimaryKey, Timestamps, OrgScoped):
    """Versioned by `version_group_id`: replacing a file writes a new row at
    version + 1 and nothing is ever overwritten or deleted.

    Org-scoped rather than event-scoped because a headshot follows the speaker
    across events.
    """

    __tablename__ = "files"
    __table_args__ = (
        UniqueConstraint("version_group_id", "version"),
        Index("ix_files_version_group_version", "version_group_id", "version"),
    )

    event_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("events.id", ondelete="CASCADE"), nullable=True, index=True
    )
    version_group_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    s3_key: Mapped[str] = mapped_column(String(600), nullable=False)
    filename: Mapped[str] = mapped_column(String(300), nullable=False)
    content_type: Mapped[str] = mapped_column(String(160), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    uploaded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    uploaded_by_speaker_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("speakers.id", ondelete="SET NULL"), nullable=True
    )
