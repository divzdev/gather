"""What is answering, and what today has cost — spec 0006, reported gap.

The drawer used to be able to say which model answered only *after* an answer
came back, so "is this even using the key I pasted?" was answerable by asking a
throwaway question and reading the small print, or by opening the database.

Two properties are under test here, and the first matters more than the route:
**what the screen reports and what actually runs are one decision.** A second
function reimplementing the precedence would eventually drift, and a status line
that confidently names the wrong model is worse than none at all.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.crypto import seal
from app.core.tenancy import tenancy_disabled
from app.features.ai import gateway, proposals
from app.features.ai.adapters.anthropic import AnthropicAdapter
from app.features.ai.adapters.ollama import OllamaAdapter
from app.features.ai.adapters.openai_compat import OpenAICompatAdapter
from app.features.ai.adapters.stub import StubAdapter
from app.features.ai.gateway import OrgAiConfig
from app.models import AiProposal, AiProposalKind, AiProposalStatus, Organization
from test_ai_assistant import (  # noqa: F401
    PASSWORD,
    World,
    no_model_configured,
    sessions_hit_the_test_database,
    world,
)

ORG_KEY = "sk-org-0123456789abcdefQRST"


#: Not frozen, unlike the cap tests next door. These go through HTTP, and a
#: frozen clock expires the access token the `world` fixture minted a moment
#: earlier at real time — every request comes back 401. Relative timestamps
#: answer the same questions ("today" versus "not today") at any hour.
def _today() -> datetime:
    return datetime.now(UTC)


def _yesterday() -> datetime:
    return datetime.now(UTC) - timedelta(days=1)


# ───────────── what is reported and what runs are the same decision ─────────────


#: Every state the precedence can be in, and the adapter each one must produce.
#: `describe_choice` is checked against *this* table and against
#: `select_adapter`'s answer, so a change to one that is not a change to the
#: other fails here rather than on somebody's screen.
CHOICES = [
    pytest.param(
        OrgAiConfig(provider="openai", api_key=ORG_KEY, model="gpt-4o-mini"),
        False,
        "org",
        "OpenAI",
        "gpt-4o-mini",
        OpenAICompatAdapter,
        id="the org's own key",
    ),
    pytest.param(
        OrgAiConfig(
            provider="ollama", api_key="", model="llama3.1:8b", base_url="http://127.0.0.1:11434"
        ),
        False,
        "org",
        "Local model (Ollama)",
        "llama3.1:8b",
        OllamaAdapter,
        id="a local model the org chose",
    ),
    pytest.param(None, True, "server", "Anthropic", None, AnthropicAdapter, id="the server's key"),
    pytest.param(None, False, "none", "No model configured", None, StubAdapter, id="nothing"),
]


@pytest.mark.parametrize(("org", "server_key", "source", "label", "model", "adapter_type"), CHOICES)
def test_the_reported_choice_is_the_adapter_that_would_run(
    no_model_configured: None,
    monkeypatch: pytest.MonkeyPatch,
    org: OrgAiConfig | None,
    server_key: bool,
    source: str,
    label: str,
    model: str | None,
    adapter_type: type,
) -> None:
    if server_key:
        monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-server", raising=False)

    choice = gateway.describe_choice(org=org)
    adapter = gateway.select_adapter(org=org)

    assert isinstance(adapter, adapter_type)
    assert choice.source == source
    assert choice.label == label
    # The one that matters: the name on screen is the name in the request body.
    assert choice.model == adapter.model
    if model is not None:
        assert choice.model == model


def test_only_the_stub_is_reported_as_a_stub(
    no_model_configured: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`is_stub` drives the "sample answer" badge, so a real model wrongly
    flagged undersells it and a stub wrongly cleared is the dishonesty this
    whole feature guards against."""
    assert gateway.describe_choice(org=None).is_stub is True

    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-server", raising=False)
    assert gateway.describe_choice(org=None).is_stub is False
    assert (
        gateway.describe_choice(
            org=OrgAiConfig(provider="openai", api_key=ORG_KEY, model="gpt-4o-mini")
        ).is_stub
        is False
    )


# ─────────────────────────── the count on the screen ───────────────────────────


async def _spent_today(session: AsyncSession, world: World, n: int) -> None:
    with tenancy_disabled():
        for _ in range(n):
            session.add(
                AiProposal(
                    org_id=world.org_id,
                    event_id=world.event.id,
                    kind=AiProposalKind.ANSWER,
                    status=AiProposalStatus.READY,
                    input={},
                    output={},
                    created_at=_today(),
                )
            )
        await session.commit()


async def _set_cap(session: AsyncSession, world: World, cap: int | None) -> None:
    with tenancy_disabled():
        org = await session.get(Organization, world.org_id)
        assert org is not None
        org.ai_daily_proposal_cap = cap
        await session.commit()


