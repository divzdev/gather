"""Where an organisation's local model server lives.

Revision ID: c4e21a8b90d7
Revises: a1b9f7c30e42
Create Date: 2026-08-16

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c4e21a8b90d7"
down_revision = "a1b9f7c30e42"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Only meaningful when ai_provider = 'ollama'. Nullable rather than a
    # separate table because it is one string belonging to the row that already
    # holds the provider and the model — splitting it would be a join to learn
    # one field.
    op.add_column("organizations", sa.Column("ai_base_url", sa.String(300), nullable=True))


def downgrade() -> None:
    op.drop_column("organizations", "ai_base_url")
