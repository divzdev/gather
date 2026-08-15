from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import mail
from app.core.config import get_settings
from app.core.errors import (
    AuthenticationError,
    ConflictError,
    EmailTakenError,
    MagicLinkExpiredError,
)
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
from app.features.auth import github
from app.models import (
    AuthSession,
    Event,
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


async def _create_workspace(
    session: AsyncSession,
    *,
    name: str,
    email: str,
    password_hash: str,
    organisation: str,
    verified: bool,
    github_user_id: str | None = None,
    avatar_url: str | None = None,
) -> User:
    """An organisation and its first owner. Caller holds `tenancy_disabled()`.

    No event. Signing up used to invent one, named after the organisation and
    dated ninety days out, so a new owner's first screen described a conference
    they had never agreed to. Choosing the name and the dates is the first real
    decision of running an event, and it belongs to onboarding, not to a
    side effect of creating an account.
    """
    # Optional at signup: plenty of organisers run one event and have no
    # organisation to speak of, and demanding one is a question they cannot
    # answer yet. It is editable in Settings afterwards.
    org_name = (organisation or "").strip() or f"{name}'s workspace"
    org = Organization(name=org_name, slug=await _unique_org_slug(session, org_name))
    session.add(org)
    await session.flush()

    user = User(
        email=email,
        name=name,
        password_hash=password_hash,
        github_user_id=github_user_id,
        avatar_url=avatar_url,
        email_verified_at=_now() if verified else None,
    )
    session.add(user)
    await session.flush()

    session.add(OrgMember(org_id=org.id, user_id=user.id, role=Role.OWNER))
    await session.flush()
    return user


async def register(
    session: AsyncSession,
    *,
    name: str,
    email: str,
    password: str,
    organisation: str,
    user_agent: str | None = None,
    ip: str | None = None,
) -> tuple[IssuedSession, bool]:
    """Create an account, and mail it a link proving the address is real.

    The new account can sign in immediately and is *not* verified. Both halves of
    that are deliberate. Blocking sign-in until the link is clicked means a
    signup whose mail is slow, filtered or — on a build where mail writes to disk
    — unreachable, is a dead end with nothing on screen to do about it. Leaving
    the account unverified means it still cannot mail anyone or publish anything,
    which is the only part of a throwaway signup that costs anyone else.

    Returns the session and whether the address is already confirmed, so the
    caller can tell the new owner which of the two states they are in.
    """
    settings = get_settings()
    # A demo build already hands out password-free sessions for the seeded
    # accounts, so there is nothing for verification to protect here, and an
    # evaluator with no inbox must not be parked in front of a link they cannot
    # reach. On any real deployment this is false and the link is the only way.
    verified = settings.demo_logins_allowed

    with tenancy_disabled():
        if await session.scalar(select(User).where(User.email == email)) is not None:
            raise EmailTakenError("An account with that email already exists.")

        user = await _create_workspace(
            session,
            name=name,
            email=email,
            password_hash=hash_password(password),
            organisation=organisation,
            verified=verified,
        )
        issued = await _issue_session(session, user, user_agent=user_agent, ip=ip)
        # Flush before the scope closes. The request commits during dependency
        # teardown, by which point tenancy is enforced again and no tenant is
        # bound — anything still pending would be rejected there, after the
        # response has already gone out as a success.
        await session.flush()

    if not verified:
        await _send_staff_link(
            session,
            user=user,
            subject="Confirm your email address",
            lead=(
                f"<p>Welcome to Gather, {name}. Confirm this address to finish "
                f"setting up your account. The link signs you in as well.</p>"
            ),
            ip=ip,
        )
    return issued, verified


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


async def find_or_create_invitee(session: AsyncSession, *, email: str, name: str) -> User:
    """The account an invite is about, created if this is their first one.

    A staff account someone else created never has a password: the column is NOT
    NULL and holds the hash of a value nobody has seen, so password sign-in fails
    closed and the emailed link is the only door. Same pattern as GitHub accounts.

    Shared by both membership tiers — Settings → Team writes an `EventMember`
    afterwards, Organisation → People an `OrgMember` — because *how a staff
    account is minted* is one rule, and the tiers differ only in the row they
    write next. Never filtered by tenant: the person may already exist under
    another organisation, and refusing to see them would mint a duplicate.
    """
    user = await session.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email, name=name, password_hash=hash_password(generate_token()))
        session.add(user)
        await session.flush()
        return user
    if not user.is_active:
        raise ConflictError(f"The account for {email} has been deactivated.")
    return user


