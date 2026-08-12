"""The three ways into the console, and what an unconfirmed account may do.

Password sign-in is covered in test_auth_api.py. This file is about what was
added beside it: staff magic links, GitHub, and the rule that an account which
has never proved its address cannot mail anybody or publish anything.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password
from app.core.tenancy import tenancy_disabled
from app.features.auth import github, service
from app.models import (
    Event,
    EventSpeaker,
    EventStatus,
    MagicLink,
    MagicLinkPurpose,
    Organization,
    OrgMember,
    Role,
    Speaker,
    User,
)

PASSWORD = "correct horse battery staple"


async def _owner(
    session: AsyncSession, *, verified: bool, email: str | None = None
) -> tuple[User, Event]:
    """An organisation, one event, and an owner of it."""
    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        org = Organization(name=f"Org {suffix}", slug=f"org-{suffix}")
        session.add(org)
        await session.flush()

        event = Event(
            org_id=org.id,
            name=f"Conf {suffix}",
            slug=f"conf-{suffix}",
            timezone="America/Los_Angeles",
            starts_on=date(2027, 5, 12),
            ends_on=date(2027, 5, 14),
            status=EventStatus.SCHEDULED,
        )
        user = User(
            email=email or f"owner-{suffix}@example.com",
            name="Ada Owner",
            password_hash=hash_password(PASSWORD),
            email_verified_at=datetime.now(UTC) if verified else None,
        )
        session.add_all([event, user])
        await session.flush()
        session.add(OrgMember(org_id=org.id, user_id=user.id, role=Role.OWNER))
        await session.commit()
    return user, event


async def _sign_in(client: AsyncClient, user: User) -> dict[str, str]:
    response = await client.post("/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def _link_for(session: AsyncSession, email: str) -> MagicLink:
    with tenancy_disabled():
        link = await session.scalar(
            select(MagicLink).where(MagicLink.email == email).order_by(MagicLink.created_at.desc())
        )
    assert link is not None, f"no magic link was written for {email}"
    return link


# --------------------------------------------------------------------------
# Staff magic links
# --------------------------------------------------------------------------


async def test_a_staff_address_gets_a_link_that_opens_the_console(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Previously this endpoint only ever produced speaker links, so a locked-out
    organiser was told mail was on its way and handed a token the console
    refuses."""
    user, _event = await _owner(session, verified=True)

    asked = await client.post("/v1/auth/magic-link", json={"email": user.email})
    assert asked.status_code == 204

    link = await _link_for(session, user.email)
    assert link.purpose is MagicLinkPurpose.STAFF_LOGIN
    assert link.user_id == user.id


async def test_consuming_a_staff_link_signs_in_and_says_which_door_it_opened(
    client: AsyncClient, session: AsyncSession
) -> None:
    user, _event = await _owner(session, verified=True)
    raw = await service.issue_magic_link(session, email=user.email, event_id=None)
    await session.commit()

    consumed = await client.post("/v1/auth/magic-link/consume", json={"token": raw})

    assert consumed.status_code == 200, consumed.text
    assert consumed.json()["kind"] == "staff"
    # A console session is expected to outlive one access token, so the link
    # hands back the same rotating cookie every other staff sign-in sets.
    assert "gather_refresh" in consumed.cookies

    me = await client.get(
        "/v1/auth/me",
        headers={"Authorization": f"Bearer {consumed.json()['access_token']}"},
    )
    assert me.status_code == 200
    assert me.json()["email"] == user.email


async def test_a_staff_link_is_single_use(client: AsyncClient, session: AsyncSession) -> None:
    user, _event = await _owner(session, verified=True)
    raw = await service.issue_magic_link(session, email=user.email, event_id=None)
    await session.commit()

    first = await client.post("/v1/auth/magic-link/consume", json={"token": raw})
    second = await client.post("/v1/auth/magic-link/consume", json={"token": raw})

    assert first.status_code == 200
    assert second.status_code == 400
    assert second.json()["error"]["code"] == "MAGIC_LINK_EXPIRED"


