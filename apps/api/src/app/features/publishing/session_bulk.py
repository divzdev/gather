"""Editing sessions in bulk, and importing a programme from a spreadsheet.

Two jobs an organiser does on the sessions table and nowhere else: set one field
across a selection, and bring an existing programme in from CSV. Both share the
same lookup-by-name helpers, and neither belongs in the publishing router, which
is about snapshots. Single-session create, edit and delete are in `session_crud`.

Import matches on title within the event, so re-running the same file corrects
rows instead of duplicating them — the second run of an import is the common
case, not the exceptional one, because the first run is how you find the typos.
"""

from __future__ import annotations

import csv
import io
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import DbSession, bind_tenant, require_role
from app.core.errors import ApiError, NotFoundError
from app.features.publishing.session_crud import (
    MAX_DURATION,
    MIN_DURATION,
    STAFF,
    _require,
    _unique_slug,
)
from app.models import (
    ContentStatus,
    ExpertiseLevel,
    Session,
    SessionFormat,
    SessionSpeaker,
    Speaker,
    Track,
    User,
)

router = APIRouter(
    prefix="/v1/events/{event_id}/sessions",
    tags=["sessions"],
    dependencies=[Depends(bind_tenant)],
)

MAX_IMPORT_ROWS = 500

# "Ada Lovelace <ada@example.com>" or a bare address.
_SPEAKER = re.compile(r"^\s*(?:(?P<name>[^<]+?)\s*)?<?(?P<email>[^<>\s@]+@[^<>\s@]+)>?\s*$")


class BulkEdit(BaseModel):
    """Every field optional; whichever are present are applied to every id.

    Deliberately not a general patch endpoint — the fields here are the ones that
    are genuinely the same across a selection. Title and abstract are not, and
    offering them would only invite overwriting five talks with one name. Tags
    are not either: setting them in bulk means replacing whatever each session
    already carried, which is the opposite of what "tag these" sounds like.
    """

    model_config = ConfigDict(extra="forbid")

    session_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    track_id: uuid.UUID | None = None
    session_format_id: uuid.UUID | None = None
    duration_minutes: int | None = Field(default=None, ge=MIN_DURATION, le=MAX_DURATION)
    content_status: ContentStatus | None = None
    expertise_level: ExpertiseLevel | None = None
    language: str | None = Field(default=None, max_length=40)
    clear_track: bool = False

    @model_validator(mode="after")
    def _something_to_do(self) -> BulkEdit:
        changes = (
            self.track_id,
            self.session_format_id,
            self.duration_minutes,
            self.content_status,
            self.expertise_level,
            self.language,
        )
        if all(value is None for value in changes) and not self.clear_track:
            raise ValueError("Name at least one field to change.")
        if self.clear_track and self.track_id is not None:
            raise ValueError("Pass either track_id or clear_track, not both.")
        return self


class BulkResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    updated: int
    skipped_locked: int


class ImportRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row: int
    title: str
    outcome: str
    detail: str | None = None


class ImportResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    created: int
    updated: int
    skipped: int
    rows: list[ImportRow]


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    csv_text: str = Field(max_length=1_000_000)
    dry_run: bool = False


@router.post("/bulk", response_model=BulkResult)
async def bulk_edit(
    body: BulkEdit,
    session: DbSession,
    _: User = Depends(require_role(*STAFF)),
) -> BulkResult:
    """Set one field across a selection.

    ORM loop rather than a Core `update()`: the row count here is at most 200,
    and a Core statement would sidestep the tenancy filter, which is exactly the
    kind of bypass that leaks another event's programme.
    """
    rows = (
        (await session.execute(select(Session).where(Session.id.in_(body.session_ids))))
        .scalars()
        .all()
    )
    found = {row.id for row in rows}
    missing = [str(item) for item in body.session_ids if item not in found]
    if missing:
        raise NotFoundError(f"No session in this event with id {missing[0]}.")

    if body.track_id is not None:
        await _require(session, Track, body.track_id, "track")
    if body.session_format_id is not None:
        await _require(session, SessionFormat, body.session_format_id, "session format")

    updated = skipped = 0
    for row in rows:
        # A locked session is one an organiser has pinned; a bulk sweep is
        # precisely what locking exists to survive.
        if row.is_locked:
            skipped += 1
            continue
        if body.clear_track:
            row.track_id = None
        elif body.track_id is not None:
            row.track_id = body.track_id
        if body.session_format_id is not None:
            row.session_format_id = body.session_format_id
        if body.duration_minutes is not None:
            row.duration_minutes = body.duration_minutes
        if body.content_status is not None:
            row.content_status = body.content_status
        if body.expertise_level is not None:
            row.expertise_level = body.expertise_level
        if body.language is not None:
            row.language = body.language
        updated += 1

    await session.flush()
    return BulkResult(updated=updated, skipped_locked=skipped)


