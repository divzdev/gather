"""message calendar body and draft reminder stamp

Two additive columns, nothing rewritten.

`messages.ics_body` holds the VCALENDAR text a message carries. It was built by
`notify_affected`, used to set the `ics_attached` boolean, and then discarded —
so the flag said an invite went and none had. The text has to live on the row
rather than in the queueing request, because the worker delivers messages it did
not queue.

`submissions.last_reminded_at` is the floor that stops the nightly sweep telling
the same person five nights running that their draft is unfinished. Same shape as
`speaker_tasks.last_nudged_at`.

Autogenerate also proposed dropping the server default on
`task_templates.sets_profile_photo`. That is pre-existing drift between the model
and the database, unrelated to either column here, and it was removed from
migration 77f33f0ce835 for the same reason: a migration that quietly changes a
column nobody in this change touched is how an unreviewed schema edit ships.

Revision ID: 015e7dc138a5
Revises: 77f33f0ce835
Create Date: 2026-08-17 19:06:07.273323
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "015e7dc138a5"
down_revision: str | None = "77f33f0ce835"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("ics_body", sa.Text(), nullable=True))
    op.add_column(
        "submissions", sa.Column("last_reminded_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("submissions", "last_reminded_at")
    op.drop_column("messages", "ics_body")
