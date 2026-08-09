"""Auth endpoints, driven through the real app against real Postgres and Redis."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

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


async def test_speaker_token_cannot_open_a_staff_route(
    client: AsyncClient, session: AsyncSession, two_orgs: object
) -> None:
    """The critical separation: a portal session must not reach the console."""
    from app.features.auth import service
    from app.models import Event

    with tenancy_disabled():
        event = (await session.execute(select(Event))).scalars().first()
        assert event is not None
        raw = await service.issue_magic_link(
            session, email="speaker2@example.com", event_id=event.id
        )
        await session.commit()

    consumed = await client.post("/v1/auth/magic-link/consume", json={"token": raw})
    speaker_token = consumed.json()["access_token"]

    response = await client.get("/v1/auth/me", headers={"Authorization": f"Bearer {speaker_token}"})
    assert response.status_code == 401


async def test_registration_creates_an_org_an_owner_and_an_event(client: AsyncClient) -> None:
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

    # The whole point of the regression: the response used to succeed while the
    # rows were rejected at commit, so read it back through a second request.
    events = await client.get("/v1/events", headers={"Authorization": f"Bearer {token}"})
    assert events.status_code == 200
    year = datetime.now(UTC).year
    assert [event["name"] for event in events.json()] == [f"Northbound Conf {year}"]
    assert events.json()[0]["status"] == "draft"


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
