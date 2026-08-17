"""One session at a time: create it, edit it, remove it.

The bulk and import paths live next door in `session_bulk`. They are separated
because the rules differ rather than to tidy the file: a bulk sweep skips locked
rows silently, where a single deliberate edit of a locked session should say what
it will and will not touch.

There was no edit endpoint at all before this module. An organiser who typed a
keynote's title wrong could delete the session and build it again, losing its
placement and its speakers, or live with the typo.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import DbSession, bind_tenant, require_role
from app.core.errors import ApiError, NotFoundError
from app.models import (
    ActivityLog,
    ActorKind,
    ExpertiseLevel,
    Role,
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

STAFF = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)

MIN_DURATION = 5
MAX_DURATION = 600
MAX_TAGS = 12


async def _require(session: AsyncSession, model: Any, item_id: uuid.UUID, label: str) -> None:
    if await session.get(model, item_id) is None:
        raise NotFoundError(f"No {label} in this event with id {item_id}.")


async def _unique_slug(session: AsyncSession, title: str) -> str:
    """Slugs are the public URL, so a collision would make one session
    unreachable rather than merely ugly."""
    base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60] or "session"
    taken = set(
        (await session.execute(select(Session.slug).where(Session.slug.like(f"{base}%")))).scalars()
    )
    if base not in taken:
        return base
    return next(f"{base}-{n}" for n in range(2, 1000) if f"{base}-{n}" not in taken)


def _clean_tags(tags: list[str]) -> list[str]:
    """Trimmed, de-duplicated, order kept.

    The public schedule builds its filter list from these, so "AI", "ai " and
    "AI" arriving three times would show three checkboxes for one idea.
    """
    seen: dict[str, str] = {}
    for tag in tags:
        trimmed = tag.strip()
        if trimmed and trimmed.casefold() not in seen:
            seen[trimmed.casefold()] = trimmed
    return list(seen.values())


class SessionCreate(BaseModel):
    """A session with no proposal behind it.

    Keynotes and invited talks never go through the CFP, so promotion cannot be
    the only way a session comes into being.
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=300)
    abstract: str | None = Field(default=None, max_length=10_000)
    track_id: uuid.UUID | None = None
    session_format_id: uuid.UUID | None = None
    duration_minutes: int = Field(default=30, ge=MIN_DURATION, le=MAX_DURATION)
    speaker_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    tags: list[str] = Field(default_factory=list, max_length=MAX_TAGS)
    expertise_level: ExpertiseLevel | None = None
    language: str | None = Field(default=None, max_length=40)


