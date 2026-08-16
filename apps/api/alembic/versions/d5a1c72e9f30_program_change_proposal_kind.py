"""The assistant's program-change proposal kind (spec 0008).

Revision ID: d5a1c72e9f30
Revises: b3f8c2e51a04
Create Date: 2026-08-16

"""

from __future__ import annotations

from alembic import op

revision = "d5a1c72e9f30"
down_revision = "b3f8c2e51a04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Additive, and the value is not used in this migration — the first
    # program_change row is written by the application long after this commits.
    # Same shape as a1b9f7c30e42's `answer`.
    op.execute("ALTER TYPE ai_proposal_kind ADD VALUE IF NOT EXISTS 'program_change'")


def downgrade() -> None:
    # Postgres cannot remove a value from an enum, and the project's migrations
    # are forward-only regardless.
    pass