async def issue_invite_link(
    session: AsyncSession, *, user: User, event_name: str, role: str, invited_by: str
) -> str:
    """Mail a newly added team member a link that signs them in.

    The invite *is* the sign-in: the invited account has no password (the column
    holds a hash nobody has seen), so the emailed link is the only door — the
    same rule speakers live under, applied to staff someone else created.
    """
    return await _send_staff_link(
        session,
        user=user,
        subject=f"{invited_by} added you to {event_name} on Gather",
        lead=(
            f"<p>{invited_by} added you to <strong>{event_name}</strong> as a "
            f"{role}. This link signs you in — no password needed.</p>"
        ),
    )


async def _send_staff_link(
    session: AsyncSession, *, user: User, subject: str, lead: str, ip: str | None = None
) -> str:
    """Mail a staff user a single-use link that signs them in.

    Account mail, not conference mail: it belongs to no event, so it goes out
    through `send_account_mail` and never appears in an organizer's outbox.
    """
    settings = get_settings()
    token = generate_token()
    with tenancy_disabled():
        session.add(
            MagicLink(
                email=user.email,
                user_id=user.id,
                token_hash=hash_token(token),
                purpose=MagicLinkPurpose.STAFF_LOGIN,
                expires_at=_now() + timedelta(minutes=settings.magic_link_ttl_minutes),
                created_ip_hash=hash_ip(ip) if ip else None,
            )
        )
        await session.flush()

    await mail.send_account_mail(
        to_email=user.email,
        subject=subject,
        body=(
            f"{lead}"
            f'<p><a href="{settings.web_origin}/auth/verify?token={token}">'
            f"Sign in to Gather</a></p>"
            f"<p>The link works once and expires in "
            f"{settings.magic_link_ttl_minutes} minutes. "
            f"If you did not ask for it, ignore this email.</p>"
        ),
    )
    return token


async def issue_magic_link(
    session: AsyncSession,
    *,
    email: str,
    event_id: uuid.UUID | None,
    ip: str | None = None,
) -> str:
    """Always succeeds, even for an unknown address — the caller returns 204
    regardless so the endpoint cannot be used to enumerate anyone.

    Staff first: a console account and a speaker record can share an address, and
    somebody who has lost their password is asking about the console. Speakers
    reach this from the portal, where an `event_id` is always in hand, and staff
    never send one — so the two cases are told apart by what the caller knows,
    not by asking the person which kind of user they are.
    """
    settings = get_settings()
    token = generate_token()

    with tenancy_disabled():
        user = await session.scalar(select(User).where(User.email == email))
    if user is not None and user.is_active:
        return await _send_staff_link(
            session,
            user=user,
            subject="Your sign-in link for Gather",
            lead="<p>Here is the link you asked for.</p>",
            ip=ip,
        )

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


@dataclass(frozen=True, slots=True)
class ConsumedLink:
    """What a spent link produced. `refresh_token` is set for staff only —
    a speaker session is a single long-lived token with nothing to rotate."""

    kind: Literal["staff", "speaker"]
    access_token: str
    expires_in: int
    refresh_token: str | None = None


async def consume_magic_link(
    session: AsyncSession, *, token: str, user_agent: str | None = None, ip: str | None = None
) -> ConsumedLink:
    """Single use: the row is marked consumed in the same transaction as the issue."""
    settings = get_settings()
    now = _now()
    with tenancy_disabled():
        link = await session.scalar(
            select(MagicLink).where(MagicLink.token_hash == hash_token(token))
        )
    if link is None or not link.is_usable(now):
        raise MagicLinkExpiredError("This link has expired or was already used.")

    if link.purpose is MagicLinkPurpose.STAFF_LOGIN:
        link.consumed_at = now
        return await _consume_staff_link(session, link, now=now, user_agent=user_agent, ip=ip)

    if link.event_id is None:
        raise MagicLinkExpiredError("This link is not scoped to an event.")

    if link.speaker_id is None:
        # The address matched nobody when the link was issued. Minting a token
        # anyway would produce a session pointing at a speaker that never existed.
        raise MagicLinkExpiredError("This link has expired or was already used.")

    link.consumed_at = now
    return ConsumedLink(
        kind="speaker",
        access_token=create_access_token(
            link.speaker_id,
            kind="speaker",
            expires_in=timedelta(days=settings.speaker_session_ttl_days),
            claims={"event_id": str(link.event_id), "email": link.email},
        ),
        expires_in=settings.speaker_session_ttl_days * 24 * 60 * 60,
    )


