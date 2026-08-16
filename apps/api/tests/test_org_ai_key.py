"""The org key — spec 0003, seam 1: the org-settings HTTP surface.

Everything here is observed through set/status/remove. The provider is mocked
at the adapter boundary (`verify_key`), never at our own modules, so a test
failure means the endpoint contract broke — validation, roles, write-only-ness,
provenance, the audit row — not that a fake drifted.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import unseal
from app.core.security import hash_password
from app.core.tenancy import tenancy_disabled
from app.models import ActivityLog, Organization, OrgMember, Role, User

PASSWORD = "a known password 42"
#: A fixed literal, never derived — the seam's expected values come from here.
GOOD_KEY = "sk-ant-test-0123456789abcdefWXYZ"


async def _org_with(
    client: AsyncClient, session: AsyncSession, role: Role
) -> tuple[dict[str, str], Organization, User]:
    """A fresh org and a signed-in member holding `role` in it."""
    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        org = Organization(name=f"Org {suffix}", slug=f"org-{suffix}")
        session.add(org)
        await session.flush()
        user = User(
            email=f"member-{suffix}@example.com",
            name="Casey Reyes",
            password_hash=hash_password(PASSWORD),
            email_verified_at=datetime.now(UTC),
        )
        session.add(user)
        await session.flush()
        session.add(OrgMember(org_id=org.id, user_id=user.id, role=role))
        await session.commit()
    login = await client.post("/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}, org, user


@pytest.fixture
def key_always_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    """The provider round-trip is the boundary; everything on our side of it —
    provider resolution, sealing, provenance, the audit row — still runs."""
    from app.features.ai import org_settings

    async def accept(config: object) -> None:
        return None

    monkeypatch.setattr(org_settings, "verify_config", accept)


@pytest.fixture
def key_always_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.features.ai import org_settings

    async def refuse(config: object) -> None:
        raise org_settings.InvalidOrgKeyError("authentication_error: invalid x-api-key")

    monkeypatch.setattr(org_settings, "verify_config", refuse)


async def test_a_valid_key_is_sealed_stamped_and_logged(
    client: AsyncClient, session: AsyncSession, key_always_valid: None
) -> None:
    headers, org, user = await _org_with(client, session, Role.OWNER)

    saved = await client.put(
        f"/v1/orgs/{org.id}/ai-key", json={"api_key": GOOD_KEY}, headers=headers
    )

    assert saved.status_code == 200
    body = saved.json()
    assert body["configured"] is True
    assert body["last4"] == GOOD_KEY[-4:]
    assert GOOD_KEY not in saved.text  # write-only: the key never comes back

    with tenancy_disabled():
        await session.refresh(org)
        assert unseal(org.ai_key_encrypted) == GOOD_KEY
        assert org.ai_key_last4 == GOOD_KEY[-4:]
        assert org.ai_key_set_by == user.id
        assert org.ai_key_set_at is not None
        row = await session.scalar(
            select(ActivityLog).where(
                ActivityLog.org_id == org.id, ActivityLog.action == "ai_key.set"
            )
        )
    assert row is not None
    assert row.actor_user_id == user.id
    assert GOOD_KEY not in str(row.changes)  # the audit trail carries no secret either


async def test_a_refused_key_is_a_422_and_persists_nothing(
    client: AsyncClient, session: AsyncSession, key_always_refused: None
) -> None:
    headers, org, _user = await _org_with(client, session, Role.OWNER)

    saved = await client.put(
        f"/v1/orgs/{org.id}/ai-key", json={"api_key": "sk-ant-typo"}, headers=headers
    )

    assert saved.status_code == 422
    assert saved.json()["error"]["code"] == "INVALID_ORG_KEY"
    assert "invalid x-api-key" in saved.json()["error"]["message"]
    with tenancy_disabled():
        await session.refresh(org)
        assert org.ai_key_encrypted is None
        assert org.ai_key_last4 is None


async def test_status_reports_state_and_never_the_key(
    client: AsyncClient, session: AsyncSession, key_always_valid: None
) -> None:
    headers, org, user = await _org_with(client, session, Role.ADMIN)

    before = await client.get(f"/v1/orgs/{org.id}/ai-key", headers=headers)
    assert before.status_code == 200
    body = before.json()
    assert body["configured"] is False
    assert body["last4"] is None
    assert body["provider"] is None
    assert body["daily_cap"] is None
    assert body["cap_default"] == 200
    # The screen draws its provider list from here, never hardcodes it.
    listed = {option["id"] for option in body["providers"]}
    assert {"anthropic", "openai", "google", "xai", "deepseek", "moonshot"} <= listed

    await client.put(f"/v1/orgs/{org.id}/ai-key", json={"api_key": GOOD_KEY}, headers=headers)
    after = await client.get(f"/v1/orgs/{org.id}/ai-key", headers=headers)

    body = after.json()
    assert body["configured"] is True
    assert body["last4"] == GOOD_KEY[-4:]
    assert body["set_by_name"] == user.name
    assert GOOD_KEY not in after.text


async def test_the_cap_is_settable_with_or_without_a_key(
    client: AsyncClient, session: AsyncSession, key_always_valid: None
) -> None:
    headers, org, _user = await _org_with(client, session, Role.OWNER)

    saved = await client.put(f"/v1/orgs/{org.id}/ai-key", json={"daily_cap": 50}, headers=headers)

    assert saved.status_code == 200
    assert saved.json()["daily_cap"] == 50
    with tenancy_disabled():
        await session.refresh(org)
        assert org.ai_daily_proposal_cap == 50
        assert org.ai_key_encrypted is None  # cap alone touches no key state


async def test_remove_clears_the_key_keeps_the_cap_and_logs(
    client: AsyncClient, session: AsyncSession, key_always_valid: None
) -> None:
    headers, org, user = await _org_with(client, session, Role.OWNER)
    await client.put(
        f"/v1/orgs/{org.id}/ai-key",
        json={"api_key": GOOD_KEY, "daily_cap": 75},
        headers=headers,
    )

    removed = await client.delete(f"/v1/orgs/{org.id}/ai-key", headers=headers)

    assert removed.status_code == 200
    assert removed.json()["configured"] is False
    with tenancy_disabled():
        await session.refresh(org)
        assert org.ai_key_encrypted is None
        assert org.ai_key_last4 is None
        assert org.ai_key_set_by is None
        assert org.ai_key_set_at is None
        assert org.ai_daily_proposal_cap == 75  # the ceiling survives the key
        row = await session.scalar(
            select(ActivityLog).where(
                ActivityLog.org_id == org.id, ActivityLog.action == "ai_key.removed"
            )
        )
    assert row is not None
    assert row.actor_user_id == user.id


@pytest.mark.parametrize("role", [Role.COORDINATOR, Role.REVIEWER])
async def test_only_owner_and_admin_touch_the_key(
    role: Role, client: AsyncClient, session: AsyncSession, key_always_valid: None
) -> None:
    headers, org, _user = await _org_with(client, session, role)

    status = await client.get(f"/v1/orgs/{org.id}/ai-key", headers=headers)
    saved = await client.put(
        f"/v1/orgs/{org.id}/ai-key", json={"api_key": GOOD_KEY}, headers=headers
    )
    removed = await client.delete(f"/v1/orgs/{org.id}/ai-key", headers=headers)

    assert status.status_code == 403
    assert saved.status_code == 403
    assert removed.status_code == 403


async def test_a_member_of_another_org_cannot_reach_this_one(
    client: AsyncClient, session: AsyncSession, key_always_valid: None
) -> None:
    _theirs, other_org, _user = await _org_with(client, session, Role.OWNER)
    mine, _my_org, _me = await _org_with(client, session, Role.OWNER)

    saved = await client.put(
        f"/v1/orgs/{other_org.id}/ai-key", json={"api_key": GOOD_KEY}, headers=mine
    )

    assert saved.status_code == 403


async def test_replacing_a_key_is_the_same_path_not_a_special_case(
    client: AsyncClient, session: AsyncSession, key_always_valid: None
) -> None:
    headers, org, _user = await _org_with(client, session, Role.OWNER)
    await client.put(f"/v1/orgs/{org.id}/ai-key", json={"api_key": GOOD_KEY}, headers=headers)

    replacement = "sk-ant-test-replacement-key-9876"
    saved = await client.put(
        f"/v1/orgs/{org.id}/ai-key", json={"api_key": replacement}, headers=headers
    )

    assert saved.status_code == 200
    assert saved.json()["last4"] == replacement[-4:]
    with tenancy_disabled():
        await session.refresh(org)
        assert unseal(org.ai_key_encrypted) == replacement


async def test_a_key_defaults_to_anthropic_and_remembers_its_provider(
    client: AsyncClient, session: AsyncSession, key_always_valid: None
) -> None:
    headers, org, _user = await _org_with(client, session, Role.OWNER)

    saved = await client.put(
        f"/v1/orgs/{org.id}/ai-key",
        json={"api_key": GOOD_KEY, "provider": "deepseek", "model": "deepseek-chat"},
        headers=headers,
    )

    assert saved.status_code == 200
    assert saved.json()["provider"] == "deepseek"
    assert saved.json()["model"] == "deepseek-chat"
    with tenancy_disabled():
        await session.refresh(org)
        assert org.ai_provider == "deepseek"
        assert org.ai_model == "deepseek-chat"


async def test_an_unknown_provider_is_refused_with_the_known_list(
    client: AsyncClient, session: AsyncSession, key_always_valid: None
) -> None:
    headers, org, _user = await _org_with(client, session, Role.OWNER)

    saved = await client.put(
        f"/v1/orgs/{org.id}/ai-key",
        json={"api_key": GOOD_KEY, "provider": "closedai", "model": "x"},
        headers=headers,
    )

    assert saved.status_code == 422
    assert "closedai" in saved.json()["error"]["message"]
    assert "anthropic" in saved.json()["error"]["message"]


async def test_a_non_anthropic_provider_requires_a_model_name(
    client: AsyncClient, session: AsyncSession, key_always_valid: None
) -> None:
    """There is no sane cross-provider default; the org names what it pays for.
    The refusal teaches by example, with the preset's hint."""
    headers, org, _user = await _org_with(client, session, Role.OWNER)

    saved = await client.put(
        f"/v1/orgs/{org.id}/ai-key",
        json={"api_key": GOOD_KEY, "provider": "openai"},
        headers=headers,
    )

    assert saved.status_code == 422
    assert "model name is required" in saved.json()["error"]["message"]
    with tenancy_disabled():
        await session.refresh(org)
        assert org.ai_key_encrypted is None


