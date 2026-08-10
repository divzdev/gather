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
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Response, UploadFile
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, select

from app.core.deps import DbSession, bind_tenant, require_role
from app.core.errors import ApiError, NotFoundError
from app.core.tenancy import current_tenant, tenancy_disabled
from app.models import (
    EventSpeaker,
    Role,
    Speaker,
    SpeakerStatus,
    Submission,
    SubmissionSpeaker,
    User,
)

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
            status=link.status,
            submission_count=int(counts.get(speaker.id, 0)),
            portal_last_seen_at=link.portal_last_seen_at,
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
