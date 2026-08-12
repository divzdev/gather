"""Close the drift between three recent migrations and the models.

`alembic check` — which CI runs on every push — had been failing since three
feature migrations described columns differently from the models they shipped
with. The models are the source of truth here (the conventions are theirs:
`Timestamps` is NOT NULL with a server default, Python-side defaults everywhere
else, `org_id` indexed on every scoped table), so this brings the schema to the
models rather than editing the shipped migrations, which are forward-only.

- `saved_embeds` (f2a7c9d41b08) left `created_at`/`updated_at` nullable and
  added server defaults to `theme` and `limit` that the model declares as
  Python defaults; it also created the `event_id` index but not `org_id`.
- `sessions.tags`, `speakers.tags`, `speakers.crm_status` (c5a1e39b7d42,
  b41c7e5a92d0) gained server defaults the models never declared.

The trigram index from c81f4a20d5e7 is deliberately NOT touched: it is real,
duplicate detection uses it, and the fix for autogenerate proposing to drop it
was to declare it on the Submission model, not to remove it.

Revision ID: a2f6c34ae0b5
Revises: c81f4a20d5e7
Create Date: 2026-08-12
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a2f6c34ae0b5"
down_revision: str | None = "c81f4a20d5e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Every existing row got its timestamps from the server default, so this
    # backfill should touch zero rows — it exists so SET NOT NULL cannot fail
    # on a database where something ever inserted an explicit NULL.
    op.execute("UPDATE saved_embeds SET created_at = now() WHERE created_at IS NULL")
    op.execute("UPDATE saved_embeds SET updated_at = now() WHERE updated_at IS NULL")

    op.alter_column(
        "saved_embeds",
        "theme",
        existing_type=sa.VARCHAR(length=20),
        server_default=None,
        existing_nullable=False,
    )
    op.alter_column(
        "saved_embeds",
        "limit",
        existing_type=sa.INTEGER(),
        server_default=None,
        existing_nullable=False,
    )
    op.alter_column(
        "saved_embeds",
        "created_at",
        existing_type=postgresql.TIMESTAMP(timezone=True),
        nullable=False,
        existing_server_default=sa.text("now()"),
    )
    op.alter_column(
        "saved_embeds",
        "updated_at",
        existing_type=postgresql.TIMESTAMP(timezone=True),
        nullable=False,
        existing_server_default=sa.text("now()"),
    )
    op.create_index(op.f("ix_saved_embeds_org_id"), "saved_embeds", ["org_id"], unique=False)
    op.alter_column(
        "sessions",
        "tags",
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        server_default=None,
        existing_nullable=False,
    )
    op.alter_column(
        "speakers",
        "tags",
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        server_default=None,
        existing_nullable=False,
    )
    op.alter_column(
        "speakers",
        "crm_status",
        existing_type=sa.VARCHAR(length=40),
        server_default=None,
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "speakers",
        "crm_status",
        existing_type=sa.VARCHAR(length=40),
        server_default=sa.text("'prospect'::character varying"),
        existing_nullable=False,
    )
    op.alter_column(
        "speakers",
        "tags",
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        server_default=sa.text("'[]'::jsonb"),
        existing_nullable=False,
    )
    op.alter_column(
        "sessions",
        "tags",
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        server_default=sa.text("'[]'::jsonb"),
        existing_nullable=False,
    )
    op.drop_index(op.f("ix_saved_embeds_org_id"), table_name="saved_embeds")
    op.alter_column(
        "saved_embeds",
        "updated_at",
        existing_type=postgresql.TIMESTAMP(timezone=True),
        nullable=True,
        existing_server_default=sa.text("now()"),
    )
    op.alter_column(
        "saved_embeds",
        "created_at",
        existing_type=postgresql.TIMESTAMP(timezone=True),
        nullable=True,
        existing_server_default=sa.text("now()"),
    )
    op.alter_column(
        "saved_embeds",
        "limit",
        existing_type=sa.INTEGER(),
        server_default=sa.text("5"),
        existing_nullable=False,
    )
    op.alter_column(
        "saved_embeds",
        "theme",
        existing_type=sa.VARCHAR(length=20),
        server_default=sa.text("'light'::character varying"),
        existing_nullable=False,
    )
