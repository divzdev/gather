"""The speaker's own view. A phone, three visits, no password.

Every query here filters on the token's `speaker_id` as well as the bound event.
Tenancy scopes these rows to one conference; it does not scope them to one
person, and the difference between those two fences is the entire security story
of this file.

`/portal/home` answers the whole screen in one payload on purpose — a speaker
opening this on hotel wifi should wait for one round trip, not five.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, File, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.core import storage
from app.core.config import get_settings
from app.core.deps import DbSession, PortalSpeaker
from app.core.errors import ApiError, NotFoundError
from app.core.tenancy import current_tenant, tenancy_disabled, tenant_scope
from app.features.auth import service as auth_service
from app.features.files import service as files
from app.features.forms.schema import FormSchema
from app.features.forms.validation import validate_answers
from app.features.publishing import ics
from app.features.tasks import service as tasks
from app.models import (
    Event,
    EventSpeaker,
    Form,
    FormKind,
    Page,
    PageVisibility,
    Room,
    Session,
    SessionSpeaker,
    Speaker,
    SpeakerStatus,
    SpeakerTask,
    Submission,
    SubmissionSpeaker,
    TaskFile,
    TaskKind,
    TaskStatus,
    TaskTemplate,
)
from app.models import (
    File as FileRecord,
)

router = APIRouter(prefix="/v1/portal", tags=["portal"])


class FileRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    filename: str
    content_type: str
    byte_size: int
    version: int
    uploaded_at: datetime


class TaskRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    name: str
    description: str | None
    kind: TaskKind
    is_required: bool
    external_url: str | None
    #: Whether a human checks this before it counts. The speaker sees it as the
    #: difference between "with the team" and "done", and it decides whether a
    #: delivered task is still theirs to change.
    requires_review: bool
    accepted_file_types: dict[str, Any]
    max_file_mb: int | None
    due_at: datetime | None
    status: TaskStatus
    form_response: dict[str, Any] | None
    files: list[FileRead] = Field(default_factory=list)


class TaskDetail(TaskRead):
    """One task, opened. A superset of the list shape, never used in a list.

    The extra field is the whole reason the detail route exists — see
    `read_one_task` for why the schema does not ride on `/portal/home`.
    """

    #: The questions to draw. Null for every kind that is not `form`.
    #:
    #: Trailing underscore because a bare `schema` shadows a BaseModel attribute
    #: and Pydantic warns. The alias is what goes over the wire, matching how
    #: `FormCreate` already handles the same collision.
    schema_: FormSchema | None = Field(default=None, alias="schema")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class SessionRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    # The speaker's own calendar link is built from this.
    slug: str
    title: str
    abstract: str | None
    starts_at: datetime | None
    duration_minutes: int
    room: str | None
    #: Google and Outlook, alongside the .ics file. Most speakers do not download
    #: an .ics — they click the calendar they already use, and the links existed
    #: but only ever reached them inside an email.
    calendar_links: dict[str, str] = Field(default_factory=dict)


class ProfileRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    name: str
    email: str
    pronouns: str | None
    company: str | None
    job_title: str | None
    bio: str | None
    links: dict[str, Any]
    headshot_file_id: uuid.UUID | None
    dietary_notes: str | None
    accessibility_notes: str | None
    av_notes: str | None


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    pronouns: str | None = Field(default=None, max_length=60)
    company: str | None = Field(default=None, max_length=200)
    job_title: str | None = Field(default=None, max_length=200)
    bio: str | None = None
    links: dict[str, Any] | None = None
    dietary_notes: str | None = None
    accessibility_notes: str | None = None
    av_notes: str | None = None


class EventRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    name: str
    slug: str
    timezone: str
    starts_on: Any
    ends_on: Any
    location: str | None
    #: When this event's call for papers shuts, or None if it has no dated CFP.
    #: The portal drew a "CFP TIMELINE" card of prototype dates before this
    #: existed, so every speaker on every event read the same invented deadline.
    cfp_closes_at: datetime | None = None


class Progress(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total: int
    complete: int
    outstanding: int
    overdue: int


class Participation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: SpeakerStatus
    responded_at: datetime | None
    decline_reason: str | None
    #: False once they have been withdrawn, or before an organiser has accepted
    #: them — there is nothing to answer yet in either case.
    can_respond: bool


class Home(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: EventRead
    speaker: ProfileRead
    participation: Participation
    sessions: list[SessionRead]
    tasks: list[TaskRead]
    progress: Progress


class TaskSubmit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    form_response: dict[str, Any] | None = None
    acknowledged: bool = False


class ParticipationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Only the two a speaker can choose. `prospective` and `withdrawn` are the
    #: organiser's to set, and typing them here would let a speaker un-decline
    #: themselves back into a state nobody put them in.
    status: Literal[SpeakerStatus.CONFIRMED, SpeakerStatus.DECLINED]
    reason: str | None = Field(default=None, max_length=1000)


#: Answering is possible from the moment an organiser accepts them, and stays
#: possible afterwards: a speaker who confirms in March and breaks their leg in
#: April has to be able to say so.
RESPONDABLE = (SpeakerStatus.ACCEPTED, SpeakerStatus.CONFIRMED, SpeakerStatus.DECLINED)


async def _participation(session: DbSession, speaker_id: uuid.UUID) -> EventSpeaker:
    row = await session.scalar(select(EventSpeaker).where(EventSpeaker.speaker_id == speaker_id))
    if row is None:
        raise NotFoundError("You are not on this event's speaker roster.")
    return row


def _participation_read(row: EventSpeaker) -> Participation:
    return Participation(
        status=row.status,
        responded_at=row.responded_at,
        decline_reason=row.decline_reason,
        can_respond=row.status in RESPONDABLE,
    )


async def _speaker(session: DbSession, speaker_id: uuid.UUID) -> Speaker:
    with tenancy_disabled():
        row = await session.get(Speaker, speaker_id)
    if row is None or row.org_id != current_tenant().org_id:
        raise NotFoundError("That speaker record is missing.")
    return row


def _profile(speaker: Speaker) -> ProfileRead:
    return ProfileRead(
        id=speaker.id,
        name=speaker.name,
        email=speaker.email,
        pronouns=speaker.pronouns,
        company=speaker.company,
        job_title=speaker.job_title,
        bio=speaker.bio,
        links=speaker.links,
        headshot_file_id=speaker.headshot_file_id,
        dietary_notes=speaker.dietary_notes,
        accessibility_notes=speaker.accessibility_notes,
        av_notes=speaker.av_notes,
    )


async def _own_task(
    session: DbSession, task_id: uuid.UUID, speaker_id: uuid.UUID
) -> tuple[SpeakerTask, TaskTemplate]:
    """Load a task only if it belongs to this speaker.

    The `speaker_id` predicate is the point: without it a valid token for one
    speaker would read another speaker's deliverables from the same event.
    """
    found = (
        (
            await session.execute(
                select(SpeakerTask, TaskTemplate)
                .join(TaskTemplate, TaskTemplate.id == SpeakerTask.task_template_id)
                .where(SpeakerTask.id == task_id, SpeakerTask.speaker_id == speaker_id)
            )
        )
        .tuples()
        .first()
    )
    if found is None:
        raise NotFoundError(f"No task with id {task_id}.")
    return found


async def _files_for(
    session: DbSession, task_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[FileRead]]:
    if not task_ids:
        return {}
    rows = (
        (
            await session.execute(
                select(TaskFile.speaker_task_id, FileRecord)
                .join(FileRecord, FileRecord.id == TaskFile.file_id)
                .where(TaskFile.speaker_task_id.in_(task_ids))
                .order_by(FileRecord.version.desc())
            )
        )
        .tuples()
        .all()
    )
    grouped: dict[uuid.UUID, list[FileRead]] = {}
    for task_id, record in rows:
        grouped.setdefault(task_id, []).append(
            FileRead(
                id=record.id,
                filename=record.filename,
                content_type=record.content_type,
                byte_size=record.byte_size,
                version=record.version,
                uploaded_at=record.created_at,
            )
        )
    return grouped


async def _tasks_for(session: DbSession, speaker_id: uuid.UUID) -> list[TaskRead]:
    rows = await tasks.load_rows(session, speaker_id=speaker_id)
    attachments = await _files_for(session, [task.id for task, _t, _s in rows])
    now = datetime.now(UTC)
    return [
        TaskRead(
            id=task.id,
            name=template.name,
            description=template.description,
            kind=template.kind,
            is_required=template.is_required,
            external_url=template.external_url,
            requires_review=template.requires_review,
            accepted_file_types=template.accepted_file_types,
            max_file_mb=template.max_file_mb,
            due_at=task.due_at,
            status=tasks.derive_status(task, now),
            form_response=task.form_response,
            files=attachments.get(task.id, []),
        )
        for task, template, _speaker in rows
    ]


@router.get("/home", response_model=Home)
async def home(session: DbSession, speaker: PortalSpeaker) -> Home:
    with tenancy_disabled():
        event = await session.get(Event, speaker.event_id)
    if event is None:  # pragma: no cover - bind_speaker_tenant proved it exists
        raise NotFoundError("This event is missing.")

    person = await _speaker(session, speaker.speaker_id)
    talks = (
        (
            await session.execute(
                select(Session, Room)
                .join(SessionSpeaker, SessionSpeaker.session_id == Session.id)
                .outerjoin(Room, Room.id == Session.room_id)
                .where(SessionSpeaker.speaker_id == speaker.speaker_id)
                .order_by(Session.starts_at.nulls_last())
            )
        )
        .tuples()
        .all()
    )
    mine = await _tasks_for(session, speaker.speaker_id)
    complete = sum(1 for task in mine if task.status is TaskStatus.COMPLETE)
    overdue = sum(1 for task in mine if task.status is TaskStatus.OVERDUE)

    # The same precedence `submissions.service.check_window_open` enforces: the
    # form's own close date wins, and the event's is the fallback. Reading either
    # one alone would let the portal advertise a deadline the API does not apply.
    form_closes_at = await session.scalar(
        select(Form.closes_at).where(Form.kind == FormKind.CFP).order_by(Form.created_at).limit(1)
    )
    cfp_closes_at = form_closes_at or event.cfp_closes_at

    return Home(
        event=EventRead(
            id=event.id,
            name=event.name,
            slug=event.slug,
            timezone=event.timezone,
            starts_on=event.starts_on,
            ends_on=event.ends_on,
            location=event.location,
            cfp_closes_at=cfp_closes_at,
        ),
        speaker=_profile(person),
        participation=_participation_read(await _participation(session, speaker.speaker_id)),
        sessions=[
            SessionRead(
                id=talk.id,
                slug=talk.slug,
                title=talk.title,
                abstract=talk.abstract,
                starts_at=talk.starts_at,
                duration_minutes=talk.duration_minutes,
                room=room.name if room else None,
                calendar_links=ics.calendar_links(
                    {
                        "starts_at": talk.starts_at,
                        "duration_minutes": talk.duration_minutes,
                        "title": talk.title,
                        "room": room.name if room else None,
                    },
                    event={"location": event.location},
                ),
            )
            for talk, room in talks
        ],
        tasks=mine,
        progress=Progress(
            total=len(mine),
            complete=complete,
            outstanding=len(mine) - complete,
            overdue=overdue,
        ),
    )


@router.get("/tasks/{task_id}", response_model=TaskDetail)
async def read_one_task(
    task_id: uuid.UUID, session: DbSession, speaker: PortalSpeaker
) -> TaskDetail:
    """One task, with the schema a `form` task needs in order to be drawn.

    The schema lives here rather than on `/portal/home` deliberately: home is one
    round trip for the whole screen, and hauling a schema per form task would
    grow it for a list nobody is filling in yet. The speaker fetches the form
    when they open it.
    """
    _, template = await _own_task(session, task_id, speaker.speaker_id)
    base = await read_task(task_id, session, speaker)

    schema: FormSchema | None = None
    if template.kind is TaskKind.FORM:
        form = (
            None
            if template.form_id is None
            else await session.scalar(select(Form).where(Form.id == template.form_id))
        )
        if form is None:
            # `TaskTemplate.form_id` is ON DELETE SET NULL, so a deleted Form
            # leaves the task pointing at nothing. That is broken, not empty —
            # drawing a blank form would invite an empty answer against a form
            # that no longer exists, and mark a required task done on it.
            raise ApiError(
                "This form is no longer available. Let the organiser know — "
                "they will need to set the task up again.",
                code="FORM_MISSING",
                status_code=409,
            )
        schema = FormSchema.model_validate(form.schema)

    return TaskDetail(**base.model_dump(), schema_=schema)


async def read_task(task_id: uuid.UUID, session: DbSession, speaker: PortalSpeaker) -> TaskRead:
    await _own_task(session, task_id, speaker.speaker_id)
    mine = await _tasks_for(session, speaker.speaker_id)
    found = next((task for task in mine if task.id == task_id), None)
    if found is None:  # pragma: no cover - it was loaded a moment ago
        raise NotFoundError(f"No task with id {task_id}.")
    return found


async def _checked_answers(
    session: DbSession, template: TaskTemplate, answers: dict[str, Any], *, partial: bool
) -> dict[str, Any]:
    """Answers, validated against the form's own schema before they are stored.

    `form_response` used to take whatever JSON arrived. Reusing the CFP's
    evaluator rather than writing a second one is the point — two validators for
    one schema engine is how the two forms start disagreeing about what a
    required field means.

    `partial=True` for autosave, so saving mid-way is never an error; full on
    send. That split already exists for CFP drafts; this is the same seam.
    """
    form = (
        None
        if template.form_id is None
        else await session.scalar(select(Form).where(Form.id == template.form_id))
    )
    if form is None:
        raise ApiError(
            "This form is no longer available. Let the organiser know — "
            "they will need to set the task up again.",
            code="FORM_MISSING",
            status_code=409,
        )
    schema = FormSchema.model_validate(form.schema)
    errors = validate_answers(schema, dict(answers), partial=partial)
    if errors:
        raise ApiError(
            "Some answers are not valid.",
            code="VALIDATION_FAILED",
            status_code=422,
            field=errors[0].field,
            details={"errors": [{"field": e.field, "message": e.message} for e in errors]},
        )
    return dict(answers)


@router.patch("/tasks/{task_id}", response_model=TaskRead)
async def save_task_draft(
    task_id: uuid.UUID, body: TaskSubmit, session: DbSession, speaker: PortalSpeaker
) -> TaskRead:
    """Autosave. Writes the answer and deliberately leaves the status alone.

    Separate verb from send because they are different acts: PATCH is "keep what
    I have typed", PUT is "I am finished". Status is what distinguishes a draft
    from a delivery in `form_response`, so autosave moving it would report work
    as delivered that the speaker never sent — and, on a `requires_review` task,
    would put a half-typed answer in front of an organiser.
    """
    task, template = await _own_task(session, task_id, speaker.speaker_id)
    if template.kind is not TaskKind.FORM:
        raise ApiError(
            "Only a form task has answers to save.",
            code="VALIDATION_FAILED",
            status_code=422,
            field="form_response",
        )
    if body.form_response is None:
        raise ApiError(
            "This task needs a filled-in form.",
            code="VALIDATION_FAILED",
            status_code=422,
            field="form_response",
        )

    task.form_response = await _checked_answers(session, template, body.form_response, partial=True)
    await session.flush()
    return await read_task(task_id, session, speaker)


def _land(task: SpeakerTask, template: TaskTemplate) -> None:
    """Where a delivery lands, for every kind that produces one (spec 0007).

    `requires_review` is the whole rule and it was dead code: written by the
    organiser, stored, never read, and every delivery landed `submitted`
    regardless. So a speaker answering "macOS" waited for a human to accept
    that fact, and a headshot got exactly the same treatment as a questionnaire.

    One function rather than a branch in each caller, because the form path and
    the upload path drifting apart is precisely the bug this replaces.
    """
    if template.requires_review:
        task.status = TaskStatus.SUBMITTED
        task.completed_at = None
        return
    task.status = TaskStatus.COMPLETE
    task.completed_at = datetime.now(UTC)


@router.put("/tasks/{task_id}", response_model=TaskRead)
async def submit_task(
    task_id: uuid.UUID, body: TaskSubmit, session: DbSession, speaker: PortalSpeaker
) -> TaskRead:
    """A form answer or an acknowledgement.

    Acknowledgements self-complete; a form answer lands as `submitted` and waits
    for an organiser, because "the speaker sent something" and "we accepted it"
    are different facts.
    """
    task, template = await _own_task(session, task_id, speaker.speaker_id)

    if template.kind is TaskKind.ACKNOWLEDGE:
        if not body.acknowledged:
            raise ApiError(
                "Tick the box to confirm you have read this.",
                code="VALIDATION_FAILED",
                status_code=422,
                field="acknowledged",
            )
        task.status = TaskStatus.COMPLETE
        task.completed_at = datetime.now(UTC)
    elif template.kind is TaskKind.FORM:
        if body.form_response is None:
            raise ApiError(
                "This task needs a filled-in form.",
                code="VALIDATION_FAILED",
                status_code=422,
                field="form_response",
            )
        task.form_response = await _checked_answers(
            session, template, body.form_response, partial=False
        )
        _land(task, template)
    else:
        _land(task, template)

    await session.flush()
    return await read_task(task_id, session, speaker)


@router.post("/tasks/{task_id}/files", response_model=TaskRead, status_code=201)
async def upload_to_task(
    task_id: uuid.UUID,
    session: DbSession,
    speaker: PortalSpeaker,
    file: Annotated[UploadFile, File()],
) -> TaskRead:
    """Uploading again replaces the deliverable and keeps the old one readable.

    The new row is version + 1 of the same group rather than a second unrelated
    file, so "the current slides" stays a single answer.
    """
    task, template = await _own_task(session, task_id, speaker.speaker_id)
    data = await file.read()
    accepted = template.accepted_file_types.get("extensions")
    files.check_upload(
        filename=file.filename or "upload",
        content_type=file.content_type or "application/octet-stream",
        byte_size=len(data),
        accepted_extensions=list(accepted) if accepted else None,
        max_bytes=(template.max_file_mb or 25) * 1024 * 1024,
    )

    previous = (
        (
            await session.execute(
                select(FileRecord)
                .join(TaskFile, TaskFile.file_id == FileRecord.id)
                .where(TaskFile.speaker_task_id == task.id)
                .order_by(FileRecord.version.desc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )

    record = await files.store(
        session,
        data=data,
        filename=file.filename or "upload",
        content_type=file.content_type or "application/octet-stream",
        version_group_id=previous.version_group_id if previous else None,
        uploaded_by_speaker_id=speaker.speaker_id,
    )
    session.add(TaskFile(speaker_task_id=task.id, file_id=record.id))

    # The deliverable the organiser chased *is* the profile photo, when the
    # template says so. Without this the Headshot task was decorative: the
    # speaker uploaded, the task went green, and the public speaker card, the
    # gallery and the embed all went on reading a `headshot_file_id` that only
    # the separate profile endpoint ever wrote.
    if template.sets_profile_photo:
        person = await _speaker(session, speaker.speaker_id)
        person.headshot_file_id = record.id

    _land(task, template)
    await session.flush()
    return await read_task(task_id, session, speaker)


@router.get("/files/{file_id}")
async def download_own_file(
    file_id: uuid.UUID, session: DbSession, speaker: PortalSpeaker
) -> Response:
    """Only files this speaker uploaded, or that hang off one of their tasks."""
    record = await session.get(FileRecord, file_id)
    if record is None:
        raise NotFoundError(f"No file with id {file_id}.")

    owned = record.uploaded_by_speaker_id == speaker.speaker_id
    if not owned:
        owned = (
            await session.scalar(
                select(TaskFile.id)
                .join(SpeakerTask, SpeakerTask.id == TaskFile.speaker_task_id)
                .where(
                    TaskFile.file_id == file_id,
                    SpeakerTask.speaker_id == speaker.speaker_id,
                )
            )
        ) is not None
    if not owned:
        raise NotFoundError(f"No file with id {file_id}.")

    return Response(
        content=await storage.read(record.s3_key),
        media_type=record.content_type,
        headers={"Content-Disposition": f'attachment; filename="{record.filename}"'},
    )


@router.get("/participation", response_model=Participation)
async def read_participation(session: DbSession, speaker: PortalSpeaker) -> Participation:
    return _participation_read(await _participation(session, speaker.speaker_id))


@router.put("/participation", response_model=Participation)
async def set_participation(
    body: ParticipationUpdate, session: DbSession, speaker: PortalSpeaker
) -> Participation:
    """The speaker answers for themselves.

    Until this existed the roster only ever moved by an organiser's hand, which
    meant `confirmed` recorded an assumption rather than an answer. Declining
    deliberately does not touch their sessions: a co-speaker may still be giving
    the talk, and unscheduling someone else's session on one person's word is
    not a decision this endpoint gets to make. The roster shows the change and
    the organiser decides what happens to the slot.
    """
    row = await _participation(session, speaker.speaker_id)
    if row.status not in RESPONDABLE:
        raise ApiError(
            "You have not been accepted for this event yet, so there is nothing to confirm."
            if row.status is SpeakerStatus.PROSPECTIVE
            else "Your participation was withdrawn. Contact the organisers to change it.",
            code="PARTICIPATION_LOCKED",
            status_code=409,
        )

    row.status = body.status
    row.responded_at = datetime.now(UTC)
    row.decline_reason = body.reason if body.status is SpeakerStatus.DECLINED else None
    await session.flush()
    return _participation_read(row)


@router.get("/profile", response_model=ProfileRead)
async def read_profile(session: DbSession, speaker: PortalSpeaker) -> ProfileRead:
    return _profile(await _speaker(session, speaker.speaker_id))


@router.patch("/profile", response_model=ProfileRead)
async def update_profile(
    body: ProfileUpdate, session: DbSession, speaker: PortalSpeaker
) -> ProfileRead:
    person = await _speaker(session, speaker.speaker_id)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(person, key, value)
    await session.flush()
    return _profile(person)


@router.post("/profile/headshot", response_model=ProfileRead)
async def upload_headshot(
    session: DbSession, speaker: PortalSpeaker, file: Annotated[UploadFile, File()]
) -> ProfileRead:
    person = await _speaker(session, speaker.speaker_id)
    data = await file.read()
    files.check_upload(
        filename=file.filename or "headshot",
        content_type=file.content_type or "application/octet-stream",
        byte_size=len(data),
        accepted_extensions=["jpg", "jpeg", "png", "webp"],
        max_bytes=8 * 1024 * 1024,
    )

    previous = (
        await session.get(FileRecord, person.headshot_file_id) if person.headshot_file_id else None
    )
    record = await files.store(
        session,
        data=data,
        filename=file.filename or "headshot",
        content_type=file.content_type or "application/octet-stream",
        version_group_id=previous.version_group_id if previous else None,
        uploaded_by_speaker_id=speaker.speaker_id,
    )
    person.headshot_file_id = record.id
    await session.flush()
    return _profile(person)


class SubmissionRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    code: str
    title: str
    status: str
    submitted_at: datetime | None


@router.get("/submissions", response_model=list[SubmissionRead])
async def my_submissions(session: DbSession, speaker: PortalSpeaker) -> list[SubmissionRead]:
    """Their own proposals and nothing else — never a score, never a reviewer note."""
    rows = (
        (
            await session.execute(
                select(Submission)
                .join(SubmissionSpeaker, SubmissionSpeaker.submission_id == Submission.id)
                .where(SubmissionSpeaker.speaker_id == speaker.speaker_id)
                .order_by(Submission.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [
        SubmissionRead(
            id=row.id,
            code=row.code,
            title=row.title,
            status=row.status.value,
            submitted_at=row.submitted_at,
        )
        for row in rows
    ]


@router.get("/sessions/{session_id}.ics")
async def own_session_calendar(
    session_id: uuid.UUID, session: DbSession, speaker: PortalSpeaker
) -> Response:
    """The speaker's own session as a calendar entry, from live data.

    Not from the published snapshot: between acceptance and publication a
    speaker has a confirmed time and no public schedule to read it from, and
    that gap is most of the period they actually need the entry. Scoped to their
    own sessions, so this is not a back door to the unpublished programme.
    """

    talk = (
        (
            await session.execute(
                select(Session, Room)
                .join(SessionSpeaker, SessionSpeaker.session_id == Session.id)
                .outerjoin(Room, Room.id == Session.room_id)
                .where(Session.id == session_id, SessionSpeaker.speaker_id == speaker.speaker_id)
            )
        )
        .tuples()
        .first()
    )
    if talk is None:
        raise NotFoundError(f"No session with id {session_id}.")

    found, room = talk
    if found.starts_at is None:
        raise NotFoundError("That session has no time yet.")

    with tenancy_disabled():
        event = await session.get(Event, speaker.event_id)

    names = (
        (
            await session.execute(
                select(Speaker.name)
                .join(SessionSpeaker, SessionSpeaker.speaker_id == Speaker.id)
                .where(SessionSpeaker.session_id == found.id)
            )
        )
        .scalars()
        .all()
    )
    body = ics.build(
        {
            "id": str(found.id),
            "title": found.title,
            "abstract": found.abstract,
            "starts_at": found.starts_at.isoformat(),
            "duration_minutes": found.duration_minutes,
            "room": room.name if room else None,
            "speakers": [{"name": name} for name in names],
        },
        event={"name": event.name if event else "", "location": event.location if event else None},
        sequence=1,
        now=datetime.now(UTC),
    )
    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{found.slug}.ics"'},
    )


class PortalPage(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    title: str
    slug: str
    blocks: list[dict[str, Any]]
    is_pinned_in_portal: bool


@router.get("/pages", response_model=list[PortalPage])
async def portal_pages(session: DbSession, speaker: PortalSpeaker) -> list[Page]:
    """The event's resource and wiki pages, as a speaker sees them.

    Drafts are excluded here rather than filtered on the client: an unfinished
    run-of-show is exactly the kind of thing an organiser writes in the open,
    and the portal is the one surface it must not reach until they say so.

    Pinned first, then the organiser's own ordering — a speaker opening this a
    day before the event should meet "Day-of logistics", not page one of a
    style guide.
    """
    _ = speaker
    rows = await session.execute(
        select(Page)
        .where(Page.visibility != PageVisibility.DRAFT)
        .order_by(Page.is_pinned_in_portal.desc(), Page.sort_order, Page.title)
    )
    return list(rows.scalars().all())


class PortalLinkRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Raw token, shown exactly once. The server keeps only its hash, so the
    #: client must build and copy the URL now or ask again — asking again
    #: rotates, which quietly revokes whatever was copied before.
    token: str


class SpeakerEvent(BaseModel):
    """One conference this speaker is part of."""

    model_config = ConfigDict(extra="forbid")

    event_id: uuid.UUID
    name: str
    slug: str
    starts_on: date
    ends_on: date
    status: SpeakerStatus
    open_tasks: int
    is_current: bool


@router.get("/events", response_model=list[SpeakerEvent])
async def my_events(session: DbSession, speaker: PortalSpeaker) -> list[SpeakerEvent]:
    """Every conference this speaker is on, not only the one they are looking at.

    A speaker session is scoped to one event, so until now a person speaking at
    three of an organiser's conferences held three links, three sessions and
    three portals, with nothing anywhere that named the other two.

    Widened to the organisation, never past it: `tenant_scope` with no event is
    still a fence, and `Speaker` is unique per `(org_id, email)`, so the same
    person at a different organisation is a different row by design. Seeing
    across that boundary needs a person-level identity this schema does not have
    — and would mean one organiser's roster leaking into another's portal.
    """
    tenant = current_tenant()
    with tenant_scope(org_id=tenant.org_id, event_id=None):
        rows = (
            await session.execute(
                select(EventSpeaker.status, Event)
                .join(Event, Event.id == EventSpeaker.event_id)
                .where(EventSpeaker.speaker_id == speaker.speaker_id)
                .order_by(Event.starts_on.desc())
            )
        ).all()

        # What a speaker actually wants from a list of conferences is which one
        # is asking something of them. One grouped query rather than one per row.
        counted = (
            await session.execute(
                select(SpeakerTask.event_id, func.count(SpeakerTask.id))
                .where(
                    SpeakerTask.speaker_id == speaker.speaker_id,
                    SpeakerTask.status.not_in([TaskStatus.COMPLETE, TaskStatus.SUBMITTED]),
                )
                .group_by(SpeakerTask.event_id)
            )
        ).all()
        outstanding: dict[uuid.UUID, int] = {row[0]: row[1] for row in counted}

    return [
        SpeakerEvent(
            event_id=event.id,
            name=event.name,
            slug=event.slug,
            starts_on=event.starts_on,
            ends_on=event.ends_on,
            status=status,
            open_tasks=int(outstanding.get(event.id, 0)),
            is_current=event.id == speaker.event_id,
        )
        for status, event in rows
    ]


class SwitchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: uuid.UUID


class SwitchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_token: str
    expires_in: int


@router.post("/switch", response_model=SwitchResult)
async def switch_event(
    body: SwitchRequest, session: DbSession, speaker: PortalSpeaker
) -> SwitchResult:
    """Trade this session for one on another of the speaker's own conferences.

    No new magic link and no second email: the caller has already proved who
    they are, and the only question is whether this person is on that event.
    Both halves are checked — the event belongs to the organisation the current
    session is bound to, and there is an `EventSpeaker` row joining them to it —
    so a token cannot be talked into an event its holder has no part in.
    """
    tenant = current_tenant()
    with tenant_scope(org_id=tenant.org_id, event_id=None):
        target = await session.get(Event, body.event_id)
        member = await session.scalar(
            select(EventSpeaker.id).where(
                EventSpeaker.event_id == body.event_id,
                EventSpeaker.speaker_id == speaker.speaker_id,
            )
        )
    if target is None or member is None:
        raise NotFoundError("You are not on that event.")

    return SwitchResult(
        access_token=auth_service.speaker_session_token(
            speaker_id=speaker.speaker_id, event_id=target.id
        ),
        expires_in=get_settings().speaker_session_ttl_days * 24 * 60 * 60,
    )


@router.post("/link", response_model=PortalLinkRead)
async def rotate_portal_link(session: DbSession, speaker: PortalSpeaker) -> PortalLinkRead:
    """The speaker's durable way back in, one per event, replaced on request.

    Lives behind the speaker's own session on purpose: the portal is where the
    link is offered, so only someone already inside can mint one. Rotation is
    revocation — see auth.service.rotate_portal_link.
    """
    token = await auth_service.rotate_portal_link(
        session, speaker_id=speaker.speaker_id, event_id=speaker.event_id
    )
    return PortalLinkRead(token=token)
