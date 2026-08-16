"""A task template can declare that its upload is the speaker's profile photo.

The Headshot task collected a file that only its own row ever displayed, while
the public speaker card, the gallery and the embed all read
`Speaker.headshot_file_id` — set by a different endpoint entirely. So the one
deliverable an organiser chases with a deadline never reached the page it exists
to fill.

Declared rather than inferred: matching on the template's name breaks when
somebody renames it, and matching on "the upload is an image" would make a task
collecting a photo of someone's rig overwrite their face on the programme.

Revision ID: b3f8c2e51a04
Revises: c4e21a8b90d7
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b3f8c2e51a04"
down_revision = "c4e21a8b90d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "task_templates",
        sa.Column(
            "sets_profile_photo",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    # Existing events keep working: a template already named "Headshot" was
    # collecting exactly this and had nowhere to put it. Scoped to upload
    # templates so a form or acknowledgement called "Headshot" is untouched.
    op.execute(
        """
        UPDATE task_templates
           SET sets_profile_photo = true
         WHERE kind = 'upload'
           AND lower(name) = 'headshot'
        """
    )


def downgrade() -> None:
    op.drop_column("task_templates", "sets_profile_photo")
