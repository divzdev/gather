"""Events the signed-in user belongs to.

Deliberately unscoped by tenant: this is the query that tells the console which
tenants exist for this caller, so it cannot already be filtered by one.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select

from app.core.deps import CurrentUser, DbSession, bind_tenant, require_role
from app.core.errors import ApiError, ConflictError, RoleRequiredError
from app.core.tenancy import tenancy_disabled
from app.models import Event, EventMember, EventStatus, Form, FormKind, OrgMember, Role, User

router = APIRouter(prefix="/v1/events", tags=["events"])

# Any staff member can read the event they work on; reviewers see it in the console too.
READ = (Role.OWNER, Role.ADMIN, Role.COORDINATOR, Role.REVIEWER)
# Renaming the event or moving its dates is an owner/admin decision.
WRITE = (Role.OWNER, Role.ADMIN)


class EventSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    # The console remembers an event, but the speaker directory is org-scoped, so
    # this is how a screen finds the organisation it is working inside.
    org_id: uuid.UUID
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
    #: Both are enforced elsewhere and were unreachable from the API: the CFP
    #: refuses a proposal over the limit, and the conflict engine skips track
    #: collisions when they are switched off, but nothing could set either.
    submission_limit_per_speaker: int | None
    soft_conflicts_enabled: bool


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


class EventUpdate(BaseModel):
    """Every field optional: the settings screen saves one panel at a time."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, min_length=1, max_length=100)
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    starts_on: date | None = None
    ends_on: date | None = None
    location: str | None = Field(default=None, max_length=300)
    description: str | None = None
    status: EventStatus | None = None
    cfp_opens_at: datetime | None = None
    cfp_closes_at: datetime | None = None
    submission_limit_per_speaker: int | None = Field(default=None, ge=1, le=100)
    soft_conflicts_enabled: bool | None = None


@router.patch(
    "/{event_id}",
    response_model=EventDetail,
    dependencies=[Depends(bind_tenant), Depends(require_role(*WRITE))],
)
async def update_event(event_id: uuid.UUID, body: EventUpdate, session: DbSession) -> Event:
    event = await session.get(Event, event_id)
    if event is None:
        raise RoleRequiredError("You do not have access to this event.")

    changes = body.model_dump(exclude_unset=True)
    if changes.get("slug") is not None and changes["slug"] != event.slug:
        clash = await session.scalar(
            select(Event).where(Event.slug == changes["slug"], Event.id != event.id)
        )
        if clash is not None:
            raise ConflictError(f"The slug {changes['slug']!r} is already in use.")

    starts = changes.get("starts_on", event.starts_on)
    ends = changes.get("ends_on", event.ends_on)
    if starts is not None and ends is not None and ends < starts:
        raise ApiError(
            "The event cannot end before it starts.",
            code="VALIDATION_FAILED",
            status_code=422,
            field="ends_on",
        )

    opens = changes.get("cfp_opens_at", event.cfp_opens_at)
    closes = changes.get("cfp_closes_at", event.cfp_closes_at)
    if opens is not None and closes is not None and closes < opens:
        raise ApiError(
            "The call for papers cannot close before it opens.",
            code="VALIDATION_FAILED",
            status_code=422,
            field="cfp_closes_at",
        )

    for field_name, value in changes.items():
        setattr(event, field_name, value)

    # The submission window is checked against the form, which may carry its own
    # dates — task forms legitimately do. For the CFP the two are the same
    # concept, so letting them diverge makes the settings field a silent no-op:
    # the organiser closes the call and the public form stays open.
    if "cfp_closes_at" in changes or "cfp_opens_at" in changes:
        cfp_forms = (await session.scalars(select(Form).where(Form.kind == FormKind.CFP))).all()
        for form in cfp_forms:
            if "cfp_closes_at" in changes:
                form.closes_at = changes["cfp_closes_at"]
            if "cfp_opens_at" in changes:
                form.opens_at = changes["cfp_opens_at"]

    await session.flush()
    return event


class MemberRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    user_id: uuid.UUID
    name: str
    email: str
    role: Role


@router.get(
    "/{event_id}/members",
    response_model=list[MemberRead],
    dependencies=[Depends(bind_tenant), Depends(require_role(*READ))],
)
async def list_members(event_id: uuid.UUID, session: DbSession) -> list[MemberRead]:
    """Who works on this event, and in what role.

    Assignment and reviewer chasing both need to name people, and until now
    nothing could: the console had no way to learn who the reviewers are.
    """
    # Mirrors resolve_role: a per-event role wins, and an org member with no
    # event row still works on every event in the org. Listing only EventMember
    # would report an empty team on an event nobody has been overridden on.
    event = await session.get(Event, event_id)
    if event is None:
        raise RoleRequiredError("You do not have access to this event.")

    with tenancy_disabled():
        org_rows = (
            (
                await session.execute(
                    select(OrgMember, User)
                    .join(User, User.id == OrgMember.user_id)
                    .where(OrgMember.org_id == event.org_id)
                )
            )
            .tuples()
            .all()
        )
        overrides = {
            member.user_id: member.role
            for member in (
                await session.scalars(select(EventMember).where(EventMember.event_id == event_id))
            ).all()
        }

    by_user = {
        user.id: MemberRead(
            user_id=user.id,
            name=user.name,
            email=user.email,
            role=overrides.get(user.id, member.role),
        )
        for member, user in org_rows
    }
    return sorted(by_user.values(), key=lambda member: member.name)


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
