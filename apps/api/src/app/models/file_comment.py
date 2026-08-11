from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, OrgScoped, PrimaryKey, Timestamps, Uuid, pg_enum
from app.models.enums import CommentAuthorKind


class FileComment(Base, PrimaryKey, Timestamps, OrgScoped):
    """One message in the conversation about a deliverable.

    Keyed to `version_group_id`, not to a file row. A comment is almost always a
    request to change the file — "this headshot is too small" — so keying it to
    the row would make the thread vanish the moment the speaker did what it
    asked. `file_version` records which version was current when the message was
    written, which is the part worth keeping per-row.

    Org-scoped to match `File`, which is org-scoped because a headshot follows
    its speaker across events.
    """

    __tablename__ = "file_comments"
    __table_args__ = (
        Index("ix_file_comments_version_group_created", "version_group_id", "created_at"),
    )

    version_group_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    file_version: Mapped[int] = mapped_column(Integer, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    author_kind: Mapped[CommentAuthorKind] = mapped_column(
        pg_enum(CommentAuthorKind, "comment_author_kind"), nullable=False
    )
    # Denormalized on purpose. Both author FKs are SET NULL, so a staff member
    # leaving the org would otherwise erase the "author" half of every message
    # they wrote — and who said it is most of what makes a thread readable.
    author_name: Mapped[str] = mapped_column(String(300), nullable=False)

    author_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    author_speaker_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("speakers.id", ondelete="SET NULL"), nullable=True
    )