async def test_provider_or_model_without_a_key_is_refused_not_ignored(
    client: AsyncClient, session: AsyncSession, key_always_valid: None
) -> None:
    """A key belongs to a provider; changing one without the other is a
    half-configuration and fails loud rather than no-oping."""
    headers, org, _user = await _org_with(client, session, Role.OWNER)
    await client.put(f"/v1/orgs/{org.id}/ai-key", json={"api_key": GOOD_KEY}, headers=headers)

    saved = await client.put(
        f"/v1/orgs/{org.id}/ai-key", json={"provider": "openai"}, headers=headers
    )

    assert saved.status_code == 422
    assert "pasting the key again" in saved.json()["error"]["message"]


async def test_verify_maps_provider_refusal_and_unreachability_to_422(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The two real failure shapes of the probe itself, with the adapter faked
    at the gateway boundary — the fixtures above bypass verify_config wholesale,
    so this is the only coverage its error mapping gets."""
    import httpx

    from app.core.errors import ApiError
    from app.features.ai import org_settings
    from app.features.ai.gateway import OrgAiConfig

    class Refusing:
        async def complete(self, **_: object) -> None:
            raise ApiError("The model provider refused the request (401): invalid key")

    class Unreachable:
        async def complete(self, **_: object) -> None:
            raise httpx.ConnectError("boom")

    config = OrgAiConfig(provider="anthropic", api_key="sk-ant-x-12345678", model=None)

    monkeypatch.setattr(org_settings, "adapter_for", lambda _config: Refusing())
    with pytest.raises(org_settings.InvalidOrgKeyError) as refused:
        await org_settings.verify_config(config)
    assert "invalid key" in str(refused.value)

    monkeypatch.setattr(org_settings, "adapter_for", lambda _config: Unreachable())
    with pytest.raises(org_settings.InvalidOrgKeyError) as unreachable:
        await org_settings.verify_config(config)
    assert "Could not reach" in str(unreachable.value)


# ─────────────────── the local model, chosen rather than assumed ───────────────


async def test_a_local_model_saves_with_no_key_at_all(
    client: AsyncClient, session: AsyncSession, key_always_valid: None
) -> None:
    """Spec 0006. A local server has no API key, so requiring one would make the
    provider unselectable — which is how it ended up being an invisible env var
    in the first place."""
    headers, org, _user = await _org_with(client, session, Role.OWNER)

    saved = await client.put(
        f"/v1/orgs/{org.id}/ai-key",
        json={"provider": "ollama", "model": "llama3.1:8b", "base_url": "http://127.0.0.1:11434"},
        headers=headers,
    )

    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["configured"] is True, "a provider was chosen, which is what configured means now"
    assert body["provider"] == "ollama"
    assert body["base_url"] == "http://127.0.0.1:11434"
    assert body["last4"] is None, "there is no key to show the last four of"

    with tenancy_disabled():
        await session.refresh(org)
        assert org.ai_key_encrypted is None
        assert org.ai_base_url == "http://127.0.0.1:11434"


async def test_choosing_a_local_model_clears_a_previous_paid_key(
    client: AsyncClient, session: AsyncSession, key_always_valid: None
) -> None:
    """Otherwise the sealed credential of a provider nobody is using any more
    sits in the row indefinitely."""
    headers, org, _user = await _org_with(client, session, Role.OWNER)
    await client.put(f"/v1/orgs/{org.id}/ai-key", json={"api_key": GOOD_KEY}, headers=headers)

    await client.put(
        f"/v1/orgs/{org.id}/ai-key",
        json={"provider": "ollama", "model": "llama3.1:8b", "base_url": "http://127.0.0.1:11434"},
        headers=headers,
    )

    with tenancy_disabled():
        await session.refresh(org)
        assert org.ai_key_encrypted is None
        assert org.ai_key_last4 is None


async def test_a_public_address_is_refused(
    client: AsyncClient, session: AsyncSession, key_always_valid: None
) -> None:
    """The whole reason the other nine base URLs are hardcoded."""
    headers, org, _user = await _org_with(client, session, Role.OWNER)

    refused = await client.put(
        f"/v1/orgs/{org.id}/ai-key",
        json={
            "provider": "ollama",
            "model": "llama3.1:8b",
            "base_url": "http://169.254.169.254",
        },
        headers=headers,
    )

    assert refused.status_code == 422
    with tenancy_disabled():
        await session.refresh(org)
        assert org.ai_base_url is None


async def test_a_local_model_without_a_model_name_is_refused(
    client: AsyncClient, session: AsyncSession, key_always_valid: None
) -> None:
    headers, org, _user = await _org_with(client, session, Role.OWNER)

    refused = await client.put(
        f"/v1/orgs/{org.id}/ai-key",
        json={"provider": "ollama", "base_url": "http://127.0.0.1:11434"},
        headers=headers,
    )

    assert refused.status_code == 422


async def test_model_discovery_refuses_an_address_it_will_not_fetch(
    client: AsyncClient, session: AsyncSession
) -> None:
    """A read-only convenience is still a server-side fetch of a supplied URL."""
    headers, org, _user = await _org_with(client, session, Role.OWNER)

    refused = await client.get(
        f"/v1/orgs/{org.id}/ai-key/local-models?base_url=http://169.254.169.254",
        headers=headers,
    )

    assert refused.status_code == 422


async def test_model_discovery_says_why_it_could_not_connect(
    client: AsyncClient, session: AsyncSession
) -> None:
    """ "Nothing installed" and "cannot reach that address" are different facts
    and the screen has to be able to tell them apart."""
    headers, org, _user = await _org_with(client, session, Role.OWNER)

    # Port 1 on loopback passes the address check and refuses the connection.
    answer = await client.get(
        f"/v1/orgs/{org.id}/ai-key/local-models?base_url=http://127.0.0.1:1",
        headers=headers,
    )

    assert answer.status_code == 422
    assert "could not reach" in answer.text.lower()
