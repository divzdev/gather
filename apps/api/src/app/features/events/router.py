"""Events the signed-in user belongs to.

Deliberately unscoped by tenant: this is the query that tells the console which
tenants exist for this caller, so it cannot already be filtered by one.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
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
    #: The floor for every date field the console offers. A deadline before the
    #: event existed is a mistyped year, and the picker can only grey those out
    #: if it knows when that was.
    created_at: datetime
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
    #: Membership scope (CONTEXT.md): "org" is an OrgMember row — a baseline
    #: role on every event including ones not created yet — and "event" is an
    #: EventMember row overriding it here. The list has always contained both;
    #: until now it never said which. Required rather than defaulted: every
    #: construction site knows which row it just read or wrote, and a default
    #: would let a future one be silently wrong.
    scope: Literal["org", "event"]


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
    # Mirrors resolve_role: a per-event role wins, an org member with no event
    # row still works on every event in the org, and someone invited to just
    # this event exists *only* as an EventMember — all three must be listed, or
    # an invited evaluator has access the team screen cannot see.
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
        event_rows = (
            (
                await session.execute(
                    select(EventMember, User)
                    .join(User, User.id == EventMember.user_id)
                    .where(EventMember.event_id == event_id)
                )
            )
            .tuples()
            .all()
        )

    by_user = {
        user.id: MemberRead(
            user_id=user.id,
            name=user.name,
            email=user.email,
            role=member.role,
            scope="org",
        )
        for member, user in org_rows
    }
    # An event row overrides the org row for both the role and the scope: the
    # person works here on these terms and nowhere else on them.
    for member, user in event_rows:
        by_user[user.id] = MemberRead(
            user_id=user.id,
            name=user.name,
            email=user.email,
            role=member.role,
            scope="event",
        )
    return sorted(by_user.values(), key=lambda member: member.name)


class EventCreate(BaseModel):
    """A new event in the caller's organisation.

    Nothing could create one until now: an event only ever came into being as a
    side effect of registering, named after the organisation and given dates
    ninety days out that nobody chose. So an organiser could neither run a
    second event nor correct the first one's premise.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    starts_on: date
    ends_on: date
    timezone: str = Field(default="UTC", min_length=1, max_length=64)
    location: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=2000)
    #: The public address. Derived from the name when absent, because most
    #: organisers do not want to think about it and the ones who do, do.
    slug: str | None = Field(default=None, min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")
    #: Optional at creation, and the first deadline that matters after it.
    cfp_closes_at: datetime | None = None

    @field_validator("timezone")
    @classmethod
    def _known_zone(cls, value: str) -> str:
        """A real IANA zone, because everything downstream computes with it.

        The agenda's grid and every published time are derived from this; an
        unknown string would have been stored happily and failed much later,
        somewhere that looks unrelated.
        """
        try:
            ZoneInfo(value)
        except Exception as unknown:
            raise ValueError(f"{value!r} is not a known timezone.") from unknown
        return value

    @model_validator(mode="after")
    def _sane_dates(self) -> EventCreate:
        # Today in the event's own zone, not the server's: an organiser in
        # California creating a conference for today at 09:00 local is not
        # scheduling the past, though UTC has already turned over.
        #
        # Creation only. An event that has already happened has dates behind it
        # by definition, so the same rule on edit would make a past event
        # impossible to correct.
        today = datetime.now(ZoneInfo(self.timezone)).date()
        if self.starts_on < today:
            raise ValueError("An event cannot start in the past.")
        if self.ends_on < self.starts_on:
            raise ValueError("The event cannot end before it starts.")
        if self.cfp_closes_at is not None:
            closes = self.cfp_closes_at.date()
            if closes > self.ends_on:
                raise ValueError("The call for papers cannot close after the event ends.")
        return self


@router.post("", response_model=EventDetail, status_code=201)
async def create_event(body: EventCreate, user: CurrentUser, session: DbSession) -> Event:
    """Create an event and make the caller its owner.

    Outside tenancy on purpose: there is no event in scope yet, which is the
    whole point. The organisation comes from the caller's membership rather
    than the request, so this cannot be used to write into someone else's org.
    """
    with tenancy_disabled():
        org_id = await session.scalar(
            select(OrgMember.org_id).where(OrgMember.user_id == user.id).limit(1)
        )
        if org_id is None:
            raise RoleRequiredError("You do not belong to an organisation yet.")

        event = Event(
            org_id=org_id,
            name=body.name,
            slug=await _unique_event_slug(session, body.slug or body.name),
            timezone=body.timezone,
            location=body.location,
            description=body.description,
            starts_on=body.starts_on,
            ends_on=body.ends_on,
            cfp_closes_at=body.cfp_closes_at,
            status=EventStatus.DRAFT,
        )
        session.add(event)
        await session.flush()
        session.add(EventMember(org_id=org_id, event_id=event.id, user_id=user.id, role=Role.OWNER))
        await session.flush()
    return event


async def _unique_event_slug(session: DbSession, name: str) -> str:
    """The slug is the public address, so a collision would make one event's
    programme unreachable rather than merely ugly."""
    import re

    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60] or "event"
    taken = set(
        (await session.execute(select(Event.slug).where(Event.slug.like(f"{base}%")))).scalars()
    )
    if base not in taken:
        return base
    return next(f"{base}-{n}" for n in range(2, 500) if f"{base}-{n}" not in taken)


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
