"""Trigram similarity, for finding duplicate submissions.

Duplicate detection shortlists candidate pairs in Postgres before a model sees
anything. 214 submissions is 22,791 pairs; sending those to a language model
would be an absurd bill for a worse answer than `similarity()` gives for free.
The model only adjudicates the shortlist.

`CREATE EXTENSION IF NOT EXISTS` rather than plain CREATE: the extension may
already be present on a shared instance, and a migration that fails because
somebody else installed something is a migration that blocks a deploy for no
reason.

Revision ID: c81f4a20d5e7
Revises: b3d7e2c15a49
"""

from __future__ import annotations

from alembic import op

revision = "c81f4a20d5e7"
down_revision = "b3d7e2c15a49"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    # GIN over title alone. The abstract is in the similarity score but not the
    # index: it is long enough that indexing it costs more on every submission
    # write than it saves on a scan somebody runs once per event.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_submissions_title_trgm "
        "ON submissions USING gin (title gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_submissions_title_trgm")
    # The extension is deliberately left installed. Dropping it would break any
    # other database object built on it, and it is harmless idle.
