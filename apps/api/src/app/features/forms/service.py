from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import FormLockedError, NotFoundError
from app.features.forms.schema import FormSchema
from app.models import Form, Submission


async def get_form(session: AsyncSession, form_id: uuid.UUID) -> Form:
    form = await session.get(Form, form_id)
    if form is None:
        raise NotFoundError(f"No form with id {form_id}.")
    return form


async def submission_count(session: AsyncSession, form_id: uuid.UUID) -> int:
    total = await session.scalar(
        select(func.count(Submission.id)).where(Submission.form_id == form_id)
    )
    return int(total or 0)


def check_schema_change(current: FormSchema, incoming: FormSchema, *, is_locked: bool) -> None:
    """Once submissions exist, structure freezes but wording does not.

    Fields stay addable and labels, help text and required flags stay editable.
    Deleting a field or changing its type would silently reinterpret answers that
    already exist, so those are refused — hide the field from new submissions
    instead, which preserves the data.
    """
    if not is_locked:
        return

    current_fields = {f.key: f for f in current.all_fields()}
    incoming_fields = {f.key: f for f in incoming.all_fields()}

    removed = sorted(set(current_fields) - set(incoming_fields))
    if removed:
        raise FormLockedError(
            f"This form has submissions, so {removed[0]!r} cannot be deleted — "
            "set hidden_from_new instead so existing answers keep their meaning.",
            field=removed[0],
            details={"removed": removed},
        )

    retyped = sorted(
        key
        for key, field in incoming_fields.items()
        if key in current_fields and current_fields[key].type != field.type
    )
    if retyped:
        raise FormLockedError(
            f"This form has submissions, so {retyped[0]!r} cannot change type.",
            field=retyped[0],
            details={"retyped": retyped},
        )


async def lock_if_needed(session: AsyncSession, form: Form) -> None:
    """A form locks on its first submission and stays locked."""
    if form.is_locked:
        return
    if await submission_count(session, form.id) > 0:
        form.is_locked = True
