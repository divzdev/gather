from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import mail
from app.core.errors import (
    ApiError,
    CfpClosedError,
    ConflictError,
    NotFoundError,
    SubmissionLimitReachedError,
)
from app.features.forms.schema import FormSchema
from app.features.forms.validation import validate_answers
from app.models import (
    DecisionStatus,
    Event,
    EventSpeaker,
    Form,
    FormStatus,
    MessagePurpose,
    Session,
    SessionSpeaker,
    SessionStatus,
    Speaker,
    SpeakerStatus,
    Submission,
    SubmissionSpeaker,
    SubmissionStatus,
)

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no I/O/0/1 — these get read aloud
DECIDED = {SubmissionStatus.ACCEPTED, SubmissionStatus.WAITLISTED, SubmissionStatus.REJECTED}


def _now() -> datetime:
    return datetime.now(UTC)


async def _unique_code(session: AsyncSession, event_id: uuid.UUID) -> str:
    for _ in range(20):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        clash = await session.scalar(
            select(func.count(Submission.id)).where(
                Submission.event_id == event_id, Submission.code == code
            )
        )
        if not clash:
            return code
    raise ConflictError("Could not allocate a submission code. Try again.")


def check_window_open(event: Event, form: Form) -> None:
    """The server clock decides. A client that thinks the CFP is open is wrong."""
    now = _now()
    if form.status == FormStatus.CLOSED:
        raise CfpClosedError("This call for papers has closed.")
    if form.opens_at is not None and now < form.opens_at:
        raise CfpClosedError("This call for papers has not opened yet.")
    closes = form.closes_at or event.cfp_closes_at
    if closes is not None and now >= closes:
        raise CfpClosedError("This call for papers has closed.")


async def _check_limit(session: AsyncSession, event: Event, speaker: Speaker) -> None:
    """Counts non-withdrawn submissions where this speaker is primary."""
    if event.submission_limit_per_speaker is None:
        return
    used = await session.scalar(
        select(func.count(Submission.id))
        .join(SubmissionSpeaker, SubmissionSpeaker.submission_id == Submission.id)
        .where(
            SubmissionSpeaker.speaker_id == speaker.id,
            SubmissionSpeaker.is_primary.is_(True),
            Submission.status != SubmissionStatus.WITHDRAWN,
        )
    )
    if int(used or 0) >= event.submission_limit_per_speaker:
        raise SubmissionLimitReachedError(
            f"You can submit at most {event.submission_limit_per_speaker} proposals to this event.",
            details={"limit": event.submission_limit_per_speaker},
        )


async def upsert_speaker(
    session: AsyncSession, *, org_id: uuid.UUID, event_id: uuid.UUID, email: str, name: str
) -> Speaker:
    """A speaker is identified by email within an organization, so submitting twice
    from the same address is the same person, not a duplicate."""
    speaker = await session.scalar(select(Speaker).where(Speaker.email == email))
    if speaker is None:
        speaker = Speaker(org_id=org_id, email=email, name=name)
        session.add(speaker)
        await session.flush()

    participating = await session.scalar(
        select(func.count(EventSpeaker.id)).where(EventSpeaker.speaker_id == speaker.id)
    )
    if not participating:
        session.add(
            EventSpeaker(event_id=event_id, speaker_id=speaker.id, status=SpeakerStatus.PROSPECTIVE)
        )
        # Flush before returning: the session runs with autoflush off, so a second
        # call in the same transaction would not see this pending row and would
        # insert a duplicate.
        await session.flush()
    return speaker


async def save_draft(
    session: AsyncSession,
    *,
    event: Event,
    form: Form,
    title: str,
    answers: dict[str, object],
    speaker_email: str,
    speaker_name: str,
    draft_token: uuid.UUID | None = None,
) -> Submission:
    """Drafts validate loosely — a half-finished proposal must never lose input.

    The code is allocated on first save rather than at submit, so a resumed draft
    keeps the identity the speaker was already given.
    """
    check_window_open(event, form)
    schema = FormSchema.model_validate(form.schema)
    errors = validate_answers(schema, dict(answers), partial=True)
    if errors:
        raise ApiError(
            "Some answers are not valid.",
            code="VALIDATION_FAILED",
            status_code=422,
            field=errors[0].field,
            details={"errors": [{"field": e.field, "message": e.message} for e in errors]},
        )

    submission = None
    if draft_token is not None:
        submission = await session.scalar(
            select(Submission).where(Submission.draft_token == draft_token)
        )
        if submission is not None and submission.status != SubmissionStatus.DRAFT:
            raise ConflictError("This proposal has already been submitted.")

    speaker = await upsert_speaker(
        session, org_id=event.org_id, event_id=event.id, email=speaker_email, name=speaker_name
    )

    if submission is None:
        submission = Submission(
            event_id=event.id,
            form_id=form.id,
            code=await _unique_code(session, event.id),
            title=title,
            answers=dict(answers),
            draft_token=uuid.uuid4(),
            status=SubmissionStatus.DRAFT,
        )
        session.add(submission)
        await session.flush()
        session.add(
            SubmissionSpeaker(submission_id=submission.id, speaker_id=speaker.id, is_primary=True)
        )
    else:
        submission.title = title
        submission.answers = dict(answers)

    await session.flush()
    return submission


