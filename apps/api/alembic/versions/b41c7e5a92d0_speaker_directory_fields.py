"""speaker directory tags and pipeline status

Revision ID: b41c7e5a92d0
Revises: a63f0094d8ea
Create Date: 2026-08-10 02:44:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b41c7e5a92d0"
down_revision: str | None = "a63f0094d8ea"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "speakers",
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "speakers",
        sa.Column(
            "crm_status",
            sa.String(length=40),
            nullable=False,
            server_default=sa.text("'prospect'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("speakers", "crm_status")
    op.drop_column("speakers", "tags")
