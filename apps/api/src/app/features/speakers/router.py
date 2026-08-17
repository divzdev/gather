"""The speaker roster for one event, and the two bulk paths onto it.

A speaker record is org-scoped — the same person across every event you run —
while their participation in one event is an `EventSpeaker` row. The roster is
the join, so a name imported for last year's conference is found rather than
duplicated.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Response, UploadFile
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, select

from app.core.deps import DbSession, bind_tenant, get_verified_user, require_role
from app.core.errors import ApiError, NotFoundError
from app.core.tenancy import current_tenant, tenancy_disabled
from app.features.auth import service as auth_service
from app.features.files import service as files
from app.models import (
    Event,
    EventSpeaker,
    Role,
    Speaker,
    SpeakerStatus,
    SpeakerTask,
    Submission,
    SubmissionSpeaker,
    TaskFile,
    TaskTemplate,
    User,
)
from app.models.file import File as FileRecord

router = APIRouter(
    prefix="/v1/events/{event_id}/speakers",
    tags=["speakers"],
    dependencies=[Depends(bind_tenant)],
)

READ = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)
WRITE = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)

MAX_IMPORT_ROWS = 1000
CSV_COLUMNS = ("name", "email", "company", "job_title", "pronouns", "bio")


class SpeakerRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    speaker_id: uuid.UUID
    name: str
    email: str
    company: str | None
    job_title: str | None
    pronouns: str | None
    bio: str | None
    status: SpeakerStatus
    submission_count: int
    portal_last_seen_at: Any = None
    #: The roster could not show a face without this. Uploading worked, storing
    #: worked, and nothing on the staff side ever returned it.
    headshot_file_id: uuid.UUID | None = None
    #: Set only when the speaker answered from the portal. `status == confirmed`
    #: with this null is an organiser's assumption, and the roster says so.
    responded_at: Any = None
    decline_reason: str | None = None
    #: Written by the speaker in the portal and, until now, readable only there —
    #: the one person who needs a dietary requirement is the organiser booking
    #: the catering, and no staff surface returned it.
    dietary_notes: str | None = None
    accessibility_notes: str | None = None
    av_notes: str | None = None


class SpeakerCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    company: str | None = Field(default=None, max_length=200)
    job_title: str | None = Field(default=None, max_length=200)
    pronouns: str | None = Field(default=None, max_length=60)
    bio: str | None = None


class SpeakerUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    company: str | None = Field(default=None, max_length=200)
    job_title: str | None = Field(default=None, max_length=200)
    pronouns: str | None = Field(default=None, max_length=60)
    bio: str | None = None
    status: SpeakerStatus | None = None
    #: Editable from the console too: plenty of speakers reply to the acceptance
    #: email with "I'm coeliac" rather than opening the portal.
    dietary_notes: str | None = None
    accessibility_notes: str | None = None
    av_notes: str | None = None


class ImportResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    created: int
    matched: int
    skipped: int
    errors: list[str]


async def _roster(session: DbSession) -> list[SpeakerRead]:
    rows = (
        (
            await session.execute(
                select(EventSpeaker, Speaker)
                .join(Speaker, Speaker.id == EventSpeaker.speaker_id)
                .order_by(Speaker.name)
            )
        )
        .tuples()
        .all()
    )
    if not rows:
        return []

    counts = dict(
        (
            await session.execute(
                select(SubmissionSpeaker.speaker_id, func.count(SubmissionSpeaker.id))
                .join(Submission, Submission.id == SubmissionSpeaker.submission_id)
                .group_by(SubmissionSpeaker.speaker_id)
            )
        )
        .tuples()
        .all()
    )
    return [
        SpeakerRead(
            id=link.id,
            speaker_id=speaker.id,
            name=speaker.name,
            email=speaker.email,
            company=speaker.company,
            job_title=speaker.job_title,
            pronouns=speaker.pronouns,
            bio=speaker.bio,
            headshot_file_id=speaker.headshot_file_id,
            status=link.status,
            submission_count=int(counts.get(speaker.id, 0)),
            portal_last_seen_at=link.portal_last_seen_at,
            responded_at=link.responded_at,
            decline_reason=link.decline_reason,
            dietary_notes=speaker.dietary_notes,
            accessibility_notes=speaker.accessibility_notes,
            av_notes=speaker.av_notes,
        )
        for link, speaker in rows
    ]


async def _attach(session: DbSession, *, name: str, email: str, **fields: Any) -> tuple[bool, bool]:
    """Find or create the org's speaker, then put them on this event.

    Returns (created_person, attached_to_event). Matching is by email within the
    organisation, which is what makes the roster a directory rather than a list
    that grows a duplicate every year.
    """
    tenant = current_tenant()
    with tenancy_disabled():
        speaker = await session.scalar(
            select(Speaker).where(Speaker.org_id == tenant.org_id, Speaker.email == email)
        )
    created = speaker is None
    if speaker is None:
        speaker = Speaker(org_id=tenant.org_id, email=email, name=name)
        session.add(speaker)
        await session.flush()

    for key, value in fields.items():
        if value not in (None, "") and getattr(speaker, key, None) in (None, ""):
            setattr(speaker, key, value)

    existing = await session.scalar(
        select(EventSpeaker).where(EventSpeaker.speaker_id == speaker.id)
    )
    if existing is not None:
        return created, False

    session.add(
        EventSpeaker(
            org_id=tenant.org_id,
            event_id=tenant.event_id,
            speaker_id=speaker.id,
            status=SpeakerStatus.PROSPECTIVE,
        )
    )
    await session.flush()
    return created, True


@router.get("", response_model=list[SpeakerRead])
async def list_speakers(
    session: DbSession, _: User = Depends(require_role(*READ))
) -> list[SpeakerRead]:
    return await _roster(session)


@router.post("", response_model=SpeakerRead, status_code=201)
async def add_speaker(
    body: SpeakerCreate, session: DbSession, _: User = Depends(require_role(*WRITE))
) -> SpeakerRead:
    await _attach(
        session,
        name=body.name,
        email=str(body.email),
        company=body.company,
        job_title=body.job_title,
        pronouns=body.pronouns,
        bio=body.bio,
    )
    roster = await _roster(session)
    found = next((row for row in roster if row.email == str(body.email)), None)
    if found is None:
        raise NotFoundError("The speaker was not attached to this event.")
    return found


@router.patch("/{event_speaker_id}", response_model=SpeakerRead)
async def update_speaker(
    event_speaker_id: uuid.UUID,
    body: SpeakerUpdate,
    session: DbSession,
    _: User = Depends(require_role(*WRITE)),
) -> SpeakerRead:
    link = await session.get(EventSpeaker, event_speaker_id)
    if link is None:
        raise NotFoundError(f"No speaker on this event with id {event_speaker_id}.")
    speaker = await session.get(Speaker, link.speaker_id)
    if speaker is None:
        raise NotFoundError("That speaker record is missing.")

    changes = body.model_dump(exclude_unset=True)
    if "status" in changes:
        link.status = changes.pop("status")
    for key, value in changes.items():
        setattr(speaker, key, value)
    await session.flush()

    roster = await _roster(session)
    found = next((row for row in roster if row.id == event_speaker_id), None)
    if found is None:
        raise NotFoundError("That speaker record is missing.")
    return found


@router.post("/import", response_model=ImportResult)
async def import_speakers(
    file: Annotated[UploadFile, File()],
    session: DbSession,
    _: User = Depends(require_role(*WRITE)),
) -> ImportResult:
    """A CSV of people onto the roster, matched on email.

    Reports every row it could not use rather than failing the whole file — a
    single bad line in a thousand should not cost the other 999.
    """
    raw = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    if reader.fieldnames is None or "email" not in {f.strip().lower() for f in reader.fieldnames}:
        raise ApiError(
            "The file needs a header row with at least name and email.",
            code="VALIDATION_FAILED",
            status_code=422,
            field="file",
        )

    created = matched = skipped = 0
    errors: list[str] = []
    for number, row in enumerate(reader, start=2):
        if number - 1 > MAX_IMPORT_ROWS:
            errors.append(f"Stopped at {MAX_IMPORT_ROWS} rows; the rest were not imported.")
            break
        clean = {(key or "").strip().lower(): (value or "").strip() for key, value in row.items()}
        email, name = clean.get("email", ""), clean.get("name", "")
        if email == "" or "@" not in email:
            skipped += 1
            errors.append(f"Row {number}: no usable email.")
            continue
        if name == "":
            skipped += 1
            errors.append(f"Row {number}: no name.")
            continue
        made, attached = await _attach(
            session,
            name=name,
            email=email,
            company=clean.get("company"),
            job_title=clean.get("job_title") or clean.get("title"),
            pronouns=clean.get("pronouns"),
            bio=clean.get("bio"),
        )
        if made:
            created += 1
        elif attached:
            matched += 1
        else:
            skipped += 1

    return ImportResult(created=created, matched=matched, skipped=skipped, errors=errors[:20])


@router.get("/export.csv")
async def export_speakers(session: DbSession, _: User = Depends(require_role(*READ))) -> Response:
    roster = await _roster(session)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([*CSV_COLUMNS, "status", "submissions"])
    for row in roster:
        writer.writerow(
            [
                row.name,
                row.email,
                row.company or "",
                row.job_title or "",
                row.pronouns or "",
                row.bio or "",
                row.status.value,
                row.submission_count,
            ]
        )
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="speakers.csv"'},
    )


class SpeakerFile(BaseModel):
    """One uploaded file, with enough to show and open it."""

    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    filename: str
    content_type: str
    byte_size: int
    version: int
    uploaded_at: datetime
    #: "Headshot" for the profile photo, otherwise the task that asked for it —
    #: so a deck is labelled by what it answers, not by its filename.
    label: str
    is_headshot: bool


@router.get("/{event_speaker_id}/files", response_model=list[SpeakerFile])
async def speaker_files(
    event_speaker_id: uuid.UUID,
    session: DbSession,
    _: User = Depends(require_role(*READ)),
) -> list[SpeakerFile]:
    """Everything this speaker has sent in: the headshot and every deliverable.

    Collected in two different ways — the profile photo sits on the speaker,
    task uploads hang off the task — and an organiser chasing a missing deck
    should not have to know that. One list, newest first.
    """
    link = await session.get(EventSpeaker, event_speaker_id)
    if link is None:
        raise NotFoundError(f"No speaker on this event with id {event_speaker_id}.")
    person = await session.get(Speaker, link.speaker_id)
    if person is None:  # pragma: no cover - the foreign key guarantees this
        raise NotFoundError("That speaker no longer exists.")

    rows: list[SpeakerFile] = []

    if person.headshot_file_id is not None:
        # Files are org-scoped, so a headshot carried over from another event is
        # still readable here — which is the point of the shared speaker record.
        headshot = await session.get(FileRecord, person.headshot_file_id)
        if headshot is not None:
            rows.append(_speaker_file(headshot, label="Headshot", is_headshot=True))

    uploads = (
        (
            await session.execute(
                select(FileRecord, TaskTemplate.name)
                .join(TaskFile, TaskFile.file_id == FileRecord.id)
                .join(SpeakerTask, SpeakerTask.id == TaskFile.speaker_task_id)
                .join(TaskTemplate, TaskTemplate.id == SpeakerTask.task_template_id)
                .where(SpeakerTask.speaker_id == person.id)
                .order_by(FileRecord.created_at.desc())
            )
        )
        .tuples()
        .all()
    )
    rows.extend(_speaker_file(record, label=name, is_headshot=False) for record, name in uploads)
    return rows


def _speaker_file(record: FileRecord, *, label: str, is_headshot: bool) -> SpeakerFile:
    return SpeakerFile(
        id=record.id,
        filename=record.filename,
        content_type=record.content_type,
        byte_size=record.byte_size,
        version=record.version,
        uploaded_at=record.created_at,
        label=label,
        is_headshot=is_headshot,
    )


@router.post("/{event_speaker_id}/headshot", response_model=SpeakerRead)
async def upload_headshot(
    event_speaker_id: uuid.UUID,
    session: DbSession,
    file: Annotated[UploadFile, File()],
    _: User = Depends(require_role(*WRITE)),
) -> SpeakerRead:
    """Set a speaker's photo from the console.

    The only route that could do this was the speaker's own, in the portal — so
    a speaker who emailed their headshot to the organiser could not be helped,
    and the roster showed initials until they logged in. Versioned through the
    same `version_group_id` as their own upload, so an organiser replacing a
    photo does not orphan the one the speaker sent.
    """
    link = await session.get(EventSpeaker, event_speaker_id)
    if link is None:
        raise NotFoundError(f"No speaker on this event with id {event_speaker_id}.")
    person = await session.get(Speaker, link.speaker_id)
    if person is None:
        raise NotFoundError("That speaker record is missing.")

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
    )
    person.headshot_file_id = record.id
    await session.flush()

    roster = await _roster(session)
    found = next((row for row in roster if row.id == event_speaker_id), None)
    if found is None:
        raise NotFoundError("That speaker record is missing.")
    return found


class InviteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_speaker_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class InviteResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    invited: int
    skipped: int
    #: Named, not counted. "3 skipped" tells an organiser nothing they can act on.
    skipped_names: list[str]


@router.post("/invite", response_model=InviteResult)
async def invite_to_portal(
    body: InviteRequest,
    session: DbSession,
    _: User = Depends(require_role(*WRITE)),
    __: User = Depends(get_verified_user),
) -> InviteResult:
    """Send the portal sign-in link to the named speakers.

    Portal access existed only as something that happened to a speaker — a link
    fell out of an acceptance email, or they asked for one themselves. There was
    no control an organiser could press, which made "have you got into the
    portal yet?" unanswerable and unfixable.

    A repeat invite is allowed: a link expires in thirty minutes and losing one
    is the ordinary case. Every send lands in the outbox, so it is repeated
    visibly rather than silently.
    """
    tenant = current_tenant()
    event = await session.get(Event, tenant.event_id)
    if event is None:
        raise NotFoundError("This event is missing.")

    rows = (
        (
            await session.execute(
                select(EventSpeaker, Speaker)
                .join(Speaker, Speaker.id == EventSpeaker.speaker_id)
                .where(EventSpeaker.id.in_(body.event_speaker_ids))
            )
        )
        .tuples()
        .all()
    )

    invited = 0
    skipped: list[str] = []
    for link, person in rows:
        # A speaker who is no longer presenting should not be invited into a
        # portal that would show them tasks for a talk they withdrew.
        if link.status in (SpeakerStatus.DECLINED, SpeakerStatus.WITHDRAWN):
            skipped.append(person.name)
            continue
        await auth_service.issue_magic_link(session, email=person.email, event_id=event.id)
        invited += 1

    await session.flush()
    return InviteResult(invited=invited, skipped=len(skipped), skipped_names=sorted(skipped))
