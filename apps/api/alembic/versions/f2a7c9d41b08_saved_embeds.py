"""saved embeds

An organiser's kept embed settings. Not the snippet text — the script is
regenerated from these on read, so a saved embed inherits later fixes to the
generator instead of preserving what it emitted the day it was saved.

Revision ID: f2a7c9d41b08
Revises: e7c4b1a90f33
Create Date: 2026-08-11
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f2a7c9d41b08"
down_revision: str | None = "e7c4b1a90f33"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "saved_embeds",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("widget", sa.String(length=40), nullable=False),
        sa.Column("theme", sa.String(length=20), nullable=False, server_default="light"),
        sa.Column("track", sa.String(length=80), nullable=True),
        sa.Column("limit", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_saved_embeds_event_id", "saved_embeds", ["event_id"])


def downgrade() -> None:
    op.drop_index("ix_saved_embeds_event_id", table_name="saved_embeds")
    op.drop_table("saved_embeds")
