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
    EditRequest,
    OpenRequest,
    OpenResponse,
    PublicStatus,
    SubmitRequest,
    SubmittedResponse,
)
from app.models import Event, Form, FormKind, FormStatus, Submission

router = APIRouter(prefix="/v1/public/events/{event_slug}", tags=["public"])


async def _cfp_form(session: DbSession, event: Event) -> Form:
    """The form the public sees: the newest one that is not still a draft.

    Taking the newest of *any* status meant starting a second form in the
    builder silently replaced the live call for papers with an empty untitled
    one — while the organiser was still deciding what to put on it. A draft is
    by definition not published, so it is not served.
    """
    published = (
        select(Form)
        .where(Form.kind == FormKind.CFP, Form.status != FormStatus.DRAFT)
        .order_by(Form.created_at.desc())
    )
    form = await session.scalar(published)
    if form is None:
        # Nothing published yet. Fall back to the newest draft so a brand-new
        # event shows its form rather than a 404, which is the state every event
        # starts in.
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
        event_starts_on=event.starts_on,
        event_ends_on=event.ends_on,
        event_location=event.location,
        form_id=form.id,
        form_name=form.name,
        schema=FormSchema.model_validate(form.schema),
        closes_at=form.closes_at or event.cfp_closes_at,
        event_timezone=event.timezone,
        submission_limit_per_speaker=event.submission_limit_per_speaker,
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
        co_speakers=[(person.name, str(person.email), person.role) for person in body.co_speakers],
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
    # Two ceilings, because they are answering different questions. The address
    # is who is submitting; the IP is only where from, and keying the tight limit
    # to it made colleagues throttle each other.
    await rate_limit.enforce(
        request.app.state.redis,
        rate_limit.PUBLIC_SUBMISSION,
        bucket="submit",
        identifier=str(body.speaker_email).strip().lower(),
    )
    await rate_limit.enforce(
        request.app.state.redis,
        rate_limit.PUBLIC_SUBMISSION_PER_IP,
        bucket="submit-ip",
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
        co_speakers=[(person.name, str(person.email), person.role) for person in body.co_speakers],
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
    form = await session.get(Form, submission.form_id)
    return PublicStatus.model_validate(
        {
            **service.public_status(submission),
            "can_edit": form is not None and service.is_editable(event, form, submission),
        }
    )


@router.post("/submissions/{code}/open", response_model=OpenResponse)
async def open_submission(
    code: str, body: OpenRequest, event: PublicEvent, session: DbSession
) -> OpenResponse:
    """The submitter's own answers back, for the edit form to start from.

    Separate from `/status`, which anyone holding a code can read and which
    therefore never carries answers.
    """
    submission = await session.scalar(select(Submission).where(Submission.code == code.upper()))
    if submission is None or submission.draft_token != body.draft_token:
        raise NotFoundError("No proposal with that code.")
    form = await session.get(Form, submission.form_id)
    return OpenResponse(
        code=submission.code,
        title=submission.title,
        answers=dict(submission.answers),
        stage=str(service.public_status(submission)["stage"]),
        can_edit=form is not None and service.is_editable(event, form, submission),
    )


@router.put("/submissions/{code}", response_model=SubmittedResponse)
async def edit_submission(
    code: str,
    body: EditRequest,
    request: Request,
    event: PublicEvent,
    session: DbSession,
) -> SubmittedResponse:
    """Correct a proposal that is already in, until the call closes.

    Rate-limited like a draft save rather than like a submission: this is the
    same person editing the same row, not a new proposal arriving.
    """
    await rate_limit.enforce(
        request.app.state.redis,
        rate_limit.PUBLIC_DRAFT_SAVE,
        bucket="edit",
        identifier=str(body.draft_token),
    )
    submission = await session.scalar(select(Submission).where(Submission.code == code.upper()))
    # One 404 for "no such proposal" and for "not your proposal". A code is a
    # lookup key, not a secret, and the difference between those two answers is
    # exactly what would turn it into one.
    if submission is None or submission.draft_token != body.draft_token:
        raise NotFoundError("No proposal with that code.")

    form = await session.get(Form, submission.form_id)
    if form is None:  # pragma: no cover - a submission always has its form
        raise NotFoundError("This proposal's form is missing.")

    await service.edit_submitted(
        session,
        event=event,
        form=form,
        submission=submission,
        title=body.title,
        answers=body.answers,
    )
    return SubmittedResponse(
        id=submission.id,
        code=submission.code,
        status=submission.status,
        confirmation_message="Your changes are saved.",
    )
