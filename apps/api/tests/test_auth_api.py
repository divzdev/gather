"""Auth endpoints, driven through the real app against real Postgres and Redis."""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import tenancy_disabled
from app.models import MagicLink, User

PASSWORD = "correct horse battery staple"


async def test_login_returns_a_token_and_sets_the_refresh_cookie(
    client: AsyncClient, staff_user: User
) -> None:
    response = await client.post(
        "/v1/auth/login", json={"email": staff_user.email, "password": PASSWORD}
    )

    assert response.status_code == 200
    assert response.json()["token_type"] == "bearer"
    assert "gather_refresh" in response.cookies


async def test_refresh_cookie_is_httponly_and_root_scoped(
    client: AsyncClient, staff_user: User
) -> None:
    """Root path, not /v1/auth: the browser reaches the API through the web app's
    /api/v1 rewrite, so a cookie scoped to /v1/auth would never be sent back."""
    response = await client.post(
        "/v1/auth/login", json={"email": staff_user.email, "password": PASSWORD}
    )
    header = response.headers["set-cookie"]

    assert "HttpOnly" in header
    assert "Path=/" in header
    assert "SameSite=lax" in header.replace("Samesite", "SameSite")


async def test_wrong_password_is_rejected(client: AsyncClient, staff_user: User) -> None:
    response = await client.post(
        "/v1/auth/login", json={"email": staff_user.email, "password": "wrong"}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "NOT_AUTHENTICATED"


async def test_unknown_email_is_indistinguishable_from_a_wrong_password(
    client: AsyncClient, staff_user: User
) -> None:
    """Same status and same code, so login cannot enumerate staff accounts."""
    unknown = await client.post(
        "/v1/auth/login", json={"email": "nobody@example.com", "password": "wrong"}
    )
    known = await client.post(
        "/v1/auth/login", json={"email": staff_user.email, "password": "wrong"}
    )

    assert unknown.status_code == known.status_code == 401
    assert unknown.json() == known.json()


async def test_login_body_rejects_unknown_fields(client: AsyncClient, staff_user: User) -> None:
    response = await client.post(
        "/v1/auth/login",
        json={"email": staff_user.email, "password": PASSWORD, "is_admin": True},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


async def test_me_requires_a_token(client: AsyncClient) -> None:
    assert (await client.get("/v1/auth/me")).status_code == 401


async def test_me_returns_the_signed_in_user_without_the_password_hash(
    client: AsyncClient, staff_user: User
) -> None:
    login = await client.post(
        "/v1/auth/login", json={"email": staff_user.email, "password": PASSWORD}
    )
    token = login.json()["access_token"]

    response = await client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == staff_user.email
    assert "password_hash" not in body


async def test_refresh_rotates_the_token_and_burns_the_old_one(
    client: AsyncClient, staff_user: User
) -> None:
    await client.post("/v1/auth/login", json={"email": staff_user.email, "password": PASSWORD})
    original = client.cookies["gather_refresh"]

    rotated = await client.post("/v1/auth/refresh")
    assert rotated.status_code == 200
    assert client.cookies["gather_refresh"] != original

    # Replaying the old token must fail — this is what makes theft detectable.
    replay = await client.post("/v1/auth/refresh", cookies={"gather_refresh": original})
    assert replay.status_code == 401


async def test_logout_revokes_the_session(client: AsyncClient, staff_user: User) -> None:
    await client.post("/v1/auth/login", json={"email": staff_user.email, "password": PASSWORD})
    stolen = client.cookies["gather_refresh"]

    assert (await client.post("/v1/auth/logout")).status_code == 204
    assert (
        await client.post("/v1/auth/refresh", cookies={"gather_refresh": stolen})
    ).status_code == 401


async def test_login_is_rate_limited(client: AsyncClient, staff_user: User) -> None:
    """10 per IP per 15 minutes, per engineering-brief §4.8."""
    statuses = [
        (
            await client.post(
                "/v1/auth/login", json={"email": staff_user.email, "password": "wrong"}
            )
        ).status_code
        for _ in range(12)
    ]

    assert statuses[:10] == [401] * 10
    assert statuses[10:] == [429, 429]


async def test_magic_link_returns_204_for_any_address(client: AsyncClient) -> None:
    """Identical response for known and unknown emails — no enumeration."""
    response = await client.post(
        "/v1/auth/magic-link",
        json={"email": "who-knows@example.com", "event_id": str(uuid.uuid4())},
    )
    assert response.status_code == 204


async def test_magic_link_is_rate_limited_per_email(client: AsyncClient) -> None:
    payload = {"email": "target@example.com"}
    statuses = [
        (await client.post("/v1/auth/magic-link", json=payload)).status_code for _ in range(5)
    ]

    assert statuses[:3] == [204] * 3
    assert statuses[3:] == [429, 429]


async def test_magic_link_grants_a_speaker_token_once(
    client: AsyncClient, session: AsyncSession, two_orgs: object
) -> None:
    from app.models import Event

    with tenancy_disabled():
        event = (await session.execute(select(Event))).scalars().first()
    assert event is not None

    await client.post(
        "/v1/auth/magic-link", json={"email": "speaker@example.com", "event_id": str(event.id)}
    )
    # The raw token never leaves the service; the test reads what the mailer would.
    with tenancy_disabled():
        link = (
            (
                await session.execute(
                    select(MagicLink)
                    .where(MagicLink.email == "speaker@example.com")
                    .order_by(MagicLink.created_at.desc())
                )
            )
            .scalars()
            .first()
        )
    assert link is not None

    # Re-derive a usable token by issuing through the service directly, since the
    # stored value is a one-way hash — the point of the test is single use.
    from app.features.auth import service

    await _speaker_on(session, event, "speaker@example.com")
    with tenancy_disabled():
        raw = await service.issue_magic_link(
            session, email="speaker@example.com", event_id=event.id
        )
        await session.commit()

    first = await client.post("/v1/auth/magic-link/consume", json={"token": raw})
    assert first.status_code == 200

    second = await client.post("/v1/auth/magic-link/consume", json={"token": raw})
    assert second.status_code == 400
    assert second.json()["error"]["code"] == "MAGIC_LINK_EXPIRED"


async def _speaker_on(session: AsyncSession, event: object, email: str) -> None:
    """A link only signs someone in if the address is on the roster, so the
    speaker has to exist before the link is worth anything."""
    from app.models import EventSpeaker, Speaker

    with tenancy_disabled():
        speaker = Speaker(org_id=event.org_id, name="Marta Duarte", email=email)
        session.add(speaker)
        await session.flush()
        session.add(EventSpeaker(org_id=event.org_id, event_id=event.id, speaker_id=speaker.id))
        await session.commit()


async def test_speaker_token_cannot_open_a_staff_route(
    client: AsyncClient, session: AsyncSession, two_orgs: object
) -> None:
    """The critical separation: a portal session must not reach the console."""
    from app.features.auth import service
    from app.models import Event

    with tenancy_disabled():
        event = (await session.execute(select(Event))).scalars().first()
    assert event is not None
    await _speaker_on(session, event, "speaker2@example.com")
    with tenancy_disabled():
        raw = await service.issue_magic_link(
            session, email="speaker2@example.com", event_id=event.id
        )
        await session.commit()

    consumed = await client.post("/v1/auth/magic-link/consume", json={"token": raw})
    speaker_token = consumed.json()["access_token"]

    response = await client.get("/v1/auth/me", headers={"Authorization": f"Bearer {speaker_token}"})
    assert response.status_code == 401


async def test_registration_creates_an_org_and_an_owner_but_no_event(client: AsyncClient) -> None:
    """Signing up no longer invents a conference.

    It used to create one named after the organisation and dated ninety days
    out, so a new owner's first screen described an event they had never agreed
    to. Naming it is the first real decision of running one, and it belongs to
    onboarding.
    """
    response = await client.post(
        "/v1/auth/register",
        json={
            "name": "Rae Lindqvist",
            "organisation": "Northbound Conf",
            "email": "rae@northbound.example",
            "password": "a-long-enough-passphrase",
        },
    )

    assert response.status_code == 201
    token = response.json()["access_token"]

    # Read it back through a second request: the response used to succeed while
    # the rows were rejected at commit.
    events = await client.get("/v1/events", headers={"Authorization": f"Bearer {token}"})
    assert events.status_code == 200
    assert events.json() == []

    me = await client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["org_name"] == "Northbound Conf"
    assert me.json()["role"] == "owner"


async def test_registering_without_an_organisation_still_works(client: AsyncClient) -> None:
    """Plenty of organisers run a single event and have no organisation to name.

    Demanding one is a question they cannot answer at signup, so it is optional
    and falls back to something recognisable until Settings renames it.
    """
    response = await client.post(
        "/v1/auth/register",
        json={
            "name": "Solo Organiser",
            "email": "solo@example.com",
            "password": "a-long-enough-passphrase",
        },
    )

    assert response.status_code == 201
    me = await client.get(
        "/v1/auth/me",
        headers={"Authorization": f"Bearer {response.json()['access_token']}"},
    )
    assert me.json()["org_name"] == "Solo Organiser's workspace"


async def test_an_owner_can_create_an_event(client: AsyncClient) -> None:
    """The API had no POST at all, so the event invented at signup was the only
    one an organiser would ever have."""
    registered = await client.post(
        "/v1/auth/register",
        json={
            "name": "Ada Organiser",
            "organisation": "Northbound",
            "email": "ada-events@example.com",
            "password": "a-long-enough-passphrase",
        },
    )
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}

    created = await client.post(
        "/v1/events",
        json={
            "name": "Northbound 2028",
            "starts_on": "2028-04-11",
            "ends_on": "2028-04-13",
            "timezone": "Europe/London",
            "location": "Barbican",
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["name"] == "Northbound 2028"
    assert created.json()["timezone"] == "Europe/London"
    assert created.json()["status"] == "draft"

    listed = await client.get("/v1/events", headers=headers)
    assert [event["name"] for event in listed.json()] == ["Northbound 2028"]

    # An event cannot end before it starts.
    backwards = await client.post(
        "/v1/events",
        json={"name": "Backwards", "starts_on": "2028-04-13", "ends_on": "2028-04-11"},
        headers=headers,
    )
    assert backwards.status_code == 422


async def test_registering_a_taken_email_is_rejected(client: AsyncClient, staff_user: User) -> None:
    response = await client.post(
        "/v1/auth/register",
        json={
            "name": "Someone Else",
            "organisation": "Other Co",
            "email": staff_user.email,
            "password": "a-long-enough-passphrase",
        },
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "EMAIL_TAKEN"


async def test_registration_requires_a_long_password(client: AsyncClient) -> None:
    response = await client.post(
        "/v1/auth/register",
        json={
            "name": "Rae",
            "organisation": "Northbound",
            "email": "rae2@northbound.example",
            "password": "short",
        },
    )

    assert response.status_code == 422


async def test_a_link_for_an_address_on_nobodys_roster_signs_nobody_in(
    client: AsyncClient, session: AsyncSession, two_orgs: object
) -> None:
    """The request still answers 204 — it must not enumerate speakers — but the
    link it issues cannot be traded for a session, because there is no session to
    give. The old behaviour minted a token pointing at the link's own row."""
    from app.features.auth import service
    from app.models import Event

    with tenancy_disabled():
        event = (await session.execute(select(Event))).scalars().first()
        assert event is not None
        raw = await service.issue_magic_link(session, email="nobody@example.com", event_id=event.id)
        await session.commit()

    asked = await client.post(
        "/v1/auth/magic-link", json={"email": "nobody@example.com", "event_id": str(event.id)}
    )
    consumed = await client.post("/v1/auth/magic-link/consume", json={"token": raw})

    assert asked.status_code == 204
    assert consumed.status_code == 400
    assert consumed.json()["error"]["code"] == "MAGIC_LINK_EXPIRED"


async def test_demo_login_opens_each_seat_without_a_password(
    client: AsyncClient, session: AsyncSession, two_orgs: object
) -> None:
    """The harness is a browser agent with no inbox, so the magic-link path is
    unreachable for it. These three buttons are how it gets in at all."""
    from app.core.security import hash_password
    from app.features.auth import service
    from app.models import Event, EventSpeaker, OrgMember, Role, Speaker, User

    with tenancy_disabled():
        event = (await session.execute(select(Event))).scalars().first()
        assert event is not None
        organiser_email = service.DEMO_ACCOUNTS["organizer"][0]
        speaker_email = service.DEMO_ACCOUNTS["speaker"][0]

        organiser = User(
            email=organiser_email, name="Jordan Alvarez", password_hash=hash_password("unused")
        )
        session.add(organiser)
        await session.flush()
        session.add(OrgMember(org_id=event.org_id, user_id=organiser.id, role=Role.OWNER))

        speaker = Speaker(org_id=event.org_id, name="Priya Raman", email=speaker_email)
        session.add(speaker)
        await session.flush()
        session.add(EventSpeaker(org_id=event.org_id, event_id=event.id, speaker_id=speaker.id))
        await session.commit()

    staff = await client.post("/v1/auth/demo-login", json={"role": "organizer"})
    portal = await client.post("/v1/auth/demo-login", json={"role": "speaker"})

    assert staff.status_code == 200
    assert staff.json()["kind"] == "staff"
    assert portal.status_code == 200
    assert portal.json()["kind"] == "speaker"

    # The staff token really opens the console, and the speaker token really
    # opens the portal — a token that does not work is worse than no button.
    me = await client.get(
        "/v1/auth/me", headers={"Authorization": f"Bearer {staff.json()['access_token']}"}
    )
    home = await client.get(
        "/v1/portal/home",
        headers={"Authorization": f"Bearer {portal.json()['access_token']}"},
    )
    assert me.status_code == 200
    assert home.status_code == 200


async def test_demo_login_is_absent_when_the_build_is_not_a_demo(
    client: AsyncClient, monkeypatch: object
) -> None:
    """It has to be impossible on a real deployment, not merely discouraged."""
    from app.core.config import get_settings

    settings = get_settings()
    original = settings.demo_mode
    try:
        settings.demo_mode = False
        listed = await client.get("/v1/auth/demo-accounts")
        attempted = await client.post("/v1/auth/demo-login", json={"role": "organizer"})
    finally:
        settings.demo_mode = original

    assert listed.status_code == 404
    assert attempted.status_code == 404
