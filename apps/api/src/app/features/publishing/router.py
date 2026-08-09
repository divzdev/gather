"""Organizer-side publishing: preview the diff, publish, list versions, roll back."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.core.deps import DbSession, bind_tenant, require_role
from app.core.errors import NotFoundError
from app.features.publishing import snapshot
from app.models import ContentStatus, Event, PublishedSchedule, Role, Session, User

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
