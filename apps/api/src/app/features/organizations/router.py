"""The organisation itself: its name, and who belongs to it (spec 0004).

Every org-tier route lives here, so the tier is a directory rather than a habit.
Nothing in this module touches an event, and no event route touches an
`OrgMember` row — that separation is asserted by a test, not left to review.

The distinction this module exists to make operable (CONTEXT.md, *Membership
scope*): an `OrgMember` is a baseline role on **every** event in the
organisation, including ones not created yet, plus the cross-event Directory and
the org key. An `EventMember` is an override on one event, and lives in the
events feature.

**No `tenancy_disabled()` anywhere below, and no hand-written `org_id`
predicate.** `require_org_role` runs `bind_org_tenant`, which opens
`tenant_scope(org_id)` for the whole request, so `OrgMember` and `Event` — both
`OrgScoped` — are filtered automatically on read and guarded against a
cross-tenant write on flush. An earlier draft opened the escape hatch and
re-applied the predicate by hand; a review proved the hand-written version was
the only thing standing between org A and org B's rows, and that deleting one
line of it went unnoticed by the whole suite. The session does it now, which is
the arrangement `architecture.md` asks for and the one a mutation cannot slip
past.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import func, select

from app.core.deps import CurrentUser, DbSession, get_verified_user, require_org_role
from app.core.errors import ApiError, ConflictError, NotFoundError
from app.features.auth import service as auth_service
from app.models import Event, Organization, OrgMember, Role, User

router = APIRouter(prefix="/v1/orgs/{org_id}", tags=["organizations"])

#: Who may see the organisation and manage who belongs to it. Adding someone
#: hands them the Directory and the org key; that is accepted deliberately
#: (spec 0004) to keep one authority rule rather than two, and the escalation is
#: lateral because OWNER is not grantable below.
MANAGE = (Role.OWNER, Role.ADMIN)
#: Renaming is the workspace's identity, which stays with its owner.
RENAME = (Role.OWNER,)
#: Ownership is transferred, never granted. Mirrors the event tier's GRANTABLE.
GRANTABLE = (Role.ADMIN, Role.COORDINATOR, Role.REVIEWER)


def _required_text(value: str) -> str:
    """Strip first, then require. `min_length` alone runs before the handler
    trims, so `"   "` passed validation and stored an empty workspace name — the
    console header then rendered blank, because `""` is not `None`."""
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("cannot be blank")
    return trimmed


class OrganizationRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    name: str
    #: Read-only here: the slug is an internal identifier, and renaming it would
    #: be a redirect problem for no benefit.
    slug: str
    #: What "every event" currently amounts to. The People screen phrases its
    #: removal confirm from this rather than a preflight request.
    event_count: int


class OrganizationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=1, max_length=200)]

    _clean_name = field_validator("name")(_required_text)


class OrgMemberRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    user_id: uuid.UUID
    name: str
    email: str
    role: Role
    events_covered: int


class OrgMemberAdd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=1, max_length=200)]
    email: EmailStr
    role: Role

    _clean_name = field_validator("name")(_required_text)

    def grantable_role(self) -> Role:
        if self.role not in GRANTABLE:
            raise ApiError(
                f"Cannot add someone as {self.role.value!r} — ownership is transferred, "
                "not granted.",
                code="VALIDATION_FAILED",
                status_code=422,
                field="role",
            )
        return self.role


class OrgMemberPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Role


async def _load_org(session: DbSession, org_id: uuid.UUID) -> Organization:
    org = await session.get(Organization, org_id)
    if org is None:  # pragma: no cover - the role gate already proved membership
        raise NotFoundError("No such organisation.")
    return org


async def _events_in_org(session: DbSession) -> int:
    """How many events "every event" currently means. Scoped by the session."""
    return await session.scalar(select(func.count(Event.id))) or 0


async def _organization_read(session: DbSession, org: Organization) -> OrganizationRead:
    return OrganizationRead(
        id=org.id,
        name=org.name,
        slug=org.slug,
        event_count=await _events_in_org(session),
    )


async def _member_read(session: DbSession, member: OrgMember, user: User) -> OrgMemberRead:
    return OrgMemberRead(
        user_id=user.id,
        name=user.name,
        email=user.email,
        role=member.role,
        events_covered=await _events_in_org(session),
    )


@router.get("", response_model=OrganizationRead)
async def read_organization(
    session: DbSession,
    org_id: Annotated[uuid.UUID, Path()],
    _: Role = Depends(require_org_role(*MANAGE)),
) -> OrganizationRead:
    return await _organization_read(session, await _load_org(session, org_id))


@router.patch("", response_model=OrganizationRead)
async def rename_organization(
    body: OrganizationUpdate,
    session: DbSession,
    org_id: Annotated[uuid.UUID, Path()],
    _: Role = Depends(require_org_role(*RENAME)),
) -> OrganizationRead:
    """Rename the workspace. Owner only: this is the organisation's identity,
    not one of its settings."""
    org = await _load_org(session, org_id)
    org.name = body.name
    await session.flush()
    return await _organization_read(session, org)


@router.get("/members", response_model=list[OrgMemberRead])
async def list_org_members(
    session: DbSession,
    org_id: Annotated[uuid.UUID, Path()],
    _: Role = Depends(require_org_role(*MANAGE)),
) -> list[OrgMemberRead]:
    """Who belongs to the organisation — not who works on any one event."""
    covered = await _events_in_org(session)
    rows = (
        (await session.execute(select(OrgMember, User).join(User, User.id == OrgMember.user_id)))
        .tuples()
        .all()
    )
    members = [
        OrgMemberRead(
            user_id=user.id,
            name=user.name,
            email=user.email,
            role=member.role,
            events_covered=covered,
        )
        for member, user in rows
    ]
    return sorted(members, key=lambda member: member.name)


@router.post(
    "/members",
    response_model=OrgMemberRead,
    status_code=201,
    dependencies=[Depends(get_verified_user)],
)
async def add_org_member(
    body: OrgMemberAdd,
    session: DbSession,
    actor: CurrentUser,
    org_id: Annotated[uuid.UUID, Path()],
    _: Role = Depends(require_org_role(*MANAGE)),
) -> OrgMemberRead:
    """Put someone in the organisation and email them a sign-in link.

    Verified-sender gated: this reaches another human's inbox. Any per-event
    rows they already hold survive — those are overrides, and an override of the
    same role changes nothing.
    """
    role = body.grantable_role()
    org = await _load_org(session, org_id)
    user = await auth_service.find_or_create_invitee(session, email=body.email, name=body.name)

    existing = await session.scalar(select(OrgMember).where(OrgMember.user_id == user.id))
    if existing is not None:
        raise ConflictError(
            f"{user.name} already belongs to this organisation as {existing.role.value}. "
            "Change their role instead of adding them again."
        )
    member = OrgMember(org_id=org_id, user_id=user.id, role=role)
    session.add(member)
    await session.flush()
    added = await _member_read(session, member, user)

    await auth_service.issue_invite_link(
        session, user=user, event_name=org.name, role=role.value, invited_by=actor.name
    )
    return added


async def _member_under_change(
    session: DbSession, user_id: uuid.UUID, actor: CurrentUser
) -> tuple[OrgMember, User]:
    """The row a write is about, with the two guards every write shares.

    Self-locked so nobody quietly drops their own access; owner-locked because
    registration always makes the owner a member and nothing removes them, which
    is what keeps the organisation from ever reaching zero members. The
    organisation itself is not named here — the session scope already restricts
    the query to it, so a `user_id` borrowed from another org resolves to
    nothing rather than to someone else's row.
    """
    if user_id == actor.id:
        raise ConflictError("You cannot change your own organisation membership.")
    row = (
        await session.execute(
            select(OrgMember, User)
            .join(User, User.id == OrgMember.user_id)
            .where(OrgMember.user_id == user_id)
        )
    ).first()
    if row is None:
        raise NotFoundError("They do not belong to this organisation.")
    member, user = row
    if member.role is Role.OWNER:
        raise ConflictError(
            "The owner belongs to the organisation and cannot be changed or removed here."
        )
    return member, user


@router.patch("/members/{user_id}", response_model=OrgMemberRead)
async def change_org_member_role(
    body: OrgMemberPatch,
    session: DbSession,
    actor: CurrentUser,
    org_id: Annotated[uuid.UUID, Path()],
    user_id: Annotated[uuid.UUID, Path()],
    _: Role = Depends(require_org_role(*MANAGE)),
) -> OrgMemberRead:
    if body.role not in GRANTABLE:
        raise ApiError(
            "Ownership is transferred, not granted here.",
            code="VALIDATION_FAILED",
            status_code=422,
            field="role",
        )
    member, user = await _member_under_change(session, user_id, actor)
    member.role = body.role
    await session.flush()
    return await _member_read(session, member, user)


@router.delete("/members/{user_id}", status_code=204)
async def remove_org_member(
    session: DbSession,
    actor: CurrentUser,
    org_id: Annotated[uuid.UUID, Path()],
    user_id: Annotated[uuid.UUID, Path()],
    _: Role = Depends(require_org_role(*MANAGE)),
) -> None:
    """Take someone out of the organisation.

    Deletes the org row and nothing else: any events they were individually
    added to are per-event overrides and survive. Removal is not a hidden
    mass-revocation, and someone who should lose everything is removed from
    those events too, on those events' own screen.
    """
    member, _user = await _member_under_change(session, user_id, actor)
    await session.delete(member)
    await session.flush()
