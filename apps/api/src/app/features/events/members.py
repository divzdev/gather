"""Managing who works on an event.

The console calls these people evaluators when they review and team otherwise;
the model calls all of them members. Adding one creates the account if the
address is new — passwordless, signed in by the emailed link, exactly like a
speaker — so "add an evaluator" is one action, not a registration ceremony.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession, bind_tenant, get_verified_user, require_role
from app.core.errors import ApiError, ConflictError, RoleRequiredError
from app.core.security import generate_token, hash_password
from app.core.tenancy import tenancy_disabled
from app.features.auth import service as auth_service
from app.features.events.router import MemberRead
from app.models import Event, EventMember, OrgMember, Role, User

router = APIRouter(prefix="/v1/events", tags=["events"])

WRITE = (Role.OWNER, Role.ADMIN)

#: What an invite can grant. Ownership is not grantable here: an owner is the
#: person the workspace answers to, and that changes hands deliberately in
#: settings, not as a side effect of typing the wrong role into an invite.
GRANTABLE = (Role.ADMIN, Role.COORDINATOR, Role.REVIEWER)


class MemberAdd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    role: Role

    def grantable_role(self) -> Role:
        if self.role not in GRANTABLE:
            raise ApiError(
                f"Cannot add someone as {self.role.value!r} — ownership is transferred "
                "from settings, not granted by invite.",
                code="VALIDATION_FAILED",
                status_code=422,
                field="role",
            )
        return self.role


class MemberPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Role


async def _event_or_403(session: DbSession, event_id: uuid.UUID) -> Event:
    event = await session.get(Event, event_id)
    if event is None:
        raise RoleRequiredError("You do not have access to this event.")
    return event


@router.post(
    "/{event_id}/members",
    response_model=MemberRead,
    status_code=201,
    dependencies=[Depends(bind_tenant), Depends(require_role(*WRITE)), Depends(get_verified_user)],
)
async def add_member(
    event_id: uuid.UUID, body: MemberAdd, actor: CurrentUser, session: DbSession
) -> MemberRead:
    """Put someone on this event's team and email them a sign-in link.

    Verified-sender gated: this reaches another human's inbox.
    """
    role = body.grantable_role()
    event = await _event_or_403(session, event_id)

    with tenancy_disabled():
        user = await session.scalar(select(User).where(User.email == body.email))
        if user is None:
            user = User(
                email=body.email,
                name=body.name,
                # NOT NULL, and no password is ever set: the hash of a value
                # nobody has seen, so password sign-in fails closed and the
                # magic link is the only way in. Same pattern as GitHub accounts.
                password_hash=hash_password(generate_token()),
            )
            session.add(user)
            await session.flush()
        elif not user.is_active:
            raise ConflictError(f"The account for {body.email} has been deactivated.")

        existing = await session.scalar(
            select(EventMember).where(
                EventMember.event_id == event_id, EventMember.user_id == user.id
            )
        )
        if existing is not None:
            raise ConflictError(f"{user.name} is already on this event as {existing.role.value}.")
        org_role = await session.scalar(
            select(OrgMember.role).where(
                OrgMember.org_id == event.org_id, OrgMember.user_id == user.id
            )
        )
        if org_role is not None:
            raise ConflictError(
                f"{user.name} already works on every event here as {org_role.value}. "
                "Change their role instead of adding them again."
            )

        session.add(EventMember(org_id=event.org_id, event_id=event_id, user_id=user.id, role=role))
        await session.flush()

    await auth_service.issue_invite_link(
        session, user=user, event_name=event.name, role=role.value, invited_by=actor.name
    )
    return MemberRead(user_id=user.id, name=user.name, email=user.email, role=role)


@router.patch(
    "/{event_id}/members/{user_id}",
    response_model=MemberRead,
    dependencies=[Depends(bind_tenant), Depends(require_role(*WRITE))],
)
async def change_member_role(
    event_id: uuid.UUID,
    user_id: uuid.UUID,
    body: MemberPatch,
    actor: CurrentUser,
    session: DbSession,
) -> MemberRead:
    """Set someone's role on this event (a per-event override of any org role)."""
    if body.role not in GRANTABLE:
        raise ApiError(
            "Ownership is transferred from settings, not granted here.",
            code="VALIDATION_FAILED",
            status_code=422,
            field="role",
        )
    if user_id == actor.id:
        # The lock-out guard: the last admin demoting themselves to reviewer
        # leaves an event nobody can administer.
        raise ConflictError("You cannot change your own role.")

    event = await _event_or_403(session, event_id)
    with tenancy_disabled():
        user = await session.get(User, user_id)
        if user is None:
            raise ApiError("No such person.", code="NOT_FOUND", status_code=404)
        current = await _resolved_role(session, event, user_id)
        if current is None:
            raise ApiError("They are not on this event.", code="NOT_FOUND", status_code=404)
        if current == Role.OWNER:
            raise ConflictError("The owner's role cannot be changed from here.")

        membership = await session.scalar(
            select(EventMember).where(
                EventMember.event_id == event_id, EventMember.user_id == user_id
            )
        )
        if membership is None:
            session.add(
                EventMember(org_id=event.org_id, event_id=event_id, user_id=user_id, role=body.role)
            )
        else:
            membership.role = body.role
        await session.flush()
    return MemberRead(user_id=user.id, name=user.name, email=user.email, role=body.role)


@router.delete(
    "/{event_id}/members/{user_id}",
    status_code=204,
    dependencies=[Depends(bind_tenant), Depends(require_role(*WRITE))],
)
async def remove_member(
    event_id: uuid.UUID, user_id: uuid.UUID, actor: CurrentUser, session: DbSession
) -> None:
    """Take someone off this event. Their account survives; their access here ends."""
    if user_id == actor.id:
        raise ConflictError("You cannot remove yourself from the event.")

    event = await _event_or_403(session, event_id)
    with tenancy_disabled():
        membership = await session.scalar(
            select(EventMember).where(
                EventMember.event_id == event_id, EventMember.user_id == user_id
            )
        )
        if membership is not None and membership.role == Role.OWNER:
            raise ConflictError("The owner cannot be removed from their own event.")
        if membership is not None:
            await session.delete(membership)
            await session.flush()
            return

        org_role = await session.scalar(
            select(OrgMember.role).where(
                OrgMember.org_id == event.org_id, OrgMember.user_id == user_id
            )
        )
        if org_role is None:
            raise ApiError("They are not on this event.", code="NOT_FOUND", status_code=404)
        raise ConflictError(
            "They belong to the whole organisation, not just this event, "
            "so they cannot be removed from one event alone."
        )


async def _resolved_role(session: DbSession, event: Event, user_id: uuid.UUID) -> Role | None:
    override = await session.scalar(
        select(EventMember.role).where(
            EventMember.event_id == event.id, EventMember.user_id == user_id
        )
    )
    if override is not None:
        return override
    org_role: Role | None = await session.scalar(
        select(OrgMember.role).where(OrgMember.org_id == event.org_id, OrgMember.user_id == user_id)
    )
    return org_role
