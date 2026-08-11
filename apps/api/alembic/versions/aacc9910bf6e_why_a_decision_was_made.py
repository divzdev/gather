"""why a decision was made

Revision ID: aacc9910bf6e
Revises: 0f5035b273b0
Create Date: 2026-08-11 16:05:02.591302
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "aacc9910bf6e"
down_revision: str | None = "0f5035b273b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The enum type already exists (submissions.status uses it), so create_type
    # is off — otherwise this migration tries to define it a second time.
    op.add_column(
        "submission_notes",
        sa.Column(
            "decision_outcome",
            postgresql.ENUM(name="submission_status", create_type=False),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("submission_notes", "decision_outcome")
