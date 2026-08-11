"""file comments

Revision ID: 0f5035b273b0
Revises: f2a7c9d41b08
Create Date: 2026-08-11 14:54:17.217730
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0f5035b273b0"
down_revision: str | None = "f2a7c9d41b08"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "file_comments",
        sa.Column("version_group_id", sa.UUID(), nullable=False),
        sa.Column("file_version", sa.Integer(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "author_kind",
            sa.Enum("staff", "speaker", name="comment_author_kind"),
            nullable=False,
        ),
        sa.Column("author_name", sa.String(length=300), nullable=False),
        sa.Column("author_user_id", sa.UUID(), nullable=True),
        sa.Column("author_speaker_id", sa.UUID(), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(
            ["author_speaker_id"],
            ["speakers.id"],
            name=op.f("fk_file_comments_author_speaker_id"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["author_user_id"],
            ["users.id"],
            name=op.f("fk_file_comments_author_user_id"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["org_id"],
            ["organizations.id"],
            name=op.f("fk_file_comments_org_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_file_comments")),
    )
    op.create_index(op.f("ix_file_comments_org_id"), "file_comments", ["org_id"], unique=False)
    op.create_index(
        "ix_file_comments_version_group_created",
        "file_comments",
        ["version_group_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_file_comments_version_group_created", table_name="file_comments")
    op.drop_index(op.f("ix_file_comments_org_id"), table_name="file_comments")
    op.drop_table("file_comments")
    sa.Enum(name="comment_author_kind").drop(op.get_bind())
