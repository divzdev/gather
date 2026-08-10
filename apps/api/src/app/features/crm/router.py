"""The speaker directory: everyone this organisation has ever worked with.

The roster under `/v1/events/{id}/speakers` answers "who is speaking at this
one". This answers "who do we know", across every year, which is what makes
inviting last year's best keynote a two-click job instead of a spreadsheet
archaeology exercise.

Scoped to the org with no event bound, deliberately — see `bind_org_tenant`.
"""

from __future__ import annotations

import csv
import io
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Response, UploadFile
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, select

from app.core import mail
from app.core.deps import DbSession, bind_org_tenant, require_org_role
from app.core.errors import ApiError, NotFoundError
from app.core.tenancy import current_tenant, tenant_scope
from app.models import (
    Event,
    EventSpeaker,
    MessagePurpose,
    Role,
    Speaker,
    SpeakerStatus,
    Submission,
    SubmissionSpeaker,
)

router = APIRouter(
    prefix="/v1/orgs/{org_id}/directory",
    tags=["crm"],
    dependencies=[Depends(bind_org_tenant)],
)

READ = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)
WRITE = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)
SEND = (Role.OWNER, Role.ADMIN)

MAX_IMPORT_ROWS = 1000
PIPELINE = ("prospect", "invited", "confirmed", "alum", "declined")


class EventAppearance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: uuid.UUID
    event_name: str
    status: SpeakerStatus


class ContactRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    name: str
    email: str
    company: str | None
    job_title: str | None
    bio: str | None
    tags: list[str]
    crm_status: str
    submission_count: int
    events: list[EventAppearance]


class ContactUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    company: str | None = Field(default=None, max_length=200)
    job_title: str | None = Field(default=None, max_length=200)
    bio: str | None = None
    tags: list[str] | None = Field(default=None, max_length=25)
    crm_status: str | None = Field(default=None, max_length=40)


class ContactCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    company: str | None = Field(default=None, max_length=200)
    job_title: str | None = Field(default=None, max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=25)


class ImportResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    created: int
    matched: int
    skipped: int
    errors: list[str]


class PushRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: uuid.UUID


class PushResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    added: int
    already_there: int


class BulkEmail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    speaker_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    subject: str = Field(min_length=1, max_length=200)
    #: Merge tags: {{name}}, {{company}}, {{first_name}}.
    body: str = Field(min_length=1)
    event_id: uuid.UUID


class SendResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sent: int


def merge(template: str, speaker: Speaker) -> str:
    """Substitute the three fields worth personalising and leave the rest alone.

    Deliberately not a template engine: an organiser typing into a textarea
    should not be able to reach anything but their own contact's fields.
    """
    first = speaker.name.split(" ")[0] if speaker.name else ""
    for token, value in (
        ("{{name}}", speaker.name),
        ("{{first_name}}", first),
        ("{{company}}", speaker.company or ""),
    ):
        template = template.replace(token, value)
    return template


async def _directory(session: DbSession) -> list[ContactRead]:
    people = (await session.execute(select(Speaker).order_by(Speaker.name))).scalars().all()
    if not people:
        return []

    appearances = (
        (
            await session.execute(
                select(EventSpeaker, Event)
                .join(Event, Event.id == EventSpeaker.event_id)
                .order_by(Event.starts_on.desc())
            )
        )
        .tuples()
        .all()
    )
    by_speaker: dict[uuid.UUID, list[EventAppearance]] = {}
    for link, event in appearances:
        by_speaker.setdefault(link.speaker_id, []).append(
            EventAppearance(event_id=event.id, event_name=event.name, status=link.status)
        )

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
        ContactRead(
            id=person.id,
            name=person.name,
            email=person.email,
            company=person.company,
            job_title=person.job_title,
            bio=person.bio,
            tags=list(person.tags),
            crm_status=person.crm_status,
            submission_count=int(counts.get(person.id, 0)),
            events=by_speaker.get(person.id, []),
        )
        for person in people
    ]


async def _find_or_create(
    session: DbSession, *, name: str, email: str, **fields: Any
) -> tuple[Speaker, bool]:
    """Matching is by email inside the organisation, which is the whole point of
    a directory: last year's speaker is found, not added again."""
    speaker = await session.scalar(select(Speaker).where(Speaker.email == email))
    if speaker is not None:
        for key, value in fields.items():
            if value not in (None, "") and getattr(speaker, key, None) in (None, ""):
                setattr(speaker, key, value)
        return speaker, False

    speaker = Speaker(org_id=current_tenant().org_id, email=email, name=name)
    for key, value in fields.items():
        if value not in (None, ""):
            setattr(speaker, key, value)
    session.add(speaker)
    await session.flush()
    return speaker, True


@router.get("", response_model=list[ContactRead])
async def list_directory(
    session: DbSession, _: Role = Depends(require_org_role(*READ))
) -> list[ContactRead]:
    return await _directory(session)


@router.post("", response_model=ContactRead, status_code=201)
async def add_contact(
    body: ContactCreate, session: DbSession, _: Role = Depends(require_org_role(*WRITE))
) -> ContactRead:
    speaker, _created = await _find_or_create(
        session,
        name=body.name,
        email=str(body.email),
        company=body.company,
        job_title=body.job_title,
    )
    if body.tags:
        speaker.tags = sorted({*speaker.tags, *body.tags})
    await session.flush()

    found = next((row for row in await _directory(session) if row.id == speaker.id), None)
    if found is None:  # pragma: no cover - just written
        raise NotFoundError("That contact could not be read back.")
    return found


