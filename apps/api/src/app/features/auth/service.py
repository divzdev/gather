from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import mail
from app.core.config import get_settings
from app.core.errors import AuthenticationError, EmailTakenError, MagicLinkExpiredError
from app.core.security import (
    create_access_token,
    generate_token,
    hash_ip,
    hash_password,
    hash_token,
    password_needs_rehash,
    verify_password,
)
from app.core.tenancy import tenancy_disabled, tenant_scope
from app.models import (
    AuthSession,
    Event,
    EventMember,
    EventSpeaker,
    MagicLink,
    MagicLinkPurpose,
    MessagePurpose,
    Organization,
    OrgMember,
    Role,
    Speaker,
    User,
)


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


SLUG_ALLOWED = re.compile(r"[^a-z0-9]+")


def _slugify(value: str, *, fallback: str) -> str:
    slug = SLUG_ALLOWED.sub("-", value.lower()).strip("-")[:80]
    return slug or fallback


async def _unique_org_slug(session: AsyncSession, name: str) -> str:
    """Organisation slugs are unique across the whole install, so two people
    signing up with the same company name must not collide."""
    base = _slugify(name, fallback="org")
    candidate = base
    for suffix in range(2, 50):
        taken = await session.scalar(select(Organization).where(Organization.slug == candidate))
        if taken is None:
            return candidate
        candidate = f"{base}-{suffix}"
    return f"{base}-{uuid.uuid4().hex[:6]}"


async def register(
    session: AsyncSession,
    *,
    name: str,
    email: str,
    password: str,
    organisation: str,
    user_agent: str | None = None,
    ip: str | None = None,
) -> IssuedSession:
    """Create an organisation, its first owner, and a draft event to work in.

    Signing up with no event would drop the new owner into a console with
    nothing to configure, so the event is part of the same transaction.
    """
    with tenancy_disabled():
        if await session.scalar(select(User).where(User.email == email)) is not None:
            raise EmailTakenError("An account with that email already exists.")

        org = Organization(name=organisation, slug=await _unique_org_slug(session, organisation))
        session.add(org)
        await session.flush()

        user = User(email=email, name=name, password_hash=hash_password(password))
        session.add(user)
        await session.flush()

        session.add(OrgMember(org_id=org.id, user_id=user.id, role=Role.OWNER))

        today = _now().date()
        event = Event(
            org_id=org.id,
            name=f"{organisation} {today.year}",
            slug=_slugify(f"{organisation}-{today.year}", fallback=f"event-{today.year}"),
            timezone="UTC",
            starts_on=today + timedelta(days=90),
            ends_on=today + timedelta(days=92),
        )
        session.add(event)
        await session.flush()
        session.add(EventMember(org_id=org.id, event_id=event.id, user_id=user.id, role=Role.OWNER))

        issued = await _issue_session(session, user, user_agent=user_agent, ip=ip)
        # Flush before the scope closes. The request commits during dependency
        # teardown, by which point tenancy is enforced again and no tenant is
        # bound — anything still pending would be rejected there, after the
        # response has already gone out as a success.
        await session.flush()
        return issued


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
    if event_id is None:
        return token
    with tenancy_disabled():
        event = await session.get(Event, event_id)
        if event is None:
            return token
        # Resolved now rather than at consume time: the address may belong to
        # nobody, and that has to cost the caller exactly one indistinguishable
        # 204 either way.
        speaker_id = await session.scalar(
            select(EventSpeaker.speaker_id)
            .join(Speaker, Speaker.id == EventSpeaker.speaker_id)
            .where(EventSpeaker.event_id == event_id, Speaker.email == email)
        )

    session.add(
        MagicLink(
            email=email,
            speaker_id=speaker_id,
            event_id=event_id,
            token_hash=hash_token(token),
            purpose=MagicLinkPurpose.PORTAL,
            expires_at=_now() + timedelta(minutes=settings.magic_link_ttl_minutes),
            created_ip_hash=hash_ip(ip) if ip else None,
        )
    )
    if speaker_id is None:
        return token

    # The route is public and binds no tenant, but the outbox row is event-scoped.
    with tenant_scope(org_id=event.org_id, event_id=event.id):
        await mail.send_now(
            session,
            event_id=event_id,
            to_email=email,
            to_speaker_id=speaker_id,
            purpose=MessagePurpose.PORTAL_INVITE,
            subject=f"Your sign-in link for {event.name}",
            body=(
                f'<p>Open your speaker portal for {event.name}.</p><p><a href="'
                f'{settings.web_origin}/auth/verify?token={token}">Sign in</a></p>'
                f"<p>The link works once and expires in "
                f"{settings.magic_link_ttl_minutes} minutes.</p>"
            ),
        )
        await session.flush()
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

    if link.speaker_id is None:
        # The address matched nobody when the link was issued. Minting a token
        # anyway would produce a session pointing at a speaker that never existed.
        raise MagicLinkExpiredError("This link has expired or was already used.")

    link.consumed_at = now
    return create_access_token(
        link.speaker_id,
        kind="speaker",
        expires_in=timedelta(days=settings.speaker_session_ttl_days),
        claims={"event_id": str(link.event_id), "email": link.email},
    )
