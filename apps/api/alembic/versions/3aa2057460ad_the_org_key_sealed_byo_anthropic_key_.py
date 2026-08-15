"""The org key: a sealed BYO model key, its provider, and an org-wide daily cap.

Revision ID: 3aa2057460ad
Revises: b7e91d20c4f3
Create Date: 2026-08-15

All nullable, no backfill: an org without a key is the normal state, and NULL
cap means "server default". The provider and model live beside the key because
they describe it; the preset base URL deliberately does not — a stored URL
would be an SSRF primitive on the shared box, so it stays code.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "3aa2057460ad"
down_revision: str | None = "b7e91d20c4f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("ai_key_encrypted", sa.LargeBinary(), nullable=True))
    op.add_column("organizations", sa.Column("ai_key_last4", sa.String(length=4), nullable=True))
    op.add_column("organizations", sa.Column("ai_key_set_by", sa.UUID(), nullable=True))
    op.add_column(
        "organizations", sa.Column("ai_key_set_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("organizations", sa.Column("ai_provider", sa.String(length=40), nullable=True))
    op.add_column("organizations", sa.Column("ai_model", sa.String(length=120), nullable=True))
    op.add_column("organizations", sa.Column("ai_daily_proposal_cap", sa.Integer(), nullable=True))
    op.create_foreign_key(
        op.f("fk_organizations_ai_key_set_by"),
        "organizations",
        "users",
        ["ai_key_set_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_organizations_ai_key_set_by"), "organizations", type_="foreignkey")
    op.drop_column("organizations", "ai_daily_proposal_cap")
    op.drop_column("organizations", "ai_model")
    op.drop_column("organizations", "ai_provider")
    op.drop_column("organizations", "ai_key_set_at")
    op.drop_column("organizations", "ai_key_set_by")
    op.drop_column("organizations", "ai_key_encrypted")
    op.drop_column("organizations", "ai_key_last4")