async def submit(
    session: AsyncSession,
    *,
    event: Event,
    form: Form,
    title: str,
    answers: dict[str, object],
    speaker_email: str,
    speaker_name: str,
    draft_token: uuid.UUID | None = None,
) -> Submission:
    check_window_open(event, form)
    schema = FormSchema.model_validate(form.schema)
    errors = validate_answers(schema, dict(answers))
    if errors:
        raise ApiError(
            "Some answers are not valid.",
            code="VALIDATION_FAILED",
            status_code=422,
            field=errors[0].field,
            details={"errors": [{"field": e.field, "message": e.message} for e in errors]},
        )

    speaker = await upsert_speaker(
        session, org_id=event.org_id, event_id=event.id, email=speaker_email, name=speaker_name
    )
    await _check_limit(session, event, speaker)

    submission = await save_draft(
        session,
        event=event,
        form=form,
        title=title,
        answers=answers,
        speaker_email=speaker_email,
        speaker_name=speaker_name,
        draft_token=draft_token,
    )
    submission.status = SubmissionStatus.SUBMITTED
    submission.submitted_at = _now()

    # First submission freezes the form's structure.
    form.is_locked = True

    await mail.send_now(
        session,
        event_id=event.id,
        to_email=speaker.email,
        to_speaker_id=speaker.id,
        purpose=MessagePurpose.CUSTOM,
        subject=f"We received your proposal — {submission.code}",
        body=(
            f"<p>Thanks {speaker.name}, your proposal <strong>{submission.title}</strong> "
            f"is in.</p><p>Your reference is <strong>{submission.code}</strong>. "
            f"You can check its status any time with that code.</p>"
        ),
    )
    await session.flush()
    return submission


async def get(session: AsyncSession, submission_id: uuid.UUID) -> Submission:
    submission = await session.get(Submission, submission_id)
    if submission is None:
        raise NotFoundError(f"No submission with id {submission_id}.")
    return submission


async def decide(
    session: AsyncSession,
    *,
    submission_id: uuid.UUID,
    outcome: SubmissionStatus,
    user_id: uuid.UUID,
) -> Submission:
    """Records the decision and sends nothing.

    This is the separation the whole product is built around: a decision is a
    state change, notifying people is a separate, explicit, confirmed action.
    """
    if outcome not in DECIDED:
        raise ApiError(f"{outcome.value!r} is not a decision outcome.", field="outcome")

    submission = await get(session, submission_id)
    submission.status = outcome
    submission.decision_status = DecisionStatus.PENDING_SEND
    submission.decided_at = _now()
    submission.decided_by_user_id = user_id
    await session.flush()
    return submission


async def promote(session: AsyncSession, *, submission_id: uuid.UUID) -> Session:
    """Turn an accepted submission into a session, carrying its metadata over.

    Deliberately a separate step from accepting: organizers decide first and pick
    format and duration later, and the two are different jobs.
    """
    submission = await get(session, submission_id)
    if submission.status != SubmissionStatus.ACCEPTED:
        raise ConflictError("Only accepted submissions become sessions.")

    existing = await session.scalar(select(Session).where(Session.submission_id == submission.id))
    if existing is not None:
        return existing

    duration = submission.requested_duration_minutes or 30
    slug = f"{submission.title.lower().replace(' ', '-')[:60]}-{submission.code.lower()}"
    talk = Session(
        event_id=submission.event_id,
        submission_id=submission.id,
        title=submission.title,
        abstract=str(submission.answers.get("abstract") or "") or None,
        slug=slug,
        track_id=submission.track_id,
        session_format_id=submission.session_format_id,
        duration_minutes=duration,
        status=SessionStatus.UNSCHEDULED,
    )
    session.add(talk)
    await session.flush()

    speakers = (
        (
            await session.execute(
                select(SubmissionSpeaker)
                .where(SubmissionSpeaker.submission_id == submission.id)
                .order_by(SubmissionSpeaker.sort_order)
            )
        )
        .scalars()
        .all()
    )
    for index, link in enumerate(speakers):
        session.add(
            SessionSpeaker(session_id=talk.id, speaker_id=link.speaker_id, sort_order=index)
        )
    await session.flush()
    return talk


def public_status(submission: Submission) -> dict[str, object]:
    """Public status view. Deliberately thin: never scores, reviewer comments, or
    anything about anyone else's proposal — and never the outcome before it is sent.
    """
    released = submission.decision_status == DecisionStatus.SENT
    stage = "submitted"
    if submission.status == SubmissionStatus.IN_REVIEW:
        stage = "in_review"
    elif submission.status in DECIDED:
        stage = "decided" if released else "in_review"

    return {
        "code": submission.code,
        "title": submission.title,
        "stage": stage,
        "outcome": submission.status.value if released else None,
        "submitted_at": submission.submitted_at,
    }
