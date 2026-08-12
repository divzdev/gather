"""Request-scoped dependencies: identity, role, tenant.

Authorization is default-deny. `require_role()` with no roles raises at import
time rather than admitting everyone — a route that forgets to name its roles must
fail closed, loudly, at startup.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, Path
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.errors import AuthenticationError, EmailNotVerifiedError, RoleRequiredError
from app.core.security import decode_access_token
from app.core.tenancy import tenancy_disabled, tenant_scope
from app.models import Event, EventMember, OrgMember, Role, User

DbSession = Annotated[AsyncSession, Depends(get_db)]

_bearer = HTTPBearer(auto_error=False)
BearerCredentials = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]


@dataclass(frozen=True, slots=True)
class SpeakerContext:
    """A speaker's session. Scoped to exactly one event, never org-wide."""

    speaker_id: uuid.UUID
    event_id: uuid.UUID


def _decode(
    credentials: HTTPAuthorizationCredentials | None, expected_kind: str
) -> dict[str, object]:
    if credentials is None:
        raise AuthenticationError("Sign in to continue.")
    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.PyJWTError as exc:
        raise AuthenticationError("Your session has expired. Sign in again.") from exc
    if payload.get("typ") != expected_kind:
        # A speaker token must never open a staff route, and vice versa.
        raise AuthenticationError("This token cannot be used here.")
    return payload


