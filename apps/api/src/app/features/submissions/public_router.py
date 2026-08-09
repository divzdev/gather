"""Anonymous surfaces: the CFP form, drafts, submitting, and status by code.

No authentication anywhere in this module. The event is resolved from its public
slug by `bind_public_event`, which also binds the tenant for the request — so
these handlers are scoped exactly like an authenticated one, without a caller.
"""

from __future__ import annotations

from fastapi import APIRouter, Request, status
from sqlalchemy import select

from app.core import rate_limit
from app.core.deps import DbSession, PublicEvent
from app.core.errors import ApiError, NotFoundError
from app.core.security import hash_ip
from app.features.forms.schema import FormSchema
from app.features.forms.schemas import PublicFormRead
from app.features.submissions import service
from app.features.submissions.schemas import (
    DraftRequest,
    DraftResponse,
    PublicStatus,
    SubmitRequest,
    SubmittedResponse,
)
from app.models import Event, Form, FormKind, Submission

router = APIRouter(prefix="/v1/public/events/{event_slug}", tags=["public"])


async def _cfp_form(session: DbSession, event: Event) -> Form:
    form = await session.scalar(
        select(Form).where(Form.kind == FormKind.CFP).order_by(Form.created_at.desc())
    )
    if form is None:
        raise NotFoundError("This event is not accepting proposals yet.")
    return form


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "anon"


@router.get("/cfp-form", response_model=PublicFormRead)
async def read_cfp_form(event: PublicEvent, session: DbSession) -> PublicFormRead:
    form = await _cfp_form(session, event)

    closed_reason: str | None = None
    try:
        service.check_window_open(event, form)
        is_open = True
    except ApiError as exc:
        # The page renders either way — a closed CFP says so instead of 404ing.
        is_open = False
        closed_reason = exc.message

    return PublicFormRead(
        event_name=event.name,
        event_slug=event.slug,
        event_description=event.description,
        form_id=form.id,
        form_name=form.name,
        schema=FormSchema.model_validate(form.schema),
        closes_at=form.closes_at or event.cfp_closes_at,
        is_open=is_open,
        closed_reason=closed_reason,
    )


@router.post("/submissions/draft", response_model=DraftResponse)
async def save_draft(
    body: DraftRequest, request: Request, event: PublicEvent, session: DbSession
) -> DraftResponse:
    await rate_limit.enforce(
        request.app.state.redis,
        rate_limit.PUBLIC_DRAFT_SAVE,
        bucket="draft",
        identifier=str(body.draft_token or _client_ip(request)),
    )
    form = await _cfp_form(session, event)
    submission = await service.save_draft(
        session,
        event=event,
        form=form,
        title=body.title,
        answers=body.answers,
        speaker_email=str(body.speaker_email),
        speaker_name=body.speaker_name,
        draft_token=body.draft_token,
    )
    return DraftResponse(
        id=submission.id,
        code=submission.code,
        draft_token=submission.draft_token,
        status=submission.status,
    )


@router.post("/submissions", response_model=SubmittedResponse, status_code=status.HTTP_201_CREATED)
async def submit(
    body: SubmitRequest, request: Request, event: PublicEvent, session: DbSession
) -> SubmittedResponse:
    await rate_limit.enforce(
        request.app.state.redis,
        rate_limit.PUBLIC_SUBMISSION,
        bucket="submit",
        identifier=_client_ip(request),
    )
    form = await _cfp_form(session, event)
    submission = await service.submit(
        session,
        event=event,
        form=form,
        title=body.title,
        answers=body.answers,
        speaker_email=str(body.speaker_email),
        speaker_name=body.speaker_name,
        draft_token=body.draft_token,
    )
    submission.ip_hash = hash_ip(_client_ip(request))
    return SubmittedResponse(
        id=submission.id,
        code=submission.code,
        status=submission.status,
        confirmation_message=FormSchema.model_validate(form.schema).settings.confirmation_message,
    )


@router.get("/submissions/{code}/status", response_model=PublicStatus)
async def submission_status(code: str, event: PublicEvent, session: DbSession) -> PublicStatus:
    submission = await session.scalar(select(Submission).where(Submission.code == code.upper()))
    if submission is None:
        raise NotFoundError("No proposal with that code.")
    return PublicStatus.model_validate(service.public_status(submission))