async def test_an_expired_staff_link_is_refused(client: AsyncClient, session: AsyncSession) -> None:
    user, _event = await _owner(session, verified=True)
    raw = await service.issue_magic_link(session, email=user.email, event_id=None)
    link = await _link_for(session, user.email)
    with tenancy_disabled():
        link.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()

    consumed = await client.post("/v1/auth/magic-link/consume", json={"token": raw})

    assert consumed.status_code == 400
    assert consumed.json()["error"]["code"] == "MAGIC_LINK_EXPIRED"


async def test_a_staff_account_wins_over_a_speaker_with_the_same_address(
    client: AsyncClient, session: AsyncSession
) -> None:
    """One person can be both. Someone who has lost their password is asking
    about the console, so the console link is the one that gets sent."""
    shared = f"both-{uuid.uuid4().hex[:8]}@example.com"
    _user, event = await _owner(session, verified=True, email=shared)
    with tenancy_disabled():
        speaker = Speaker(org_id=event.org_id, name="Ada Owner", email=shared)
        session.add(speaker)
        await session.flush()
        session.add(EventSpeaker(org_id=event.org_id, event_id=event.id, speaker_id=speaker.id))
        await session.commit()

    await client.post("/v1/auth/magic-link", json={"email": shared, "event_id": str(event.id)})

    link = await _link_for(session, shared)
    assert link.purpose is MagicLinkPurpose.STAFF_LOGIN
    assert link.speaker_id is None


