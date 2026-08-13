"""Adding and managing the people who work an event — the evaluator flow."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.tenancy import tenancy_disabled
from app.models import Event, Form, MagicLink, MagicLinkPurpose, OrgMember, Role, User

# The event-with-an-admin fixture, reused rather than rebuilt.
from test_cfp_flow import cfp  # noqa: F401

Cfp = tuple[dict[str, str], Event, Form]


async def _member_rows(
    client: AsyncClient, headers: dict[str, str], event: Event
) -> list[dict[str, str]]:
    response = await client.get(f"/v1/events/{event.id}/members", headers=headers)
    assert response.status_code == 200
    return response.json()


async def test_adding_an_evaluator_creates_the_account_and_mails_a_link(
    client: AsyncClient, session: AsyncSession, cfp: Cfp
) -> None:
    headers, event, _form = cfp
    email = f"maren-{uuid.uuid4().hex[:8]}@example.com"

    response = await client.post(
        f"/v1/events/{event.id}/members",
        headers=headers,
        json={"name": "Maren Voss", "email": email, "role": "reviewer"},
    )

    assert response.status_code == 201
    assert response.json()["role"] == "reviewer"
    members = await _member_rows(client, headers, event)
    assert any(row["email"] == email and row["role"] == "reviewer" for row in members)

    # The invite is the sign-in: a single-use staff link was issued for them.
    with tenancy_disabled():
        link = await session.scalar(select(MagicLink).where(MagicLink.email == email))
    assert link is not None
    assert link.purpose == MagicLinkPurpose.STAFF_LOGIN


async def test_adding_the_same_person_twice_conflicts(client: AsyncClient, cfp: Cfp) -> None:
    headers, event, _form = cfp
    email = f"twice-{uuid.uuid4().hex[:8]}@example.com"
    body = {"name": "Twice Added", "email": email, "role": "reviewer"}

    first = await client.post(f"/v1/events/{event.id}/members", headers=headers, json=body)
    assert first.status_code == 201
    second = await client.post(f"/v1/events/{event.id}/members", headers=headers, json=body)
    assert second.status_code == 409


async def test_ownership_cannot_be_granted_by_invite(client: AsyncClient, cfp: Cfp) -> None:
    headers, event, _form = cfp

    response = await client.post(
        f"/v1/events/{event.id}/members",
        headers=headers,
        json={"name": "Aspiring Owner", "email": "owner@example.com", "role": "owner"},
    )

    assert response.status_code == 422


async def test_changing_a_role_shows_up_in_the_team_list(client: AsyncClient, cfp: Cfp) -> None:
    headers, event, _form = cfp
    email = f"promote-{uuid.uuid4().hex[:8]}@example.com"
    created = await client.post(
        f"/v1/events/{event.id}/members",
        headers=headers,
        json={"name": "Pat Promotable", "email": email, "role": "reviewer"},
    )
    user_id = created.json()["user_id"]

    response = await client.patch(
        f"/v1/events/{event.id}/members/{user_id}",
        headers=headers,
        json={"role": "coordinator"},
    )

    assert response.status_code == 200
    members = await _member_rows(client, headers, event)
    assert any(row["email"] == email and row["role"] == "coordinator" for row in members)


async def test_you_cannot_change_your_own_role(
    client: AsyncClient, session: AsyncSession, cfp: Cfp
) -> None:
    headers, event, _form = cfp
    me = await client.get("/v1/auth/me", headers=headers)
    my_id = me.json()["id"]

    response = await client.patch(
        f"/v1/events/{event.id}/members/{my_id}",
        headers=headers,
        json={"role": "reviewer"},
    )

    assert response.status_code == 409


async def test_removing_a_member_ends_their_access(client: AsyncClient, cfp: Cfp) -> None:
    headers, event, _form = cfp
    email = f"leaver-{uuid.uuid4().hex[:8]}@example.com"
    created = await client.post(
        f"/v1/events/{event.id}/members",
        headers=headers,
        json={"name": "Lee Ver", "email": email, "role": "reviewer"},
    )
    user_id = created.json()["user_id"]

    response = await client.delete(f"/v1/events/{event.id}/members/{user_id}", headers=headers)

    assert response.status_code == 204
    members = await _member_rows(client, headers, event)
    assert not any(row["email"] == email for row in members)


async def test_an_org_wide_member_cannot_be_removed_from_one_event(
    client: AsyncClient, session: AsyncSession, cfp: Cfp
) -> None:
    headers, event, _form = cfp
    with tenancy_disabled():
        colleague = User(
            email=f"orgwide-{uuid.uuid4().hex[:8]}@example.com",
            name="Orla Orgwide",
            password_hash=hash_password("irrelevant"),
            email_verified_at=datetime.now(UTC),
        )
        session.add(colleague)
        await session.flush()
        session.add(OrgMember(org_id=event.org_id, user_id=colleague.id, role=Role.ADMIN))
        await session.commit()

    response = await client.delete(f"/v1/events/{event.id}/members/{colleague.id}", headers=headers)

    assert response.status_code == 409
    assert "organisation" in response.json()["error"]["message"]


async def test_a_reviewer_cannot_add_members(
    client: AsyncClient, session: AsyncSession, cfp: Cfp
) -> None:
    headers, event, _form = cfp
    email = f"reviewer-{uuid.uuid4().hex[:8]}@example.com"
    await client.post(
        f"/v1/events/{event.id}/members",
        headers=headers,
        json={"name": "Riva Reviewer", "email": email, "role": "reviewer"},
    )

    # Sign the reviewer in via a fresh password so we can call the API as them.
    with tenancy_disabled():
        user = await session.scalar(select(User).where(User.email == email))
        assert user is not None
        user.password_hash = hash_password("a known password 42")
        await session.commit()
    login = await client.post(
        "/v1/auth/login", json={"email": email, "password": "a known password 42"}
    )
    reviewer_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = await client.post(
        f"/v1/events/{event.id}/members",
        headers=reviewer_headers,
        json={"name": "Nope", "email": "nope@example.com", "role": "reviewer"},
    )

    assert response.status_code == 403
