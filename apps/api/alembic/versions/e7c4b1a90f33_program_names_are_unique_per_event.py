"""program names are unique per event

The brief specifies unique(event_id, name) on rooms, tracks and session_formats.
Only event_days ever got its constraint, so an event could hold two rooms called
Main Stage — the agenda would draw two identical columns and a placement could
land in either — and two tracks with the same name, which made the track filter
ambiguous and the public schedule's colour key wrong.

Revision ID: e7c4b1a90f33
Revises: c5a1e39b7d42
Create Date: 2026-08-11
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "e7c4b1a90f33"
down_revision: str | None = "c5a1e39b7d42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("rooms", "tracks", "session_formats")


def upgrade() -> None:
    for table in TABLES:
        op.create_unique_constraint(f"uq_{table}_event_id_name", table, ["event_id", "name"])


def downgrade() -> None:
    for table in TABLES:
        op.drop_constraint(f"uq_{table}_event_id_name", table, type_="unique")