async def get_current_user(credentials: BearerCredentials, session: DbSession) -> User:
    payload = _decode(credentials, "access")
    user = await session.get(User, uuid.UUID(str(payload["sub"])))
    if user is None or not user.is_active:
        raise AuthenticationError("This account is no longer active.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_verified_user(user: CurrentUser) -> User:
    """Identity, plus proof the address behind it is real.

    Applied only to the actions that leave this install — sending mail and
    publishing. Everything else stays open to an unconfirmed account on purpose:
    an organizer who has not clicked the link yet should still be able to set
    their event up, and locking them out of their own console teaches them
    nothing about what is wrong.
    """
    if not user.is_email_verified:
        raise EmailNotVerifiedError(
            "Confirm your email address before sending or publishing.",
            details={"email": user.email},
        )
    return user


#: For routes that email people or make something public. See `get_verified_user`.
VerifiedUser = Annotated[User, Depends(get_verified_user)]


async def get_current_speaker(credentials: BearerCredentials) -> SpeakerContext:
    payload = _decode(credentials, "speaker")
    event_id = payload.get("event_id")
    if event_id is None:
        raise AuthenticationError("This token is not scoped to an event.")
    return SpeakerContext(
        speaker_id=uuid.UUID(str(payload["sub"])),
        event_id=uuid.UUID(str(event_id)),
    )


CurrentSpeaker = Annotated[SpeakerContext, Depends(get_current_speaker)]


async def resolve_role(
    session: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID
) -> Role | None:
    """Per-event role wins over the org default; absent from both means no access.

    Runs unscoped on purpose: it is the query that *establishes* which tenant the
    caller belongs to, so it cannot already be filtered by one.
    """
    with tenancy_disabled():
        event = await session.get(Event, event_id)
        if event is None:
            return None

        override: Role | None = await session.scalar(
            select(EventMember.role).where(
                EventMember.event_id == event_id, EventMember.user_id == user_id
            )
        )
        if override is not None:
            return override

        org_role: Role | None = await session.scalar(
            select(OrgMember.role).where(
                OrgMember.org_id == event.org_id, OrgMember.user_id == user_id
            )
        )
        return org_role


def require_role(*allowed: Role) -> Callable[..., Awaitable[User]]:
    """Gate a route on membership. Every protected route states its roles."""
    if not allowed:
        raise ValueError("require_role() needs at least one role; empty would allow everyone")
    permitted = frozenset(allowed)

    async def dependency(
        session: DbSession,
        user: CurrentUser,
        event_id: Annotated[uuid.UUID, Path()],
    ) -> User:
        role = await resolve_role(session, user.id, event_id)
        if role is None or role not in permitted:
            raise RoleRequiredError(
                "You do not have access to this event.",
                details={"required": sorted(r.value for r in permitted)},
            )
        return user

    return dependency


async def bind_public_event(
    session: DbSession, event_slug: Annotated[str, Path()]
) -> AsyncIterator[Event]:
    """Resolve an event from its public slug and bind the tenant for the request.

    A dependency rather than an inline `with` block because the session commits
    during dependency teardown — a scope that closes when the handler returns
    would leave the flush with no tenant.
    """
    from app.core.errors import NotFoundError

    with tenancy_disabled():
        event = await session.scalar(select(Event).where(Event.slug == event_slug))
    if event is None:
        raise NotFoundError("No such event.")

    with tenant_scope(org_id=event.org_id, event_id=event.id):
        yield event
        # Flush while the scope is still open. `get_db` is entered first and so
        # tears down last, meaning its commit lands after this scope has closed —
        # anything still pending would flush with no tenant and be rejected.
        await session.flush()


PublicEvent = Annotated[Event, Depends(bind_public_event)]


async def bind_org_tenant(
    session: DbSession,
    user: CurrentUser,
    org_id: Annotated[uuid.UUID, Path()],
) -> AsyncIterator[Role]:
    """Bind an organization with no event, for reads that span all of them.

    The speaker directory is the reason this exists: a person who keynoted three
    years ago belongs to the organization, not to one conference. Leaving the
    event unset is deliberate — see `_apply_tenancy`, which only constrains
    event-scoped rows when the scope names one.
    """
    with tenancy_disabled():
        role: Role | None = await session.scalar(
            select(OrgMember.role).where(OrgMember.org_id == org_id, OrgMember.user_id == user.id)
        )
    if role is None:
        raise RoleRequiredError("You do not have access to this organisation.")

    with tenant_scope(org_id=org_id):
        yield role
        # See bind_public_event: flush before the scope closes.
        await session.flush()


OrgRole = Annotated[Role, Depends(bind_org_tenant)]


def require_org_role(*allowed: Role) -> Callable[..., Awaitable[Role]]:
    """Gate an org-level route. Mirrors require_role, which needs an event."""
    if not allowed:
        raise ValueError("require_org_role() needs at least one role; empty would allow everyone")
    permitted = frozenset(allowed)

    async def dependency(role: OrgRole) -> Role:
        if role not in permitted:
            raise RoleRequiredError(
                "You do not have access to this organisation.",
                details={"required": sorted(item.value for item in permitted)},
            )
        return role

    return dependency


async def bind_speaker_tenant(
    session: DbSession, speaker: CurrentSpeaker
) -> AsyncIterator[SpeakerContext]:
    """Bind the tenant a speaker's token names, after proving they are on that event.

    Tenancy scopes portal queries to the event; it does not scope them to the
    *person*. Every portal query still filters on `speaker_id` — this dependency
    is the outer fence, not the inner one.
    """
    from app.models import EventSpeaker

    with tenancy_disabled():
        event = await session.get(Event, speaker.event_id)
        member = await session.scalar(
            select(EventSpeaker.id).where(
                EventSpeaker.event_id == speaker.event_id,
                EventSpeaker.speaker_id == speaker.speaker_id,
            )
        )
    if event is None or member is None:
        raise AuthenticationError("This portal link is no longer valid.")

    with tenant_scope(org_id=event.org_id, event_id=event.id):
        yield speaker
        # See bind_public_event: flush before the scope closes.
        await session.flush()


PortalSpeaker = Annotated[SpeakerContext, Depends(bind_speaker_tenant)]


async def bind_tenant(
    session: DbSession,
    user: CurrentUser,
    event_id: Annotated[uuid.UUID, Path()],
) -> AsyncIterator[None]:
    """Bind the tenant for the whole request so every query is filtered.

    Depends on membership first: binding a tenant the caller is not a member of
    would scope their queries to someone else's data.
    """
    role = await resolve_role(session, user.id, event_id)
    if role is None:
        raise RoleRequiredError("You do not have access to this event.")

    with tenancy_disabled():
        event = await session.get(Event, event_id)
    if event is None:
        raise RoleRequiredError("You do not have access to this event.")

    with tenant_scope(org_id=event.org_id, event_id=event.id):
        yield
        # See bind_public_event: flush before the scope closes.
        await session.flush()
