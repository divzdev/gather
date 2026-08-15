from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.core.deps import DbSession, bind_tenant, require_role
from app.core.errors import ApiError, FormLockedError
from app.core.tenancy import current_tenant, tenancy_disabled
from app.features.forms import service
from app.features.forms.schema import FormSchema
from app.features.forms.schemas import FormCreate, FormRead, FormUpdate
from app.models import Event, Form, Role, User

router = APIRouter(
    prefix="/v1/events/{event_id}/forms", tags=["forms"], dependencies=[Depends(bind_tenant)]
)

WRITE = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)
READ = (Role.OWNER, Role.ADMIN, Role.COORDINATOR, Role.REVIEWER)


def _read(form: Form) -> FormRead:
    return FormRead(
        id=form.id,
        name=form.name,
        kind=form.kind,
        schema=FormSchema.model_validate(form.schema),
        status=form.status,
        is_locked=form.is_locked,
        opens_at=form.opens_at,
        closes_at=form.closes_at,
    )


async def _dates_are_not_older_than_the_event(
    session: DbSession, *, opens_at: datetime | None, closes_at: datetime | None
) -> None:
    """A form window cannot start before the event it belongs to existed.

    Closing *before the conference* is normal — a call for papers has to. What
    is not is a deadline in 2005, which is what a mistyped year in a
    datetime field produces; the form then reports itself permanently shut and
    the public page shows a countdown that expired two decades ago.

    The floor is the event's creation, deliberately, not `now`. Backdating a
    deadline to last week is a real thing an organiser does — recording a call
    that has already closed — and a `now` floor would refuse that honest edit to
    catch the typo. Everything before the event existed is unambiguously wrong.
    """
    tenant = current_tenant()
    with tenancy_disabled():
        event = await session.get(Event, tenant.event_id)
    if event is None:  # pragma: no cover - bind_tenant proved it exists
        return
    floor = event.created_at
    for field, value in (("opens_at", opens_at), ("closes_at", closes_at)):
        if value is not None and value < floor:
            raise ApiError(
                f"That date is before {event.name} was created "
                f"({floor:%-d %b %Y}), so it cannot be right. "
                "Check the year.",
                code="VALIDATION_FAILED",
                status_code=422,
                field=field,
            )


@router.get("", response_model=list[FormRead])
async def list_forms(session: DbSession, _: User = Depends(require_role(*READ))) -> list[FormRead]:
    rows = (await session.execute(select(Form).order_by(Form.created_at))).scalars().all()
    return [_read(f) for f in rows]


@router.post("", response_model=FormRead, status_code=status.HTTP_201_CREATED)
async def create_form(
    body: FormCreate, session: DbSession, _: User = Depends(require_role(*WRITE))
) -> FormRead:
    await _dates_are_not_older_than_the_event(
        session, opens_at=body.opens_at, closes_at=body.closes_at
    )
    form = Form(
        name=body.name,
        kind=body.kind,
        schema=body.schema_.model_dump(mode="json"),
        opens_at=body.opens_at,
        closes_at=body.closes_at,
    )
    session.add(form)
    await session.flush()
    return _read(form)


@router.get("/{form_id}", response_model=FormRead)
async def read_form(
    form_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*READ))
) -> FormRead:
    return _read(await service.get_form(session, form_id))


@router.patch("/{form_id}", response_model=FormRead)
async def update_form(
    form_id: uuid.UUID,
    body: FormUpdate,
    session: DbSession,
    _: User = Depends(require_role(*WRITE)),
) -> FormRead:
    form = await service.get_form(session, form_id)
    await service.lock_if_needed(session, form)

    # Only what this request carries. Checking the merged row would re-reject a
    # form whose stored window already predates the event, leaving it uneditable.
    await _dates_are_not_older_than_the_event(
        session,
        opens_at=body.opens_at if "opens_at" in body.model_fields_set else None,
        closes_at=body.closes_at if "closes_at" in body.model_fields_set else None,
    )

    # What the form *is* — a call for papers or a task sent to people already on
    # the programme — decides which screens read it and what its submissions
    # mean. Flipping that under collected proposals reclassifies every one of
    # them, so it follows the same lock as the schema rather than a rule of its
    # own. Compared before assigning: re-sending the current kind on an
    # otherwise ordinary save must not fail a locked form.
    if body.kind is not None and body.kind != form.kind:
        if form.is_locked:
            raise FormLockedError(
                "This form has submissions, so what it collects is fixed. "
                "Create a new form for the other kind."
            )
        form.kind = body.kind

    if body.schema_ is not None:
        service.check_schema_change(
            FormSchema.model_validate(form.schema), body.schema_, is_locked=form.is_locked
        )
        form.schema = body.schema_.model_dump(mode="json")

    # Driven by what the caller actually sent, not by whether the value is None.
    # A `None` check cannot tell an omitted field from an explicit null, so
    # `opens_at` and `closes_at` could be overwritten but never *cleared* — an
    # organiser who set a close date by mistake had no route back to an open
    # call except setting a different one.
    for field in ("name", "status", "opens_at", "closes_at"):
        if field in body.model_fields_set:
            setattr(form, field, getattr(body, field))

    await session.flush()
    return _read(form)


@router.delete("/{form_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_form(
    form_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*WRITE))
) -> None:
    form = await service.get_form(session, form_id)
    await service.lock_if_needed(session, form)
    if form.is_locked:
        from app.core.errors import FormLockedError

        raise FormLockedError("This form has submissions and cannot be deleted. Close it instead.")
    await session.delete(form)
