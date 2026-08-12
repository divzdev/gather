from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.core.deps import DbSession, bind_tenant, require_role
from app.features.forms import service
from app.features.forms.schema import FormSchema
from app.features.forms.schemas import FormCreate, FormRead, FormUpdate
from app.models import Form, Role, User

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


@router.get("", response_model=list[FormRead])
async def list_forms(session: DbSession, _: User = Depends(require_role(*READ))) -> list[FormRead]:
    rows = (await session.execute(select(Form).order_by(Form.created_at))).scalars().all()
    return [_read(f) for f in rows]


@router.post("", response_model=FormRead, status_code=status.HTTP_201_CREATED)
async def create_form(
    body: FormCreate, session: DbSession, _: User = Depends(require_role(*WRITE))
) -> FormRead:
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