def speaker_session_token(*, speaker_id: uuid.UUID, event_id: uuid.UUID) -> str:
    """A speaker session bound to one event.

    Only `sub` and `event_id` are ever read back out (`core/deps.py`), so those
    are the only claims here — the address that appears alongside them on the
    magic-link path is decorative.
    """
    settings = get_settings()
    return create_access_token(
        speaker_id,
        kind="speaker",
        expires_in=timedelta(days=settings.speaker_session_ttl_days),
        claims={"event_id": str(event_id)},
    )


async def rotate_portal_link(
    session: AsyncSession, *, speaker_id: uuid.UUID, event_id: uuid.UUID
) -> str:
    """Mint the speaker's durable link for one event, replacing any earlier one.

    Deliberately reusable, unlike a magic link: this is the "keep this link"
    convenience for a speaker who visits three times on a phone, one link per
    event they speak at. Rotation is the whole revocation story — only the
    newest hash is kept, so asking for a link is also how you kill a leaked
    one. It buys portal access only; a console session can never come out of it.
    """
    row = await session.scalar(
        select(EventSpeaker).where(
            EventSpeaker.speaker_id == speaker_id, EventSpeaker.event_id == event_id
        )
    )
    if row is None:
        raise AuthenticationError("You are not on this event's roster.")
    token = generate_token()
    row.portal_link_hash = hash_token(token)
    await session.flush()
    return token


async def consume_portal_link(session: AsyncSession, *, token: str) -> ConsumedLink:
    """A durable link resolves to a speaker session, as often as it is visited.

    The lookup is by hash, the same at-rest rule every other token follows.
    Failure says nothing about why: an unknown token and a rotated one get the
    same answer, so the link is not an oracle for what exists.
    """
    settings = get_settings()
    with tenancy_disabled():
        found = (
            await session.execute(
                select(EventSpeaker.speaker_id, EventSpeaker.event_id, Speaker.email)
                .join(Speaker, Speaker.id == EventSpeaker.speaker_id)
                .where(EventSpeaker.portal_link_hash == hash_token(token))
            )
        ).first()
    if found is None:
        raise MagicLinkExpiredError("This link is no longer valid. Ask for a fresh one.")

    speaker_id, event_id, email = found
    return ConsumedLink(
        kind="speaker",
        access_token=create_access_token(
            speaker_id,
            kind="speaker",
            expires_in=timedelta(days=settings.speaker_session_ttl_days),
            claims={"event_id": str(event_id), "email": email},
        ),
        expires_in=settings.speaker_session_ttl_days * 24 * 60 * 60,
    )


async def _consume_staff_link(
    session: AsyncSession,
    link: MagicLink,
    *,
    now: datetime,
    user_agent: str | None,
    ip: str | None,
) -> ConsumedLink:
    """Sign in, and confirm the address on the way through.

    Clicking a link in an inbox proves exactly one thing, and it is the same
    thing a separate "verify your email" step would prove. Doing both from one
    link is why this build has no confirmation screen that only says "thanks".
    """
    if link.user_id is None:  # pragma: no cover - only reachable via hand-written rows
        raise MagicLinkExpiredError("This link has expired or was already used.")

    with tenancy_disabled():
        user = await session.get(User, link.user_id)
    if user is None or not user.is_active:
        raise MagicLinkExpiredError("This account is no longer active.")

    if user.email_verified_at is None:
        user.email_verified_at = now
    user.last_login_at = now
    issued = await _issue_session(session, user, user_agent=user_agent, ip=ip)
    return ConsumedLink(
        kind="staff",
        access_token=issued.access_token,
        expires_in=issued.expires_in,
        refresh_token=issued.refresh_token,
    )


