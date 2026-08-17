"""co-speaker role and ai provenance on a review

Two additive columns, both nullable, neither backfilled.

`submission_speakers.role` records what a co-speaker actually is —
co-presenter, co-author — which `is_primary` cannot express and which the
programme has to print.

`reviews.ai_proposal_id` records that a review was written by accepting a model
suggestion. It is provenance and not authorship: `reviews.user_id` stays NOT
NULL and stays the accepting human, so an AI-authored review is still not
representable. Nulls mean "a human typed this cold", which is the correct answer
for every row that exists today.

Autogenerate also proposed dropping the server default on
`task_templates.sets_profile_photo`. That is pre-existing drift between the model
and the database and has nothing to do with either column here; dropping it would
break any insert that omits the column. Left alone deliberately.

Revision ID: 77f33f0ce835
Revises: d5a1c72e9f30
Create Date: 2026-08-16 23:55:09.000626
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "77f33f0ce835"
down_revision: str | None = "d5a1c72e9f30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("reviews", sa.Column("ai_proposal_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        op.f("fk_reviews_ai_proposal_id"),
        "reviews",
        "ai_proposals",
        ["ai_proposal_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("submission_speakers", sa.Column("role", sa.String(length=60), nullable=True))


def downgrade() -> None:
    op.drop_column("submission_speakers", "role")
    op.drop_constraint(op.f("fk_reviews_ai_proposal_id"), "reviews", type_="foreignkey")
    op.drop_column("reviews", "ai_proposal_id")