@router.post("/import", response_model=ImportResult)
async def import_sessions(
    body: ImportRequest,
    session: DbSession,
    _: User = Depends(require_role(*STAFF)),
) -> ImportResult:
    """Bring an existing programme in from a spreadsheet.

    A bad row is reported and skipped; it never aborts the file. Someone pasting
    sixty sessions wants the fifty-nine good ones in and a list of what to fix,
    not a rejection and no idea which line caused it.
    """
    reader = csv.DictReader(io.StringIO(body.csv_text.lstrip("﻿")))
    if reader.fieldnames is None or "title" not in {
        (name or "").strip().lower() for name in reader.fieldnames
    }:
        raise ApiError(
            status_code=422,
            code="MISSING_TITLE_COLUMN",
            message="The file needs a 'title' column. Found: "
            + (", ".join(reader.fieldnames or []) or "nothing"),
        )

    tracks = await _by_name(session, Track)
    formats = await _by_name(session, SessionFormat)
    existing = {
        row.title.strip().lower(): row
        for row in (await session.execute(select(Session))).scalars().all()
    }

    created = updated = skipped = 0
    rows: list[ImportRow] = []

    for number, raw in enumerate(reader, start=2):
        if created + updated + skipped >= MAX_IMPORT_ROWS:
            rows.append(
                ImportRow(
                    row=number,
                    title="",
                    outcome="skipped",
                    detail=f"Stopped at {MAX_IMPORT_ROWS} rows; the rest were not imported.",
                )
            )
            break

        record = {(key or "").strip().lower(): (value or "").strip() for key, value in raw.items()}
        title = record.get("title", "")
        if not title:
            skipped += 1
            rows.append(ImportRow(row=number, title="", outcome="skipped", detail="No title."))
            continue

        problem = _validate(record, tracks=tracks, formats=formats)
        if problem is not None:
            skipped += 1
            rows.append(ImportRow(row=number, title=title, outcome="skipped", detail=problem))
            continue

        if body.dry_run:
            rows.append(
                ImportRow(
                    row=number,
                    title=title,
                    outcome="updated" if title.lower() in existing else "created",
                )
            )
            continue

        talk = existing.get(title.lower())
        outcome = "updated"
        if talk is None:
            outcome = "created"
            talk = Session(title=title, slug=await _unique_slug(session, title))
            session.add(talk)
            existing[title.lower()] = talk
            created += 1
        else:
            updated += 1

        _apply(talk, record, tracks=tracks, formats=formats)
        await session.flush()
        await _set_speakers(session, talk, record.get("speakers", ""))
        rows.append(ImportRow(row=number, title=title, outcome=outcome))

    await session.flush()
    return ImportResult(created=created, updated=updated, skipped=skipped, rows=rows[:100])


def _validate(
    record: dict[str, str],
    *,
    tracks: dict[str, uuid.UUID],
    formats: dict[str, uuid.UUID],
) -> str | None:
    """The reason this row cannot be imported, or None."""
    track = record.get("track", "")
    if track and track.lower() not in tracks:
        return f"No track named '{track}'. Create it under Program setup first."

    session_format = record.get("format", "")
    if session_format and session_format.lower() not in formats:
        return f"No session format named '{session_format}'."

    duration = record.get("duration_minutes", "") or record.get("duration", "")
    if duration:
        if not duration.isdigit():
            return f"Duration must be a whole number of minutes, got '{duration}'."
        if not MIN_DURATION <= int(duration) <= MAX_DURATION:
            return f"Duration must be between {MIN_DURATION} and {MAX_DURATION} minutes."

    speakers = record.get("speakers", "")
    for entry in [part for part in speakers.split(";") if part.strip()]:
        if _SPEAKER.match(entry) is None:
            return f"Cannot read speaker '{entry.strip()}'. Use: Name <email@example.com>."

    return None


def _apply(
    talk: Session,
    record: dict[str, str],
    *,
    tracks: dict[str, uuid.UUID],
    formats: dict[str, uuid.UUID],
) -> None:
    talk.abstract = record.get("abstract") or talk.abstract
    if track := record.get("track", ""):
        talk.track_id = tracks[track.lower()]
    if session_format := record.get("format", ""):
        talk.session_format_id = formats[session_format.lower()]
    duration = record.get("duration_minutes", "") or record.get("duration", "")
    if duration:
        talk.duration_minutes = int(duration)


async def _set_speakers(session: AsyncSession, talk: Session, raw: str) -> None:
    """Replace the session's speakers with whatever the row names.

    Matching is by email, so the same person across two imported sessions is one
    Speaker row rather than two — that is the whole point of the org-scoped
    speaker record.
    """
    entries = [part for part in raw.split(";") if part.strip()]
    if not entries:
        return

    existing = (
        (await session.execute(select(SessionSpeaker).where(SessionSpeaker.session_id == talk.id)))
        .scalars()
        .all()
    )
    for link in existing:
        await session.delete(link)
    # Flushed before the inserts: a unit of work emits inserts ahead of deletes,
    # so re-importing a row with the same speaker hit the uniqueness constraint.
    await session.flush()

    for index, entry in enumerate(entries):
        match = _SPEAKER.match(entry)
        if match is None:  # pragma: no cover - _validate rejected these already
            continue
        email = match.group("email").strip().lower()
        name = (match.group("name") or "").strip() or email.split("@")[0]

        person = await session.scalar(select(Speaker).where(func.lower(Speaker.email) == email))
        if person is None:
            person = Speaker(name=name, email=email)
            session.add(person)
            await session.flush()
        session.add(SessionSpeaker(session_id=talk.id, speaker_id=person.id, sort_order=index))

    await session.flush()


async def _by_name(session: AsyncSession, model: Any) -> dict[str, uuid.UUID]:
    rows = (await session.execute(select(model))).scalars().all()
    return {row.name.strip().lower(): row.id for row in rows}
