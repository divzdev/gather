from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import mail
from app.core.config import get_settings
from app.core.errors import (
    ApiError,
    CfpClosedError,
    ConflictError,
    NotFoundError,
    SubmissionLimitReachedError,
)
from app.core.tenancy import tenancy_disabled
from app.features.forms.schema import FormSchema
from app.features.forms.validation import validate_answers
from app.models import (
    ContentStatus,
    DecisionStatus,
    Event,
    EventMember,
    EventSpeaker,
    Form,
    FormStatus,
    MessagePurpose,
    OrgMember,
    Role,
    Session,
    SessionFormat,
    SessionSpeaker,
    SessionStatus,
    Speaker,
    SpeakerStatus,
    Submission,
    SubmissionNote,
    SubmissionSpeaker,
    SubmissionStatus,
    Track,
    User,
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


def check_drafts_allowed(form: Form) -> None:
    """A form may require the whole proposal in one sitting.

    Deliberately *not* inside `save_draft`: submitting builds its row by calling
    `save_draft`, so a refusal one level deeper would close the call for papers
    altogether. It belongs beside `check_window_open`, on the route that exists
    only to keep a half-written proposal.
    """
    if not FormSchema.model_validate(form.schema).settings.allow_drafts:
        raise ApiError(
            "This form has to be completed in one sitting — it does not keep drafts.",
            code="DRAFTS_DISABLED",
            status_code=403,
        )


def check_co_speaker_count(schema: FormSchema, count: int) -> None:
    """How many other people may — or must — be on stage.

    The organiser types these numbers into the roles editor. Until now nothing
    read them, so "at most 2" was advice.
    """
    minimum, maximum = schema.settings.co_speaker_rule()
    if count > maximum:
        raise ApiError(
            f"This form takes at most {maximum} co-speaker{'' if maximum == 1 else 's'}."
            if maximum
            else "This form does not take co-speakers.",
            code="VALIDATION_FAILED",
            status_code=422,
            field="co_speakers",
        )
    if count < minimum:
        raise ApiError(
            f"This form needs at least {minimum} co-speaker{'' if minimum == 1 else 's'}.",
            code="VALIDATION_FAILED",
            status_code=422,
            field="co_speakers",
        )


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
        limit = event.submission_limit_per_speaker
        # A speaker reads this one. "at most 1 proposals" is the kind of thing
        # that makes a careful person doubt the rest of the form.
        raise SubmissionLimitReachedError(
            f"You can submit at most {limit} proposal{'' if limit == 1 else 's'} to this event.",
            details={"limit": limit},
        )


async def upsert_speaker(
    session: AsyncSession, *, org_id: uuid.UUID, event_id: uuid.UUID, email: str, name: str
) -> Speaker:
    """A speaker is identified by email within an organization, so submitting twice
    from the same address is the same person, not a duplicate."""
    speaker = await session.scalar(select(Speaker).where(Speaker.email == email))
    if speaker is None:
        # Check-then-insert is a race: two proposals submitted at once from the
        # same new address both saw nothing and both inserted, and one request
        # died on the unique index. The index is the authority — insert inside a
        # savepoint so losing the race costs a re-read, not the transaction.
        try:
            async with session.begin_nested():
                speaker = Speaker(org_id=org_id, email=email, name=name)
                session.add(speaker)
                await session.flush()
        except IntegrityError:
            speaker = await session.scalar(select(Speaker).where(Speaker.email == email))
            if speaker is None:  # pragma: no cover - the constraint says otherwise
                raise
    elif speaker.name == speaker.email and name != email:
        # A draft autosaves before the form has asked for a name, so the caller
        # has nothing to send but the address. Adopt the real name the moment one
        # arrives — but only over that placeholder, never over a name a human
        # typed, or an organiser's correction would be undone by the speaker's
        # next keystroke.
        speaker.name = name

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
    co_speakers: list[tuple[str, str, str | None]] | None = None,
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

    await _route_by_category(session, form=form, submission=submission)
    await _sync_co_speakers(
        session,
        event=event,
        form=form,
        submission=submission,
        primary=speaker,
        wanted=co_speakers or [],
    )
    await session.flush()
    return submission


async def _route_by_category(session: AsyncSession, *, form: Form, submission: Submission) -> None:
    """File the proposal under the track and format its answers name.

    Without this a form's "Track" question is a string in a JSONB blob: the
    organiser's track filter finds nothing, the agenda has no colour to draw,
    and somebody re-keys 200 proposals by hand. Routing is what makes the
    category answer mean the same thing as the category.

    Matching is on the option's label, case- and space-insensitive, because the
    two lists are maintained on different screens and "AI Engineering" will meet
    "ai engineering" eventually. An answer that matches nothing leaves the
    existing value alone rather than clearing it — an organiser who has already
    filed a proposal by hand outranks a stale dropdown.
    """
    schema = FormSchema.model_validate(form.schema)
    routing = [f for f in schema.all_fields() if f.routes_to is not None]
    if not routing:
        return

    def normalise(value: str) -> str:
        return " ".join(value.split()).casefold()

    for field in routing:
        answer = submission.answers.get(field.key)
        if not isinstance(answer, str) or not answer.strip():
            continue
        # The submitter sends the option's value; the label is what an organiser
        # named the track, so try both.
        chosen = next((c.label for c in field.choices if c.value == answer), answer)
        wanted = normalise(chosen)

        if field.routes_to == "track":
            rows = (await session.execute(select(Track))).scalars().all()
            match = next((t for t in rows if normalise(t.name) == wanted), None)
            if match is not None:
                submission.track_id = match.id
        else:
            formats = (await session.execute(select(SessionFormat))).scalars().all()
            match_format = next((f for f in formats if normalise(f.name) == wanted), None)
            if match_format is not None:
                submission.session_format_id = match_format.id


async def _sync_co_speakers(
    session: AsyncSession,
    *,
    event: Event,
    form: Form,
    submission: Submission,
    primary: Speaker,
    wanted: list[tuple[str, str, str | None]],
) -> None:
    """Replace the non-primary speakers with the ones named in this save.

    Editing a draft can remove a co-speaker as well as add one, so this is a
    reconcile rather than an append. The primary is never touched: they are the
    person holding the draft token.
    """
    settings = FormSchema.model_validate(form.schema).settings
    unique: dict[str, tuple[str, str | None]] = {}
    for name, email, role in wanted:
        if email.casefold() == primary.email.casefold():
            continue
        unique.setdefault(email.casefold(), (name, role))

    if not settings.allow_co_speakers and unique:
        raise ApiError(
            "This form does not take co-speakers.",
            code="VALIDATION_FAILED",
            status_code=422,
            field="co_speakers",
        )
    if len(unique) > settings.max_co_speakers:
        raise ApiError(
            f"This form allows {settings.max_co_speakers} co-speaker"
            f"{'s' if settings.max_co_speakers != 1 else ''}, and {len(unique)} were given.",
            code="VALIDATION_FAILED",
            status_code=422,
            field="co_speakers",
        )

    existing = (
        (
            await session.execute(
                select(SubmissionSpeaker).where(
                    SubmissionSpeaker.submission_id == submission.id,
                    SubmissionSpeaker.is_primary.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    keep: set[uuid.UUID] = set()
    for index, (email, (name, role)) in enumerate(unique.items()):
        person = await upsert_speaker(
            session, org_id=event.org_id, event_id=event.id, email=email, name=name
        )
        keep.add(person.id)
        already = next((row for row in existing if row.speaker_id == person.id), None)
        if already is None:
            session.add(
                SubmissionSpeaker(
                    submission_id=submission.id,
                    speaker_id=person.id,
                    is_primary=False,
                    role=role,
                    sort_order=index + 1,
                )
            )
        else:
            already.sort_order = index + 1
            already.role = role

    for row in existing:
        if row.speaker_id not in keep:
            await session.delete(row)


async def _program_team(session: AsyncSession, event: Event) -> list[str]:
    """Addresses of the people who run this event: owners and admins.

    Resolved exactly like `resolve_role` and the team screen — an `EventMember`
    row overrides the `OrgMember` one — because someone demoted on this event
    should stop hearing about this event.

    Reviewers are excluded on purpose and not as an oversight: the alert names
    the speaker, and a reviewer who could read it would be walking around blind
    review by way of their inbox.
    """
    with tenancy_disabled():
        org_rows = (
            (
                await session.execute(
                    select(OrgMember.user_id, OrgMember.role, User.email)
                    .join(User, User.id == OrgMember.user_id)
                    .where(OrgMember.org_id == event.org_id)
                )
            )
            .tuples()
            .all()
        )
        event_rows = (
            (
                await session.execute(
                    select(EventMember.user_id, EventMember.role, User.email)
                    .join(User, User.id == EventMember.user_id)
                    .where(EventMember.event_id == event.id)
                )
            )
            .tuples()
            .all()
        )

    roles: dict[uuid.UUID, tuple[Role, str]] = {
        user_id: (role, email) for user_id, role, email in org_rows
    }
    roles.update({user_id: (role, email) for user_id, role, email in event_rows})
    return sorted({email for role, email in roles.values() if role in (Role.OWNER, Role.ADMIN)})


async def _alert_program_team(
    session: AsyncSession, *, event: Event, submission: Submission, speaker: Speaker
) -> None:
    console = f"{get_settings().web_origin}/admin/submissions/{submission.id}"
    body = (
        f"<p><strong>{submission.title}</strong> was submitted to {event.name}.</p>"
        f"<p>From {speaker.name} ({speaker.email}). Reference {submission.code}.</p>"
        f'<p><a href="{console}">Open it in the console</a></p>'
    )
    for address in await _program_team(session, event):
        # `send_now` records the row and never raises on a provider failure, so
        # a bounced alert cannot turn a speaker's submission into a 500.
        await mail.send_now(
            session,
            event_id=event.id,
            to_email=address,
            purpose=MessagePurpose.CUSTOM,
            subject=f"New proposal: {submission.title}",
            body=body,
        )


async def _confirm_co_speakers(
    session: AsyncSession, *, event: Event, submission: Submission, primary: Speaker
) -> None:
    """Tell the other people named on a proposal that they are on it.

    They get no `draft_token`: that token authorises editing, it belongs to the
    person who wrote the proposal, and being named on something is not consent
    to rewrite it.
    """
    rows = (
        (
            await session.execute(
                select(Speaker)
                .join(SubmissionSpeaker, SubmissionSpeaker.speaker_id == Speaker.id)
                .where(
                    SubmissionSpeaker.submission_id == submission.id,
                    SubmissionSpeaker.is_primary.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    for person in rows:
        if person.id == primary.id:
            continue
        await mail.send_now(
            session,
            event_id=event.id,
            to_email=person.email,
            to_speaker_id=person.id,
            purpose=MessagePurpose.CUSTOM,
            subject=f"You are named on a proposal for {event.name}",
            body=(
                f"<p>{primary.name} submitted <strong>{submission.title}</strong> "
                f"to {event.name} and named you on it.</p>"
                f"<p>The reference is <strong>{submission.code}</strong>. "
                f"{primary.name} can change the proposal until the call for papers "
                f"closes; you will hear from us again when there is a decision.</p>"
            ),
        )


async def submit(
    session: AsyncSession,
    *,
    event: Event,
    form: Form,
    title: str,
    answers: dict[str, object],
    speaker_email: str,
    speaker_name: str,
    co_speakers: list[tuple[str, str, str | None]] | None = None,
    draft_token: uuid.UUID | None = None,
) -> Submission:
    check_window_open(event, form)
    schema = FormSchema.model_validate(form.schema)
    check_co_speaker_count(schema, len(co_speakers or []))
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
        co_speakers=co_speakers,
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
        subject=f"We received your proposal: {submission.code}",
        body=(
            f"<p>Thanks {speaker.name}, your proposal <strong>{submission.title}</strong> "
            f"is in.</p><p>Your reference is <strong>{submission.code}</strong>. "
            f"You can check its status any time with that code.</p>"
            # The token, not the code, is what authorises an edit — so the link
            # that carries it is the only way back in from another device. The
            # page refuses the edit itself once the call closes.
            f'<p><a href="{get_settings().web_origin}/e/{event.slug}/submissions/'
            f'{submission.code}?t={submission.draft_token}">View or edit your proposal</a> '
            f"until the call for papers closes.</p>"
        ),
    )

    # The two switches on the form's settings screen that used to do nothing.
    # The receipt above is unconditional — it carries the code the speaker needs
    # forever — so `confirm_participants` governs only the other participants.
    if schema.settings.confirm_participants:
        await _confirm_co_speakers(session, event=event, submission=submission, primary=speaker)
    if schema.settings.notify_admins_on_submit:
        await _alert_program_team(session, event=event, submission=submission, speaker=speaker)

    await session.flush()
    return submission


async def get(session: AsyncSession, submission_id: uuid.UUID) -> Submission:
    submission = await session.get(Submission, submission_id)
    if submission is None:
        raise NotFoundError(f"No submission with id {submission_id}.")
    return submission


async def set_coordinator(
    session: AsyncSession, *, submission_id: uuid.UUID, coordinator_user_id: uuid.UUID | None
) -> Submission:
    """Point a staff member at a proposal, or clear the assignment.

    Reviewers are deliberately not assignable: the point of contact fields
    questions from the speaker, which is day-to-day programme work, and a
    reviewer's only relationship with the proposal is a scorecard.
    """
    from app.core.deps import resolve_role

    submission = await get(session, submission_id)
    if coordinator_user_id is not None:
        role = await resolve_role(session, coordinator_user_id, submission.event_id)
        if role not in (Role.OWNER, Role.ADMIN, Role.COORDINATOR):
            raise ApiError(
                "The point of contact must be an owner, admin or coordinator on this event.",
                code="VALIDATION_FAILED",
                status_code=422,
                field="coordinator_user_id",
            )
    submission.coordinator_user_id = coordinator_user_id
    await session.flush()
    return submission


async def decide(
    session: AsyncSession,
    *,
    submission_id: uuid.UUID,
    outcome: SubmissionStatus,
    user_id: uuid.UUID,
    reason: str | None = None,
) -> Submission:
    """Records the decision and sends nothing.

    This is the separation the whole product is built around: a decision is a
    state change, notifying people is a separate, explicit, confirmed action.

    `reason` is written as a `SubmissionNote` in this same transaction rather
    than onto the submission. Two reasons: notes are internal-only *by
    construction*, so an internal rationale can never surface on a speaker-facing
    page by accident; and decisions get changed, so what matters three weeks
    later is the sequence — a column would be overwritten the moment a talk moves
    from accepted to waitlisted.
    """
    if outcome not in DECIDED:
        raise ApiError(f"{outcome.value!r} is not a decision outcome.", field="outcome")

    submission = await get(session, submission_id)
    submission.status = outcome
    submission.decision_status = DecisionStatus.PENDING_SEND
    submission.decided_at = _now()
    submission.decided_by_user_id = user_id

    if reason is not None and reason.strip():
        session.add(
            SubmissionNote(
                org_id=submission.org_id,
                event_id=submission.event_id,
                submission_id=submission.id,
                author_user_id=user_id,
                body=reason.strip(),
                decision_outcome=outcome,
            )
        )
    await session.flush()
    return submission


async def withdraw(session: AsyncSession, *, submission_id: uuid.UUID) -> Submission:
    """A speaker pulls out. Reachable from any state, including accepted.

    The session survives and drops to unscheduled rather than being deleted: an
    organiser who has already built an agenda around this slot needs to see the
    hole, and the talk sometimes comes back with a different speaker. Deleting it
    would silently close the gap and lose the room booking.
    """
    submission = await get(session, submission_id)
    if submission.status == SubmissionStatus.WITHDRAWN:
        return submission

    submission.status = SubmissionStatus.WITHDRAWN
    submission.decision_status = DecisionStatus.NONE
    await session.flush()

    talk = await session.scalar(select(Session).where(Session.submission_id == submission.id))
    if talk is not None:
        talk.status = SessionStatus.UNSCHEDULED
        talk.event_day_id = None
        talk.room_id = None
        talk.starts_at = None
        # Unapproved, so it cannot reach a public surface on the next publish
        # while nobody is presenting it.
        talk.content_status = ContentStatus.PENDING
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


async def edit_submitted(
    session: AsyncSession,
    *,
    event: Event,
    form: Form,
    submission: Submission,
    title: str,
    answers: dict[str, object],
) -> Submission:
    """Change a proposal that is already in, while the call is still open.

    Sessionboard lets a submitter come back and fix a typo until the deadline.
    We had drafts and we had submitting, and nothing in between: the only way to
    correct a submitted proposal was to ask an organiser.

    Two refusals, and they are the point of the feature rather than edge cases.
    The window is checked against the server clock, so an edit form left open
    over the deadline cannot save through it. And editing stops once review
    starts: a reviewer who scored one abstract must not find a different one
    underneath their score.
    """
    check_window_open(event, form)
    if submission.status not in (SubmissionStatus.DRAFT, SubmissionStatus.SUBMITTED):
        raise ApiError(
            "This proposal is being reviewed and can no longer be edited. "
            "Contact the organisers if something is wrong.",
            code="SUBMISSION_LOCKED",
            status_code=409,
        )

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

    submission.title = title
    submission.answers = dict(answers)
    await session.flush()
    return submission


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


def is_editable(event: Event, form: Form, submission: Submission) -> bool:
    """Whether the edit endpoint would accept a change right now. Returned on the
    status payload so the page can offer the form instead of finding out on save."""
    if submission.status not in (SubmissionStatus.DRAFT, SubmissionStatus.SUBMITTED):
        return False
    try:
        check_window_open(event, form)
    except CfpClosedError:
        return False
    return True
