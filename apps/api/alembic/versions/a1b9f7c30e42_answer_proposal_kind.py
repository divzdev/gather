"""The event assistant's proposal kind.

Revision ID: a1b9f7c30e42
Revises: 3aa2057460ad
Create Date: 2026-08-15

"""

from __future__ import annotations

from alembic import op

revision = "a1b9f7c30e42"
down_revision = "3aa2057460ad"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Postgres 12+ allows this inside a transaction as long as the value is not
    # also *used* here, which it is not: the first answer row is written by the
    # application, long after this has committed. Same case as
    # b3d7e2c15a49's `staff_login`.
    op.execute("ALTER TYPE ai_proposal_kind ADD VALUE IF NOT EXISTS 'answer'")


def downgrade() -> None:
    # Postgres cannot remove a value from an enum. Dropping and recreating the
    # type would have to rewrite every ai_proposals row and every dependent
    # view, to delete a value nothing reads. Forward-only, as the project's
    # migrations are anyway.
    pass
