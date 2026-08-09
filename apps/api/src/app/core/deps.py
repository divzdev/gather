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
from app.core.errors import AuthenticationError, RoleRequiredError
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
