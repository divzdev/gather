from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AuthenticationError, MagicLinkExpiredError
from app.core.security import (
    create_access_token,
    generate_token,
    hash_ip,
    hash_password,
    hash_token,
    password_needs_rehash,
    verify_password,
)
from app.core.tenancy import tenancy_disabled
from app.models import AuthSession, Event, MagicLink, MagicLinkPurpose, User


@dataclass(frozen=True, slots=True)
class IssuedSession:
    access_token: str
    refresh_token: str
    expires_in: int


def _now() -> datetime:
    return datetime.now(UTC)


async def _issue_session(
    session: AsyncSession, user: User, *, user_agent: str | None, ip: str | None
) -> IssuedSession:
    settings = get_settings()
    refresh_token = generate_token()
    session.add(
        AuthSession(
            user_id=user.id,
            refresh_token_hash=hash_token(refresh_token),
            expires_at=_now() + timedelta(days=settings.refresh_token_ttl_days),
            user_agent=user_agent,
            ip_hash=hash_ip(ip) if ip else None,
        )
    )
    return IssuedSession(
        access_token=create_access_token(user.id),
        refresh_token=refresh_token,
        expires_in=settings.access_token_ttl_minutes * 60,
    )


async def authenticate(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    user_agent: str | None = None,
    ip: str | None = None,
) -> IssuedSession:
    user = await session.scalar(select(User).where(User.email == email))

    # Verify even when the user is missing, against a throwaway hash, so a wrong
    # address and a wrong password take the same time. Otherwise the response
    # latency enumerates staff accounts.
    stored = user.password_hash if user else hash_password(generate_token())
    if not verify_password(password, stored) or user is None or not user.is_active:
        raise AuthenticationError("Email or password is incorrect.")

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    user.last_login_at = _now()

    return await _issue_session(session, user, user_agent=user_agent, ip=ip)


async def refresh(
    session: AsyncSession,
    *,
    refresh_token: str,
    user_agent: str | None = None,
    ip: str | None = None,
) -> IssuedSession:
    """Rotate: the presented token is revoked and a new one issued."""
    now = _now()
    record = await session.scalar(
        select(AuthSession).where(AuthSession.refresh_token_hash == hash_token(refresh_token))
    )
    if record is None or not record.is_usable(now):
        raise AuthenticationError("Your session has expired. Sign in again.")

    user = await session.get(User, record.user_id)
    if user is None or not user.is_active:
        raise AuthenticationError("This account is no longer active.")

    record.revoked_at = now
    return await _issue_session(session, user, user_agent=user_agent, ip=ip)


async def revoke(session: AsyncSession, *, refresh_token: str) -> None:
    """Logout. Idempotent: an unknown or already-revoked token is still a success."""
    record = await session.scalar(
        select(AuthSession).where(AuthSession.refresh_token_hash == hash_token(refresh_token))
    )
    if record is not None and record.revoked_at is None:
        record.revoked_at = _now()


async def issue_magic_link(
    session: AsyncSession,
    *,
    email: str,
    event_id: uuid.UUID | None,
    ip: str | None = None,
) -> str:
    """Always succeeds, even for an unknown address — the caller returns 204
    regardless so the endpoint cannot be used to enumerate speakers."""
    settings = get_settings()
    token = generate_token()

    # An unknown event must not reach the insert: the foreign key would raise and
    # turn a 204 into a 500, which tells the caller the event id was wrong. Return
    # the same shape and persist nothing instead.
    if event_id is not None:
        with tenancy_disabled():
            event = await session.get(Event, event_id)
        if event is None:
            return token

    session.add(
        MagicLink(
            email=email,
            event_id=event_id,
            token_hash=hash_token(token),
            purpose=MagicLinkPurpose.PORTAL,
            expires_at=_now() + timedelta(minutes=settings.magic_link_ttl_minutes),
            created_ip_hash=hash_ip(ip) if ip else None,
        )
    )
    return token


async def consume_magic_link(session: AsyncSession, *, token: str) -> str:
    """Single use: the row is marked consumed in the same transaction as the issue."""
    settings = get_settings()
    now = _now()
    link = await session.scalar(select(MagicLink).where(MagicLink.token_hash == hash_token(token)))
    if link is None or not link.is_usable(now):
        raise MagicLinkExpiredError("This link has expired or was already used.")
    if link.event_id is None:
        raise MagicLinkExpiredError("This link is not scoped to an event.")

    link.consumed_at = now
    return create_access_token(
        link.speaker_id or link.id,
        kind="speaker",
        expires_in=timedelta(days=settings.speaker_session_ttl_days),
        claims={"event_id": str(link.event_id), "email": link.email},
    )