async def sign_in_with_github(
    session: AsyncSession,
    identity: github.GitHubIdentity,
    *,
    user_agent: str | None = None,
    ip: str | None = None,
) -> IssuedSession:
    """Find or create the account behind a GitHub identity.

    Matched on the provider id first and the address second. The id is the stable
    one — a GitHub login can be renamed and its primary email changed — but an
    existing password account signing in with GitHub for the first time has no id
    on file yet, and must land on the account they already have rather than a
    duplicate workspace beside it.
    """
    with tenancy_disabled():
        user = await session.scalar(select(User).where(User.github_user_id == identity.provider_id))
        if user is None:
            user = await session.scalar(select(User).where(User.email == identity.email))

        if user is None:
            user = await _create_workspace(
                session,
                name=identity.name,
                email=identity.email,
                # No password is ever set on a GitHub account, and the column is
                # NOT NULL, so it holds the hash of a value nobody has seen. That
                # is what makes password sign-in fail closed here: `authenticate`
                # runs the same comparison it always does and it cannot match.
                password_hash=hash_password(generate_token()),
                organisation="",
                verified=True,
                github_user_id=identity.provider_id,
                avatar_url=identity.avatar_url,
            )
        else:
            if not user.is_active:
                raise AuthenticationError("This account is no longer active.")
            # GitHub only hands back verified addresses, so arriving here is
            # itself the proof an emailed link would have been asking for.
            user.github_user_id = identity.provider_id
            if user.email_verified_at is None:
                user.email_verified_at = _now()
            if user.avatar_url is None:
                user.avatar_url = identity.avatar_url

        user.last_login_at = _now()
        issued = await _issue_session(session, user, user_agent=user_agent, ip=ip)
        await session.flush()
        return issued


#: The seeded demo identities, by the role an evaluator would ask for. Kept here
#: rather than imported from `seed` so the endpoint does not depend on the demo
#: data module being importable in every deployment.
DEMO_ACCOUNTS: dict[str, tuple[str, str]] = {
    "organizer": ("sbek-organizer@example.com", "Jordan Alvarez, owner"),
    "reviewer": ("sbek-reviewer@example.com", "Sam Whitfield, reviewer"),
    "speaker": ("sbek-speaker@example.com", "Priya Raman, speaker"),
}


async def demo_staff_session(
    session: AsyncSession, *, email: str, user_agent: str | None = None, ip: str | None = None
) -> IssuedSession:
    """Sign in a seeded staff account without its password.

    The caller has already checked `demo_logins_allowed`; this refuses anything
    that is not one of the known demo addresses so the route can never become a
    password-free login for a real account.
    """
    if email not in {address for address, _label in DEMO_ACCOUNTS.values()}:
        raise AuthenticationError("That is not a demo account.")

    with tenancy_disabled():
        user = await session.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active:
        raise AuthenticationError("The demo data has not been seeded yet. Run `make seed`.")

    user.last_login_at = _now()
    return await _issue_session(session, user, user_agent=user_agent, ip=ip)


async def demo_speaker_token(session: AsyncSession, *, email: str) -> tuple[str, uuid.UUID]:
    """A portal session for a seeded speaker, skipping the emailed link.

    Returns the token and the event it is scoped to. Same claims a consumed magic
    link produces, so the portal cannot tell the difference.
    """
    settings = get_settings()
    if email != DEMO_ACCOUNTS["speaker"][0]:
        raise AuthenticationError("That is not a demo account.")

    with tenancy_disabled():
        found = (
            await session.execute(
                select(EventSpeaker.speaker_id, EventSpeaker.event_id)
                .join(Speaker, Speaker.id == EventSpeaker.speaker_id)
                .where(Speaker.email == email)
                .order_by(EventSpeaker.created_at.desc())
            )
        ).first()
    if found is None:
        raise AuthenticationError("The demo data has not been seeded yet. Run `make seed`.")

    speaker_id, event_id = found
    return (
        create_access_token(
            speaker_id,
            kind="speaker",
            expires_in=timedelta(days=settings.speaker_session_ttl_days),
            claims={"event_id": str(event_id), "email": email},
        ),
        event_id,
    )
