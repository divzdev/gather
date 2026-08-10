"""Sending decisions — the one place a decision reaches a speaker.

Recording a decision and sending it are separate acts. Setting accept or reject
writes `decision_status = pending_send` and emails nobody; only this endpoint
sends, and only when the caller's count of who is about to be emailed matches
the count the server computes for itself. A stale screen therefore cannot mass
email the wrong outcome to two hundred people.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.core import mail
from app.core.deps import DbSession, bind_tenant, require_role
from app.core.errors import ApiError, NotFoundError, RecipientCountMismatchError
from app.core.pagination import ListQueryDep, PageMeta, paginate
from app.core.tenancy import current_tenant
from app.models import (
    DecisionStatus,
    Event,
    Message,
    MessageBatch,
    MessagePurpose,
    MessageStatus,
    Role,
    Speaker,
    Submission,
    SubmissionSpeaker,
    SubmissionStatus,
    User,
)

router = APIRouter(
    prefix="/v1/events/{event_id}/messages",
    tags=["messaging"],
    dependencies=[Depends(bind_tenant)],
)

READ = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)
SEND = (Role.OWNER, Role.ADMIN)

DECIDED = (SubmissionStatus.ACCEPTED, SubmissionStatus.WAITLISTED, SubmissionStatus.REJECTED)

#: Only these can be retried. Resending something that arrived is how one person
#: gets told twice.
RESENDABLE = (MessageStatus.FAILED, MessageStatus.BOUNCED)

PURPOSES = {
    SubmissionStatus.ACCEPTED: MessagePurpose.ACCEPTANCE,
    SubmissionStatus.WAITLISTED: MessagePurpose.WAITLIST,
    SubmissionStatus.REJECTED: MessagePurpose.REJECTION,
}

SUBJECTS = {
    SubmissionStatus.ACCEPTED: "Your proposal for {event} was accepted",
    SubmissionStatus.WAITLISTED: "Your proposal for {event} is waitlisted",
    SubmissionStatus.REJECTED: "About your proposal for {event}",
}

BODIES = {
    SubmissionStatus.ACCEPTED: (
        "Hello {name},\n\n"
        "We would like to include “{title}” at {event}.\n\n"
        "Reply to confirm you can still attend, and we will follow up with what we "
        "need from you next.\n\nThank you for proposing it.\n"
    ),
    SubmissionStatus.WAITLISTED: (
        "Hello {name},\n\n"
        "“{title}” is on our waiting list for {event}.\n\n"
        "The programme is strong this year and we could not fit everything we wanted. "
        "If a slot opens we will be in touch quickly.\n"
    ),
    SubmissionStatus.REJECTED: (
        "Hello {name},\n\n"
        "We are not able to include “{title}” at {event} this time.\n\n"
        "We had far more good proposals than slots. Please do submit again.\n"
    ),
}


class Recipient(BaseModel):
    model_config = ConfigDict(extra="forbid")

    submission_id: uuid.UUID
    code: str
    title: str
    outcome: SubmissionStatus
    name: str
    email: str


class RecipientPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total: int
    by_outcome: dict[str, int]
    recipients: list[Recipient]


class SendRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Named for what it is: the number the operator saw on screen.
    confirm_recipient_count: int = Field(ge=0)
    outcomes: list[SubmissionStatus] | None = None


class SendResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sent: int
    batch_id: uuid.UUID


async def _pending(session: DbSession, outcomes: list[SubmissionStatus] | None) -> list[Recipient]:
    """Everyone with a decision recorded and not yet sent, with who to email."""
    wanted = tuple(outcomes) if outcomes else DECIDED
    rows = (
        (
            await session.execute(
                select(Submission, Speaker)
                .join(SubmissionSpeaker, SubmissionSpeaker.submission_id == Submission.id)
                .join(Speaker, Speaker.id == SubmissionSpeaker.speaker_id)
                .where(
                    Submission.decision_status == DecisionStatus.PENDING_SEND,
                    Submission.status.in_(wanted),
                    SubmissionSpeaker.is_primary.is_(True),
                )
                .order_by(Submission.code)
            )
        )
        .tuples()
        .all()
    )
    return [
        Recipient(
            submission_id=submission.id,
            code=submission.code,
            title=submission.title,
            outcome=submission.status,
            name=speaker.name,
            email=speaker.email,
        )
        for submission, speaker in rows
    ]


@router.get("/decision-recipients", response_model=RecipientPreview)
async def decision_recipients(
    session: DbSession, _: User = Depends(require_role(*READ))
) -> RecipientPreview:
    recipients = await _pending(session, None)
    by_outcome: dict[str, int] = {}
    for recipient in recipients:
        by_outcome[recipient.outcome.value] = by_outcome.get(recipient.outcome.value, 0) + 1
    return RecipientPreview(total=len(recipients), by_outcome=by_outcome, recipients=recipients)


class OutboxRow(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    to_email: str
    subject: str
    status: MessageStatus
    created_at: datetime
    error_detail: str | None


class OutboxPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[OutboxRow]
    meta: PageMeta


@router.get("/outbox", response_model=OutboxPage)
async def outbox(
    session: DbSession, query: ListQueryDep, _: User = Depends(require_role(*READ))
) -> OutboxPage:
    """One row per recipient, newest first. Delivery state lives here, so a
    bounce is visible rather than assumed.

    Paginated rather than capped: this was a bare `limit(200)`, so an organiser
    who had sent more than that saw the newest two hundred and had no way to know
    the rest existed — in the one place that records what actually went out.
    """
    statement = select(Message).order_by(Message.created_at.desc())
    rows, meta = await paginate(session, statement, query)
    return OutboxPage(data=[OutboxRow.model_validate(row) for row in rows], meta=meta)


class ResendResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    status: MessageStatus


@router.post("/outbox/{message_id}/resend", response_model=ResendResult)
async def resend(
    message_id: uuid.UUID,
    session: DbSession,
    _: User = Depends(require_role(*SEND)),
) -> ResendResult:
    """Try one failed or bounced message again.

    A new row rather than a retry in place, so the outbox keeps the record of
    what went wrong the first time — an organiser explaining a missed acceptance
    to a speaker needs the history, not a row that has quietly turned green.

    Only failures are resendable: offering it on a delivered message is how the
    same person gets told twice.
    """
    original = await session.get(Message, message_id)
    if original is None:
        raise NotFoundError(f"No message with id {message_id}.")
    if original.status not in RESENDABLE:
        raise ApiError(
            f"That message is {original.status.value}, so there is nothing to retry.",
            code="MESSAGE_NOT_RESENDABLE",
            status_code=409,
        )

    tenant = current_tenant()
    if tenant.event_id is None:
        raise NotFoundError("No event in scope.")

    retry = await mail.queue(
        session,
        event_id=tenant.event_id,
        to_email=original.to_email,
        subject=original.subject,
        body=original.body_rendered,
        to_speaker_id=original.to_speaker_id,
        batch_id=original.batch_id,
    )
    await session.flush()
    return ResendResult(id=retry.id, status=retry.status)


@router.post("/send-decisions", response_model=SendResult)
async def send_decisions(
    body: SendRequest, session: DbSession, _: User = Depends(require_role(*SEND))
) -> SendResult:
    recipients = await _pending(session, body.outcomes)

    # The whole point of the endpoint. The screen may have been open for an hour
    # while somebody else decided three more; sending what the server found
    # instead of what the operator approved is the accident this prevents.
    if len(recipients) != body.confirm_recipient_count:
        raise RecipientCountMismatchError(
            f"You confirmed {body.confirm_recipient_count} recipients "
            f"but {len(recipients)} are pending. Reload and check before sending.",
            details={"expected": body.confirm_recipient_count, "actual": len(recipients)},
        )

    tenant = current_tenant()
    if tenant.event_id is None:
        raise RecipientCountMismatchError("No event in scope.")
    event = await session.get(Event, tenant.event_id)
    event_name = event.name if event else "the event"
    # One batch per send, so the outbox can show what went out together and the
    # count the operator confirmed is recorded next to it.
    batch = MessageBatch(
        org_id=tenant.org_id,
        event_id=tenant.event_id,
        recipient_count=len(recipients),
        segment_description="Decision notices",
        status=MessageStatus.QUEUED,
    )
    session.add(batch)
    await session.flush()
    batch_id = batch.id

    for recipient in recipients:
        context = {"name": recipient.name, "title": recipient.title, "event": event_name}
        await mail.queue(
            session,
            event_id=tenant.event_id,
            to_email=recipient.email,
            subject=SUBJECTS[recipient.outcome].format(**context),
            body=BODIES[recipient.outcome].format(**context),
            purpose=PURPOSES[recipient.outcome],
            batch_id=batch_id,
        )
        submission = await session.get(Submission, recipient.submission_id)
        if submission is not None:
            submission.decision_status = DecisionStatus.SENT

    await session.flush()
    return SendResult(sent=len(recipients), batch_id=batch_id)