async def test_a_speaker_link_still_opens_the_portal(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Regression guard on the branch above: putting staff first must not have
    taken the speaker path with it."""
    suffix = uuid.uuid4().hex[:8]
    email = f"speaker-{suffix}@example.com"
    _user, event = await _owner(session, verified=True)
    with tenancy_disabled():
        speaker = Speaker(org_id=event.org_id, name="Priya Raman", email=email)
        session.add(speaker)
        await session.flush()
        session.add(EventSpeaker(org_id=event.org_id, event_id=event.id, speaker_id=speaker.id))
        await session.commit()
        raw = await service.issue_magic_link(session, email=email, event_id=event.id)
        await session.commit()

    consumed = await client.post("/v1/auth/magic-link/consume", json={"token": raw})

    assert consumed.status_code == 200, consumed.text
    assert consumed.json()["kind"] == "speaker"
    assert "gather_refresh" not in consumed.cookies


# --------------------------------------------------------------------------
# Confirming the address
# --------------------------------------------------------------------------


async def test_an_unconfirmed_owner_cannot_publish(
    client: AsyncClient, session: AsyncSession
) -> None:
    user, event = await _owner(session, verified=False)
    headers = await _sign_in(client, user)

    refused = await client.post(
        f"/v1/events/{event.id}/schedule/publish",
        json={"acknowledge_conflicts": True},
        headers=headers,
    )

    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"


async def test_an_unconfirmed_owner_can_still_use_the_rest_of_the_console(
    client: AsyncClient, session: AsyncSession
) -> None:
    """The gate is deliberately narrow. Locking someone out of their own console
    because a confirmation mail is slow teaches them nothing about what is
    wrong, and setting an event up harms nobody."""
    user, event = await _owner(session, verified=False)
    headers = await _sign_in(client, user)

    me = await client.get("/v1/auth/me", headers=headers)
    rooms = await client.post(
        f"/v1/events/{event.id}/rooms", json={"name": "Main Stage"}, headers=headers
    )

    assert me.status_code == 200
    assert me.json()["email_verified"] is False
    assert rooms.status_code in {200, 201}, rooms.text


async def test_clicking_the_link_confirms_the_address_and_unlocks_publishing(
    client: AsyncClient, session: AsyncSession
) -> None:
    """One link does both jobs. Clicking something in an inbox proves exactly
    what a separate confirm step would prove, so this build has no screen whose
    only content is the word "thanks"."""
    user, event = await _owner(session, verified=False)
    raw = await service.issue_magic_link(session, email=user.email, event_id=None)
    await session.commit()

    consumed = await client.post("/v1/auth/magic-link/consume", json={"token": raw})
    headers = {"Authorization": f"Bearer {consumed.json()['access_token']}"}
    published = await client.post(
        f"/v1/events/{event.id}/schedule/publish",
        json={"acknowledge_conflicts": True},
        headers=headers,
    )

    assert consumed.status_code == 200
    assert published.status_code == 201, published.text

    me = await client.get("/v1/auth/me", headers=headers)
    assert me.json()["email_verified"] is True


async def test_registration_on_a_real_deployment_is_unconfirmed_and_mails_a_link(
    client: AsyncClient, session: AsyncSession
) -> None:
    settings = get_settings()
    original = settings.demo_mode
    email = f"new-{uuid.uuid4().hex[:8]}@example.com"
    try:
        settings.demo_mode = False
        created = await client.post(
            "/v1/auth/register",
            json={"name": "Marta Villalobos", "email": email, "password": PASSWORD},
        )
    finally:
        settings.demo_mode = original

    assert created.status_code == 201, created.text
    assert created.json()["email_verified"] is False

    link = await _link_for(session, email)
    assert link.purpose is MagicLinkPurpose.STAFF_LOGIN


async def test_registration_on_a_demo_build_is_confirmed_and_mails_nothing(
    client: AsyncClient, session: AsyncSession
) -> None:
    """A build that hands out password-free sessions has nothing for verification
    to protect, and an evaluator with no inbox must not be parked in front of a
    link they cannot reach."""
    email = f"demo-{uuid.uuid4().hex[:8]}@example.com"

    created = await client.post(
        "/v1/auth/register",
        json={"name": "Jordan Alvarez", "email": email, "password": PASSWORD},
    )

    assert created.status_code == 201, created.text
    assert created.json()["email_verified"] is True
    with tenancy_disabled():
        assert await session.scalar(select(MagicLink).where(MagicLink.email == email)) is None


# --------------------------------------------------------------------------
# GitHub
# --------------------------------------------------------------------------


@pytest.fixture
def github_configured() -> Iterator[None]:
    settings = get_settings()
    before = (settings.github_client_id, settings.github_client_secret)
    settings.github_client_id = "test-client-id"
    settings.github_client_secret = "test-client-secret"
    yield None
    settings.github_client_id, settings.github_client_secret = before


@pytest.fixture
def github_absent() -> Iterator[None]:
    """Explicitly unconfigured, rather than assuming it.

    The developer running this may well have a real client id in their `.env`,
    and a test that asserts a default passes on a clean machine and fails on
    theirs — which is the worst way round, because the failure looks like a bug
    in the code rather than in the test.
    """
    settings = get_settings()
    before = (settings.github_client_id, settings.github_client_secret)
    settings.github_client_id = ""
    settings.github_client_secret = ""
    yield None
    settings.github_client_id, settings.github_client_secret = before


async def test_github_is_absent_unless_it_is_configured(
    client: AsyncClient, github_absent: None
) -> None:
    """Absent is a supported configuration, not a broken one: `make setup` has to
    produce a working app with no credentials at all."""
    listed = await client.get("/v1/auth/providers")
    started = await client.get("/v1/auth/github/start")

    assert listed.status_code == 200
    assert listed.json() == {"github": False}
    assert started.status_code == 404


async def test_starting_the_flow_redirects_to_github_with_an_unguessable_state(
    client: AsyncClient, github_configured: None
) -> None:
    listed = await client.get("/v1/auth/providers")
    started = await client.get("/v1/auth/github/start?next=/admin/agenda")

    assert listed.json() == {"github": True}
    assert started.status_code == 307
    location = started.headers["location"]
    assert location.startswith("https://github.com/login/oauth/authorize?")
    assert "state=" in location
    # The redirect must come back to the app's own origin, not the API's, or the
    # refresh cookie it sets is written for a host the browser never visits.
    assert "%2Fapi%2Fv1%2Fauth%2Fgithub%2Fcallback" in location


async def test_a_callback_carrying_a_state_we_never_issued_is_refused(
    client: AsyncClient, github_configured: None
) -> None:
    """Without this the callback is somebody else's login being replayed into
    this browser."""
    returned = await client.get("/v1/auth/github/callback?code=abc&state=invented")

    assert returned.status_code == 307
    assert returned.headers["location"].endswith("/login?error=oauth_state")


async def test_a_state_cannot_be_spent_twice(
    client: AsyncClient, github_configured: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_exchange(*, code: str) -> github.GitHubIdentity:
        return github.GitHubIdentity(
            provider_id="4242",
            email=f"gh-{uuid.uuid4().hex[:8]}@example.com",
            name="Octo Cat",
            avatar_url=None,
        )

    monkeypatch.setattr(github, "exchange", fake_exchange)
    started = await client.get("/v1/auth/github/start")
    state = started.headers["location"].split("state=")[1].split("&")[0]

    first = await client.get(f"/v1/auth/github/callback?code=abc&state={state}")
    second = await client.get(f"/v1/auth/github/callback?code=abc&state={state}")

    assert first.headers["location"].startswith("http://localhost:3000/auth/github")
    assert second.headers["location"].endswith("/login?error=oauth_state")


async def test_signing_in_with_github_creates_a_confirmed_account(
    client: AsyncClient,
    session: AsyncSession,
    github_configured: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """GitHub only hands back addresses it has verified, so arriving here is
    itself the proof the emailed link would have been asking for."""
    email = f"gh-{uuid.uuid4().hex[:8]}@example.com"

    async def fake_exchange(*, code: str) -> github.GitHubIdentity:
        return github.GitHubIdentity(
            provider_id=f"id-{uuid.uuid4().hex[:8]}",
            email=email,
            name="Octo Cat",
            avatar_url="https://avatars.example/octo.png",
        )

    monkeypatch.setattr(github, "exchange", fake_exchange)
    started = await client.get("/v1/auth/github/start")
    state = started.headers["location"].split("state=")[1].split("&")[0]

    returned = await client.get(f"/v1/auth/github/callback?code=abc&state={state}")

    assert returned.status_code == 307
    # Never a token in the location bar. The session travels as the httpOnly
    # cookie and the page it lands on trades that for an access token.
    assert "access_token" not in returned.headers["location"]
    assert "gather_refresh" in returned.cookies

    with tenancy_disabled():
        created = await session.scalar(select(User).where(User.email == email))
    assert created is not None
    assert created.email_verified_at is not None
    assert created.name == "Octo Cat"


async def test_github_lands_on_an_existing_account_rather_than_a_second_workspace(
    client: AsyncClient,
    session: AsyncSession,
    github_configured: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Somebody who signed up with a password and later presses the GitHub button
    is the same person, and must not end up with two organisations."""
    user, _event = await _owner(session, verified=True)

    async def fake_exchange(*, code: str) -> github.GitHubIdentity:
        return github.GitHubIdentity(
            provider_id="99887766", email=user.email, name="Ada Owner", avatar_url=None
        )

    monkeypatch.setattr(github, "exchange", fake_exchange)
    started = await client.get("/v1/auth/github/start")
    state = started.headers["location"].split("state=")[1].split("&")[0]

    await client.get(f"/v1/auth/github/callback?code=abc&state={state}")

    with tenancy_disabled():
        matches = (
            (await session.execute(select(User).where(User.email == user.email))).scalars().all()
        )
        memberships = (
            (await session.execute(select(OrgMember).where(OrgMember.user_id == user.id)))
            .scalars()
            .all()
        )
    assert len(matches) == 1
    assert len(memberships) == 1
    assert matches[0].github_user_id == "99887766"


async def test_a_cancelled_consent_screen_is_not_an_error_page(
    client: AsyncClient, github_configured: None
) -> None:
    returned = await client.get("/v1/auth/github/callback?error=access_denied")

    assert returned.status_code == 307
    assert returned.headers["location"].endswith("/login")


def test_only_a_verified_github_address_is_ever_accepted() -> None:
    """Accepting an unverified one would let anybody claim an account by typing
    somebody else's address into their GitHub profile."""
    unverified_primary = [
        {"email": "victim@example.com", "primary": True, "verified": False},
        {"email": "octo@example.com", "primary": False, "verified": True},
    ]
    none_verified = [{"email": "victim@example.com", "primary": True, "verified": False}]

    assert github._pick_email(unverified_primary) == "octo@example.com"
    assert github._pick_email(none_verified) is None
    assert github._pick_email([]) is None