class SessionPatch(BaseModel):
    """Whichever fields are present are applied; the rest are left alone.

    Sending an explicit null clears a nullable field, which is why this reads
    `exclude_unset` rather than treating None as "no change" — an organiser has
    to be able to take a track off a session.
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=300)
    abstract: str | None = Field(default=None, max_length=10_000)
    track_id: uuid.UUID | None = None
    session_format_id: uuid.UUID | None = None
    duration_minutes: int | None = Field(default=None, ge=MIN_DURATION, le=MAX_DURATION)
    tags: list[str] | None = Field(default=None, max_length=MAX_TAGS)
    expertise_level: ExpertiseLevel | None = None
    language: str | None = Field(default=None, max_length=40)
    #: Replace-all, mirroring create. Unset leaves the speakers alone; an empty
    #: list removes everyone. The Participants tab was a dead input until this
    #: existed — the API could attach speakers at creation and never again.
    speaker_ids: list[uuid.UUID] | None = None


@router.post("", status_code=201)
async def create_session(
    body: SessionCreate,
    session: DbSession,
    _: User = Depends(require_role(*STAFF)),
) -> dict[str, Any]:
    if body.track_id is not None:
        await _require(session, Track, body.track_id, "track")
    if body.session_format_id is not None:
        await _require(session, SessionFormat, body.session_format_id, "session format")

    talk = Session(
        title=body.title,
        abstract=body.abstract,
        slug=await _unique_slug(session, body.title),
        track_id=body.track_id,
        session_format_id=body.session_format_id,
        duration_minutes=body.duration_minutes,
        tags=_clean_tags(body.tags),
        expertise_level=body.expertise_level,
        language=body.language,
    )
    session.add(talk)
    await session.flush()

    for index, speaker_id in enumerate(body.speaker_ids):
        await _require(session, Speaker, speaker_id, "speaker")
        session.add(SessionSpeaker(session_id=talk.id, speaker_id=speaker_id, sort_order=index))
    await session.flush()

    return {"id": str(talk.id), "title": talk.title, "slug": talk.slug}


@router.patch("/{session_id}")
async def patch_session(
    session_id: uuid.UUID,
    body: SessionPatch,
    session: DbSession,
    actor: User = Depends(require_role(*STAFF)),
) -> dict[str, Any]:
    """Edit one session's content.

    The slug is deliberately not regenerated from a new title: it is the public
    URL, and a schedule that has been published once has that URL in inboxes and
    calendar entries.
    """
    talk = await session.get(Session, session_id)
    if talk is None:
        raise NotFoundError(f"No session in this event with id {session_id}.")

    changes = body.model_dump(exclude_unset=True)
    # Locking pins a session's footprint on the grid, so duration is refused
    # while the rest of the edit goes through. Wording, tags and track are not
    # what an organiser locked the row to protect.
    if talk.is_locked and "duration_minutes" in changes:
        raise ApiError(
            f"{talk.title!r} is locked, so its length cannot change. Unlock it first.",
            code="SESSION_LOCKED",
            status_code=409,
        )
    if changes.get("track_id") is not None:
        await _require(session, Track, changes["track_id"], "track")
    if changes.get("session_format_id") is not None:
        await _require(session, SessionFormat, changes["session_format_id"], "session format")
    if "tags" in changes and changes["tags"] is not None:
        changes["tags"] = _clean_tags(changes["tags"])

    speaker_ids = changes.pop("speaker_ids", None)

    # Captured before the write, so the log holds what it actually replaced.
    before = {key: _loggable(getattr(talk, key, None)) for key in changes if key in _CONTENT}

    for key, value in changes.items():
        setattr(talk, key, value)

    after = {key: _loggable(value) for key, value in changes.items() if key in _CONTENT}
    if before != after:
        session.add(
            ActivityLog(
                event_id=talk.event_id,
                actor_user_id=actor.id,
                actor_kind=ActorKind.USER,
                entity_type="session",
                entity_id=talk.id,
                action="session.edited",
                changes={"before": before, "after": after},
            )
        )

    if speaker_ids is not None:
        for speaker_id in speaker_ids:
            await _require(session, Speaker, speaker_id, "speaker")
        # ORM deletes, not a bulk statement: bulk DELETE bypasses the tenancy
        # guard, and a session has at most a handful of speakers anyway.
        existing = (
            (
                await session.execute(
                    select(SessionSpeaker).where(SessionSpeaker.session_id == talk.id)
                )
            )
            .scalars()
            .all()
        )
        for row in existing:
            await session.delete(row)
        await session.flush()
        for index, speaker_id in enumerate(dict.fromkeys(speaker_ids)):
            session.add(SessionSpeaker(session_id=talk.id, speaker_id=speaker_id, sort_order=index))

    await session.flush()
    return {"id": str(talk.id), "title": talk.title, "slug": talk.slug}


@router.delete("/{session_id}", status_code=204)
async def delete_session(
    session_id: uuid.UUID,
    session: DbSession,
    _: User = Depends(require_role(*STAFF)),
) -> None:
    """Removing a session from the draft.

    Allowed even when it is on the published schedule: the public site reads a
    snapshot, so nothing changes out there until the next publish, and an
    organiser who has cancelled a talk needs to act before then.
    """
    talk = await session.get(Session, session_id)
    if talk is None:
        raise NotFoundError(f"No session in this event with id {session_id}.")
    if talk.is_locked:
        raise ApiError(
            f"{talk.title!r} is locked. Unlock it first.",
            code="SESSION_LOCKED",
            status_code=409,
        )
    await session.delete(talk)
    await session.flush()


#: The fields a change history is *about*. A session's placement moves for a
#: dozen reasons a day and is already visible on the grid; what an organiser
#: needs a record of is the words that reach the public page.
_CONTENT = ("title", "abstract", "expertise_level", "language", "tags")


def _loggable(value: Any) -> Any:
    """JSONB holds no enums and no UUIDs."""
    if isinstance(value, uuid.UUID):
        return str(value)
    if hasattr(value, "value"):
        return value.value
    return value


class HistoryEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    at: datetime
    actor_name: str
    #: What the field held *before* this edit — which is what restoring it puts
    #: back. The current values are on the session itself.
    before: dict[str, Any]
    after: dict[str, Any]


@router.get("/{session_id}/history", response_model=list[HistoryEntry])
async def session_history(
    session_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*STAFF))
) -> list[HistoryEntry]:
    """Who changed this session's wording, when, and to what.

    `ActivityLog` has recorded before/after diffs since the first migration and
    nothing read it, so a title that changed under an organiser had no author
    and no previous value. This is a history of one session's content — not the
    audit-log browser the non-goals rule out.
    """
    rows = (
        (
            await session.execute(
                select(ActivityLog, User)
                .outerjoin(User, User.id == ActivityLog.actor_user_id)
                .where(
                    ActivityLog.entity_type == "session",
                    ActivityLog.entity_id == session_id,
                    ActivityLog.action == "session.edited",
                )
                .order_by(ActivityLog.created_at.desc())
            )
        )
        .tuples()
        .all()
    )
    return [
        HistoryEntry(
            id=entry.id,
            at=entry.created_at,
            actor_name=user.name if user is not None else "Someone who has since left",
            before=entry.changes.get("before", {}),
            after=entry.changes.get("after", {}),
        )
        for entry, user in rows
    ]


class RestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entry_id: uuid.UUID


@router.post("/{session_id}/restore")
async def restore_session(
    session_id: uuid.UUID,
    body: RestoreRequest,
    session: DbSession,
    actor: User = Depends(require_role(*STAFF)),
) -> dict[str, Any]:
    """Put back what one edit replaced.

    Restoring is itself an edit: it writes its own log entry, so the history
    keeps growing and an undo can be undone. Nothing is rewound or deleted —
    the same reason files are versioned rather than overwritten.
    """
    talk = await session.get(Session, session_id)
    if talk is None:
        raise NotFoundError(f"No session in this event with id {session_id}.")

    entry = await session.get(ActivityLog, body.entry_id)
    if entry is None or entry.entity_id != session_id or entry.action != "session.edited":
        raise NotFoundError("No such change on this session.")

    wanted = {
        key: value for key, value in entry.changes.get("before", {}).items() if key in _CONTENT
    }
    if not wanted:
        raise ApiError(
            "That change recorded nothing that can be put back.",
            code="NOTHING_TO_RESTORE",
            status_code=409,
        )

    before = {key: _loggable(getattr(talk, key, None)) for key in wanted}
    for key, value in wanted.items():
        setattr(talk, key, value)

    session.add(
        ActivityLog(
            event_id=talk.event_id,
            actor_user_id=actor.id,
            actor_kind=ActorKind.USER,
            entity_type="session",
            entity_id=talk.id,
            action="session.edited",
            changes={"before": before, "after": wanted, "restored_from": str(entry.id)},
        )
    )
    await session.flush()
    return {"id": str(talk.id), "title": talk.title, "restored": sorted(wanted)}
