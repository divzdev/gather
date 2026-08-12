"""verified addresses and github identities

Revision ID: b3d7e2c15a49
Revises: aacc9910bf6e
Create Date: 2026-08-11 20:12:44.108233
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b3d7e2c15a49"
down_revision: str | None = "aacc9910bf6e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("users", sa.Column("github_user_id", sa.String(length=40), nullable=True))
    op.create_unique_constraint("uq_users_github_user_id", "users", ["github_user_id"])

    # Everyone who already had an account keeps working. Verification exists to
    # stop a throwaway signup mailing two hundred speakers, and an account that
    # predates the column has already been trusted with exactly that — turning
    # them all unverified would be a silent outage dressed up as a security fix.
    op.execute("UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL")

    op.add_column("magic_links", sa.Column("user_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_magic_links_user_id",
        "magic_links",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Postgres 12+ allows this inside a transaction as long as the value is not
    # also *used* here, which it is not: the first staff link is written by the
    # application, long after this has committed.
    op.execute("ALTER TYPE magic_link_purpose ADD VALUE IF NOT EXISTS 'staff_login'")


def downgrade() -> None:
    op.drop_constraint("fk_magic_links_user_id", "magic_links", type_="foreignkey")
    op.drop_column("magic_links", "user_id")
    op.drop_constraint("uq_users_github_user_id", "users", type_="unique")
    op.drop_column("users", "github_user_id")
    op.drop_column("users", "email_verified_at")
    # The enum value stays. Dropping one requires rewriting the type and every
    # column using it, and leaving an unused label costs nothing.