@router.patch("/{speaker_id}", response_model=ContactRead)
async def update_contact(
    speaker_id: uuid.UUID,
    body: ContactUpdate,
    session: DbSession,
    _: Role = Depends(require_org_role(*WRITE)),
) -> ContactRead:
    speaker = await session.get(Speaker, speaker_id)
    if speaker is None:
        raise NotFoundError(f"No contact with id {speaker_id}.")

    changes = body.model_dump(exclude_unset=True)
    if changes.get("crm_status") is not None and changes["crm_status"] not in PIPELINE:
        raise ApiError(
            f"Pipeline status must be one of {', '.join(PIPELINE)}.",
            code="VALIDATION_FAILED",
            status_code=422,
            field="crm_status",
        )
    if changes.get("tags") is not None:
        changes["tags"] = sorted({tag.strip() for tag in changes["tags"] if tag.strip()})
    for key, value in changes.items():
        setattr(speaker, key, value)
    await session.flush()

    found = next((row for row in await _directory(session) if row.id == speaker_id), None)
    if found is None:  # pragma: no cover - just written
        raise NotFoundError(f"No contact with id {speaker_id}.")
    return found


@router.post("/import", response_model=ImportResult)
async def import_contacts(
    file: Annotated[UploadFile, File()],
    session: DbSession,
    _: Role = Depends(require_org_role(*WRITE)),
) -> ImportResult:
    """A CSV into the directory, matched on email. Re-running it changes nothing.

    Every unusable row is reported rather than aborting the file: one bad line in
    a thousand should not cost the other 999.
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

        speaker, made = await _find_or_create(
            session,
            name=name,
            email=email,
            company=clean.get("company"),
            job_title=clean.get("job_title") or clean.get("title"),
            bio=clean.get("bio"),
        )
        tags = [tag.strip() for tag in clean.get("tags", "").split(";") if tag.strip()]
        if tags:
            speaker.tags = sorted({*speaker.tags, *tags})
        if made:
            created += 1
        else:
            matched += 1

    await session.flush()
    return ImportResult(created=created, matched=matched, skipped=skipped, errors=errors[:20])


@router.post("/{speaker_id}/push", response_model=PushResult)
async def push_to_event(
    speaker_id: uuid.UUID,
    body: PushRequest,
    session: DbSession,
    _: Role = Depends(require_org_role(*WRITE)),
) -> PushResult:
    """Put a contact on a specific event's roster.

    The handoff the directory exists for. Idempotent: pushing someone already on
    that event reports it rather than creating a second participation row.
    """
    speaker = await session.get(Speaker, speaker_id)
    if speaker is None:
        raise NotFoundError(f"No contact with id {speaker_id}.")

    tenant = current_tenant()
    event = await session.get(Event, body.event_id)
    if event is None or event.org_id != tenant.org_id:
        raise NotFoundError(f"No event with id {body.event_id} in this organisation.")

    # Scoped to the target event so the membership check and the insert both see
    # that event and not the whole organisation.
    with tenant_scope(org_id=tenant.org_id, event_id=event.id):
        existing = await session.scalar(
            select(EventSpeaker).where(EventSpeaker.speaker_id == speaker_id)
        )
        if existing is not None:
            return PushResult(added=0, already_there=1)
        session.add(
            EventSpeaker(
                org_id=tenant.org_id,
                event_id=event.id,
                speaker_id=speaker_id,
                status=SpeakerStatus.PROSPECTIVE,
            )
        )
        await session.flush()
    return PushResult(added=1, already_there=0)


@router.post("/email", response_model=SendResult)
async def bulk_email(
    body: BulkEmail, session: DbSession, _: Role = Depends(require_org_role(*SEND))
) -> SendResult:
    """One personalised message per selected contact.

    Every send in this product is deliberate and never optimistic, so this
    delivers under the caller's own request rather than queueing silently.
    """
    tenant = current_tenant()
    event = await session.get(Event, body.event_id)
    if event is None or event.org_id != tenant.org_id:
        raise NotFoundError(f"No event with id {body.event_id} in this organisation.")

    people = (
        (await session.execute(select(Speaker).where(Speaker.id.in_(body.speaker_ids))))
        .scalars()
        .all()
    )
    if not people:
        raise NotFoundError("None of those contacts are in this directory.")

    # The outbox row is event-scoped even though the audience is org-wide.
    with tenant_scope(org_id=tenant.org_id, event_id=event.id):
        for person in people:
            await mail.send_now(
                session,
                event_id=event.id,
                to_email=person.email,
                to_speaker_id=person.id,
                purpose=MessagePurpose.CUSTOM,
                subject=merge(body.subject, person),
                body=merge(body.body, person),
            )
        await session.flush()
    return SendResult(sent=len(people))


@router.get("/export.csv")
async def export_directory(
    session: DbSession, _: Role = Depends(require_org_role(*READ))
) -> Response:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["name", "email", "company", "job_title", "tags", "crm_status", "events", "submissions"]
    )
    for row in await _directory(session):
        writer.writerow(
            [
                row.name,
                row.email,
                row.company or "",
                row.job_title or "",
                ";".join(row.tags),
                row.crm_status,
                len(row.events),
                row.submission_count,
            ]
        )
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="directory.csv"'},
    )
