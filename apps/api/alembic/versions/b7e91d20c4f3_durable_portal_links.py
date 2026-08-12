"""A durable portal link per speaker per event.

The magic-link flow stays exactly as it was — single-use, 30 minutes, the
secure default. This column adds the convenience the owner asked for on top of
it: one reusable link per speaker per event, stored as a SHA-256 hash like
every other token, revoked by rotation (only the newest hash is kept). A
speaker on twenty events holds twenty links, each opening the right portal.

Revision ID: b7e91d20c4f3
Revises: a2f6c34ae0b5
Create Date: 2026-08-12
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7e91d20c4f3"
down_revision: str | None = "a2f6c34ae0b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "event_speakers", sa.Column("portal_link_hash", sa.String(length=64), nullable=True)
    )
    op.create_index(
        "ix_event_speakers_portal_link_hash",
        "event_speakers",
        ["portal_link_hash"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_event_speakers_portal_link_hash", table_name="event_speakers")
    op.drop_column("event_speakers", "portal_link_hash")