async def _status(client: AsyncClient, world: World, headers: dict[str, str] | None = None):
    response = await client.get(
        f"/v1/events/{world.event.id}/ai/status", headers=headers or world.admin
    )
    return response


async def _ok(client: AsyncClient, world: World) -> dict[str, object]:
    response = await _status(client, world)
    assert response.status_code == 200, response.text
    body: dict[str, object] = response.json()
    return body


async def test_the_count_shown_is_the_count_the_cap_enforces(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """A screen reading 3/5 while the fourth request is refused is worse than no
    screen. Both numbers come from the same two helpers."""
    await _set_cap(session, world, 5)
    await _spent_today(session, world, 3)

    body = await _ok(client, world)

    assert (body["used_today"], body["daily_cap"]) == (3, 5)
    usage = await proposals.usage_today(session, org_id=world.org_id)
    assert (usage.used, usage.cap) == (3, 5)


async def test_yesterdays_questions_are_not_todays_spend(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    await _set_cap(session, world, 5)
    await _spent_today(session, world, 2)
    with tenancy_disabled():
        session.add(
            AiProposal(
                org_id=world.org_id,
                event_id=world.event.id,
                kind=AiProposalKind.ANSWER,
                status=AiProposalStatus.READY,
                input={},
                output={},
                created_at=_yesterday(),
            )
        )
        await session.commit()

    assert (await _ok(client, world))["used_today"] == 2


async def test_an_uncapped_org_reports_no_ceiling_rather_than_zero(
    client: AsyncClient, session: AsyncSession, world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    """None and 0 are opposite facts — uncapped versus AI switched off — and one
    line of text has to tell them apart."""
    monkeypatch.setattr(get_settings(), "ai_daily_proposal_cap", 0, raising=False)
    await _set_cap(session, world, None)

    body = await _ok(client, world)

    assert body["daily_cap"] is None
    assert body["ai_disabled"] is False


async def test_an_org_cap_of_zero_reports_ai_switched_off(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    await _set_cap(session, world, 0)

    body = await _ok(client, world)

    assert (body["daily_cap"], body["ai_disabled"]) == (0, True)


# ─────────────────────────── who may read it ───────────────────────────


async def test_the_orgs_configured_provider_is_named(
    client: AsyncClient, session: AsyncSession, world: World, no_model_configured: None
) -> None:
    with tenancy_disabled():
        org = await session.get(Organization, world.org_id)
        assert org is not None
        org.ai_key_encrypted = seal(ORG_KEY)
        org.ai_provider = "meta"
        org.ai_model = "muse-spark-1.2-contributor"
        await session.commit()

    body = await _ok(client, world)

    assert body["provider_label"] == "Meta Muse Spark"
    assert body["model"] == "muse-spark-1.2-contributor"
    assert (body["source"], body["is_stub"]) == ("org", False)
    # The point of the whole panel: no part of the key comes back out.
    assert ORG_KEY not in str(body)


async def test_with_nothing_configured_it_says_so(
    client: AsyncClient, world: World, no_model_configured: None
) -> None:
    body = await _ok(client, world)

    assert body["is_stub"] is True
    assert body["source"] == "none"
    assert body["provider_label"] == "No model configured"


async def test_a_reviewer_is_not_shown_the_organisations_spend(
    client: AsyncClient, world: World
) -> None:
    """Same gate as the assistant itself: a reviewer has no business with the
    org's provider or its bill."""
    response = await _status(client, world, headers=world.reviewer)

    assert response.status_code == 403


async def test_an_unauthenticated_caller_gets_nothing(client: AsyncClient, world: World) -> None:
    response = await client.get(f"/v1/events/{world.event.id}/ai/status")

    assert response.status_code == 401


async def test_the_status_of_another_orgs_event_is_not_readable(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """The tenancy spine, checked at a new route rather than assumed from it."""
    from app.models import Event, EventStatus

    with tenancy_disabled():
        other_org = Organization(name="Other Org", slug=f"other-{uuid.uuid4().hex[:8]}")
        session.add(other_org)
        await session.flush()
        stranger_event = Event(
            org_id=other_org.id,
            name="Someone Else Conf",
            slug=f"stranger-{uuid.uuid4().hex[:8]}",
            timezone="UTC",
            starts_on=datetime(2027, 7, 1).date(),
            ends_on=datetime(2027, 7, 2).date(),
            status=EventStatus.IN_REVIEW,
        )
        session.add(stranger_event)
        await session.commit()

    response = await client.get(f"/v1/events/{stranger_event.id}/ai/status", headers=world.admin)

    assert response.status_code in (403, 404)
