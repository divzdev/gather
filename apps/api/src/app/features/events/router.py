"""Events the signed-in user belongs to.

Deliberately unscoped by tenant: this is the query that tells the console which
tenants exist for this caller, so it cannot already be filtered by one.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_, select

from app.core.deps import CurrentUser, DbSession, bind_tenant, require_role
from app.core.errors import RoleRequiredError
from app.core.tenancy import tenancy_disabled
from app.models import Event, EventMember, EventStatus, OrgMember, Role

router = APIRouter(prefix="/v1/events", tags=["events"])

# Any staff member can read the event they work on; reviewers see it in the console too.
READ = (Role.OWNER, Role.ADMIN, Role.COORDINATOR, Role.REVIEWER)


class EventSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    status: EventStatus
    timezone: str
    starts_on: date
    ends_on: date


class EventDetail(EventSummary):
    location: str | None
    description: str | None
    cfp_opens_at: datetime | None
    cfp_closes_at: datetime | None


@router.get(
    "/{event_id}",
    response_model=EventDetail,
    dependencies=[Depends(bind_tenant), Depends(require_role(*READ))],
)
async def read_event(event_id: uuid.UUID, session: DbSession) -> Event:
    event = await session.get(Event, event_id)
    if event is None:
        raise RoleRequiredError("You do not have access to this event.")
    return event


@router.get("", response_model=list[EventSummary])
async def my_events(user: CurrentUser, session: DbSession) -> list[Event]:
    with tenancy_disabled():
        org_ids = (
            (await session.execute(select(OrgMember.org_id).where(OrgMember.user_id == user.id)))
            .scalars()
            .all()
        )
        event_ids = (
            (
                await session.execute(
                    select(EventMember.event_id).where(EventMember.user_id == user.id)
                )
            )
            .scalars()
            .all()
        )
        rows = (
            (
                await session.execute(
                    select(Event)
                    .where(or_(Event.org_id.in_(org_ids), Event.id.in_(event_ids)))
                    .order_by(Event.starts_on.desc())
                )
            )
            .scalars()
            .all()
        )
    return list(rows)
