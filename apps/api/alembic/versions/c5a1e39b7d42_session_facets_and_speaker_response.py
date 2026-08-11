"""session tags, level and language; speaker's own confirm/decline

Revision ID: c5a1e39b7d42
Revises: b41c7e5a92d0
Create Date: 2026-08-11 09:10:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c5a1e39b7d42"
down_revision: str | None = "b41c7e5a92d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EXPERTISE = sa.Enum("beginner", "intermediate", "advanced", name="expertise_level")


def upgrade() -> None:
    EXPERTISE.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "sessions",
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column("sessions", sa.Column("expertise_level", EXPERTISE, nullable=True))
    op.add_column("sessions", sa.Column("language", sa.String(length=40), nullable=True))

    op.add_column(
        "event_speakers", sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("event_speakers", sa.Column("decline_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("event_speakers", "decline_reason")
    op.drop_column("event_speakers", "responded_at")
    op.drop_column("sessions", "language")
    op.drop_column("sessions", "expertise_level")
    op.drop_column("sessions", "tags")
    EXPERTISE.drop(op.get_bind(), checkfirst=True)
