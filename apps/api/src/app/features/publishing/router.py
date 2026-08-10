"""Organizer-side publishing: preview the diff, publish, list versions, roll back."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.core.deps import DbSession, bind_tenant, require_role
from app.core.errors import ApiError, NotFoundError
from app.features.publishing import snapshot
from app.features.scheduling import conflicts
from app.models import (
    ConflictDismissal,
    ContentStatus,
    Event,
    PublishedSchedule,
    Role,
    Session,
    SessionSpeaker,
    SessionSpeakerRole,
    SessionStatus,
    Speaker,
    User,
)

router = APIRouter(
    prefix="/v1/events/{event_id}/schedule",
    tags=["publishing"],
    dependencies=[Depends(bind_tenant)],
)

PUBLISH = (Role.OWNER, Role.ADMIN)
STAFF = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)


class PublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str | None = Field(default=None, max_length=500)
    #: Publishing over a known double-booking is allowed, but never by accident.
    acknowledge_conflicts: bool = False


class RollbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(ge=1)


class VersionRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    version: int
    published_at: Any
    note: str | None
    session_count: int = 0


class ApprovalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_status: ContentStatus


async def _event(session: DbSession, event_id: Any) -> Event:
    event = await session.get(Event, event_id)
    if event is None:
        raise NotFoundError("No such event.")
    return event


@router.get("/diff")
async def diff(
    event_id: Any, session: DbSession, _: User = Depends(require_role(*STAFF))
) -> dict[str, Any]:
    """What the world would see change if you published right now."""
    event = await _event(session, event_id)
    published = await snapshot.latest(session)
    return snapshot.diff(
        await snapshot.build(session, event),
        dict(published.snapshot) if published else None,
    )


@router.post("/publish", status_code=status.HTTP_201_CREATED)
async def publish(
    event_id: Any,
    body: PublishRequest,
    session: DbSession,
    user: User = Depends(require_role(*PUBLISH)),
) -> dict[str, Any]:
    event = await _event(session, event_id)

    # Organisers do sometimes publish over a clash knowingly, so this is a
    # confirmation rather than a block — but it has to be a deliberate one.
    if not body.acknowledge_conflicts:
        hard = [
            item
            for item in await conflicts.detect(session, soft_enabled=event.soft_conflicts_enabled)
            if item.is_hard
        ]
        dismissed = set(
            (await session.execute(select(ConflictDismissal.conflict_key))).scalars().all()
        )
        standing = [item for item in hard if item.conflict_key not in dismissed]
        if standing:
            raise ApiError(
                f"{len(standing)} unresolved double-booking"
                f"{'s' if len(standing) > 1 else ''}. Resolve them, or publish anyway.",
                code="UNRESOLVED_CONFLICTS",
                status_code=409,
                details={"count": len(standing)},
            )

    published = await snapshot.publish(session, event=event, user_id=user.id, note=body.note)
    return {
        "version": published.version,
        "published_at": published.published_at,
        "sessions": len(published.snapshot.get("sessions", [])),
        "speakers": len(published.snapshot.get("speakers", [])),
    }


@router.get("/versions", response_model=list[VersionRead])
async def versions(
    session: DbSession, _: User = Depends(require_role(*STAFF))
) -> list[VersionRead]:
    rows = (
        (
            await session.execute(
                select(PublishedSchedule).order_by(PublishedSchedule.version.desc())
            )
        )
        .scalars()
        .all()
    )
    return [
        VersionRead(
            version=r.version,
            published_at=r.published_at,
            note=r.note,
            session_count=len(r.snapshot.get("sessions", [])),
        )
        for r in rows
    ]


@router.post("/rollback", status_code=status.HTTP_201_CREATED)
async def rollback(
    event_id: Any,
    body: RollbackRequest,
    session: DbSession,
    user: User = Depends(require_role(*PUBLISH)),
) -> dict[str, Any]:
    event = await _event(session, event_id)
    restored = await snapshot.rollback(session, event=event, version=body.version, user_id=user.id)
    return {"version": restored.version, "restored_from": body.version}


approval_router = APIRouter(
    prefix="/v1/events/{event_id}/sessions",
    tags=["publishing"],
    dependencies=[Depends(bind_tenant)],
)


class SessionSpeakerRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    name: str
    role: SessionSpeakerRole


class SessionRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    title: str
    slug: str
    abstract: str | None
    submission_id: uuid.UUID | None
    track_id: uuid.UUID | None
    session_format_id: uuid.UUID | None
    duration_minutes: int
    event_day_id: uuid.UUID | None
    room_id: uuid.UUID | None
    starts_at: datetime | None
    is_locked: bool
    status: SessionStatus
    content_status: ContentStatus
    speakers: list[SessionSpeakerRead] = Field(default_factory=list)


@approval_router.get("", response_model=list[SessionRead])
async def list_sessions(
    session: DbSession, _: User = Depends(require_role(*STAFF))
) -> list[SessionRead]:
    """Every session in the event, placed or not.

    The agenda's unscheduled tray and the sessions table are the same list read
    two ways, so this returns both rather than filtering on placement.
    """
    rows = (
        (await session.execute(select(Session).order_by(Session.starts_at, Session.title)))
        .scalars()
        .all()
    )
    if not rows:
        return []

    links = (
        (
            await session.execute(
                select(SessionSpeaker, Speaker)
                .join(Speaker, Speaker.id == SessionSpeaker.speaker_id)
                .where(SessionSpeaker.session_id.in_([row.id for row in rows]))
                .order_by(SessionSpeaker.sort_order)
            )
        )
        .tuples()
        .all()
    )
    by_session: dict[uuid.UUID, list[SessionSpeakerRead]] = {}
    for link, speaker in links:
        by_session.setdefault(link.session_id, []).append(
            SessionSpeakerRead(id=speaker.id, name=speaker.name, role=link.role)
        )

    return [
        SessionRead(
            id=row.id,
            title=row.title,
            slug=row.slug,
            abstract=row.abstract,
            submission_id=row.submission_id,
            track_id=row.track_id,
            session_format_id=row.session_format_id,
            duration_minutes=row.duration_minutes,
            event_day_id=row.event_day_id,
            room_id=row.room_id,
            starts_at=row.starts_at,
            is_locked=row.is_locked,
            status=row.status,
            content_status=row.content_status,
            speakers=by_session.get(row.id, []),
        )
        for row in rows
    ]


@approval_router.post("/{session_id}/approval")
async def set_approval(
    session_id: Any,
    body: ApprovalRequest,
    session: DbSession,
    _: User = Depends(require_role(*STAFF)),
) -> dict[str, Any]:
    """The gate on public content. Nothing unapproved enters a snapshot."""
    talk = await session.get(Session, session_id)
    if talk is None:
        raise NotFoundError(f"No session with id {session_id}.")
    talk.content_status = body.content_status
    await session.flush()
    return {"id": str(talk.id), "content_status": talk.content_status.value}
