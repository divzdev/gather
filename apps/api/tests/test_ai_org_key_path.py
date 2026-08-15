"""The org key — spec 0003, seam 2: the AI request path.

Which key answers, and how much a day may cost. Precedence is observed at the
gateway (the one door to a model); the cap through the same service calls the
suggest endpoints make. Adapters are faked at the gateway boundary — the
provider module is the boundary, never our own service code.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from freezegun import freeze_time
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.crypto import seal
from app.core.errors import ApiError
from app.core.tenancy import tenancy_disabled
from app.features.ai import gateway, proposals, service
from app.features.ai.adapters.anthropic import AnthropicAdapter
from app.features.ai.adapters.ollama import OllamaAdapter
from app.features.ai.adapters.openai_compat import OpenAICompatAdapter
from app.features.ai.adapters.stub import StubAdapter
from app.features.ai.gateway import OrgAiConfig
from app.models import AiProposal, AiProposalKind, AiProposalStatus, Organization

# The event-in-review world, its helpers, and the zero-credential guard —
# reused rather than rebuilt (same pattern as test_event_members).
from test_ai import (  # noqa: F401
    Recorder,
    World,
    _answer,
    _criterion,
    _round,
    no_model_configured,
    world,
)

ORG_KEY = "sk-ant-org-0123456789abcdefQRST"


# ─────────────────────────── precedence at the gateway ───────────────────────────


def test_an_org_key_outranks_the_server_key(
    no_model_configured: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-server-key", raising=False)

    adapter = gateway.select_adapter(
        org=OrgAiConfig(provider="anthropic", api_key=ORG_KEY, model=None)
    )

    assert isinstance(adapter, AnthropicAdapter)
    # The decision under test *is* which credential was handed over.
    assert adapter._api_key == ORG_KEY


def test_every_openai_protocol_preset_builds_the_compat_adapter(
    no_model_configured: None,
) -> None:
    """One wire protocol covers OpenAI, Google, xAI, DeepSeek, Kimi, Groq and
    Together — the preset supplies its fixed base URL, the org supplies key and
    model. No preset may reach a URL the table does not name."""
    for name, preset in gateway.PROVIDERS.items():
        if preset.protocol != "openai":
            continue
        adapter = gateway.select_adapter(
            org=OrgAiConfig(provider=name, api_key=ORG_KEY, model="some-model")
        )
        assert isinstance(adapter, OpenAICompatAdapter), name
        assert adapter._base_url == (preset.base_url or "").rstrip("/")
        assert adapter._api_key == ORG_KEY
        assert adapter._model == "some-model"


def test_ollama_still_outranks_every_paid_key(
    no_model_configured: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "ollama_base_url", "http://localhost:11434", raising=False)

    adapter = gateway.select_adapter(
        org=OrgAiConfig(provider="openai", api_key=ORG_KEY, model="gpt-4o-mini")
    )

    assert isinstance(adapter, OllamaAdapter)


def test_no_key_anywhere_still_answers_with_the_stub(no_model_configured: None) -> None:
    assert isinstance(gateway.select_adapter(org=None), StubAdapter)


def test_the_server_key_keeps_working_when_no_org_key_exists(
    no_model_configured: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The self-hoster's env setup is additive, not a migration."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-server-key", raising=False)

    adapter = gateway.select_adapter(org=None)

    assert isinstance(adapter, AnthropicAdapter)
    assert adapter._api_key == "sk-ant-server-key"


# ─────────────────────── the sealed key reaches the model call ───────────────────


async def test_a_suggestion_runs_on_the_orgs_own_key(
    client: AsyncClient,
    session: AsyncSession,
    world: World,
    no_model_configured: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """End to end through the service: sealed at rest, unsealed per request,
    handed to the provider adapter — never to feature code."""
    with tenancy_disabled():
        org = await session.get(Organization, (await _event_org(session, world)))
        assert org is not None
        org.ai_key_encrypted = seal(ORG_KEY)
        org.ai_provider = "anthropic"
        await session.commit()

    handed: list[str] = []
    round_id = await _round(client, world)
    criterion_id = await _criterion(client, world, round_id, label="Relevance")

    class Capturing(Recorder):
        def __init__(self, *, api_key: str, model: str) -> None:
            super().__init__(_answer(criterion_id))
            handed.append(api_key)

    monkeypatch.setattr(gateway, "AnthropicAdapter", Capturing)

    proposal = await service.score_submission(
        session,
        event_id=world.event.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
    )

    assert handed == [ORG_KEY]
    assert proposal.status is AiProposalStatus.READY


async def _event_org(session: AsyncSession, world: World) -> uuid.UUID:
    with tenancy_disabled():
        refreshed = await session.get(type(world.event), world.event.id)
        assert refreshed is not None
        return refreshed.org_id


# ─────────────────────────── the org-wide daily cap ───────────────────────────


#: The frozen clock the cap tests run under, and the morning-of timestamp their
#: spent rows carry. Explicit `created_at` because freezegun freezes Python's
#: clock, not Postgres's server_default — without it the rows land at real now,
#: outside the frozen day, and the cap sees nothing.
FROZEN_DAY = "2027-03-03 12:00:00"
SPENT_AT = datetime(2027, 3, 3, 9, 0, tzinfo=UTC)


async def _spent_today(
    session: AsyncSession, org_id: uuid.UUID, event_id: uuid.UUID, n: int
) -> None:
    """Rows from earlier the same (frozen) day, written directly so the cap is
    observed at its checkpoint rather than recomputed the code's way."""
    with tenancy_disabled():
        for _ in range(n):
            session.add(
                AiProposal(
                    org_id=org_id,
                    event_id=event_id,
                    kind=AiProposalKind.SCORE,
                    status=AiProposalStatus.READY,
                    input={},
                    output={},
                    created_at=SPENT_AT,
                )
            )
        await session.commit()


@freeze_time(FROZEN_DAY)
async def test_the_cap_counts_the_whole_org_not_one_event(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """Two events, one org, one budget: spend on a sibling event exhausts the
    allowance here. One number means one ceiling on the bill."""
    org_id = await _event_org(session, world)
    with tenancy_disabled():
        org = await session.get(Organization, org_id)
        assert org is not None
        org.ai_daily_proposal_cap = 2
        sibling_event_id = uuid.uuid4()
        from app.models import Event, EventStatus

        session.add(
            Event(
                id=sibling_event_id,
                org_id=org_id,
                name="Sibling Conf",
                slug=f"sibling-{uuid.uuid4().hex[:8]}",
                timezone="UTC",
                starts_on=datetime(2027, 6, 1, tzinfo=UTC).date(),
                ends_on=datetime(2027, 6, 2, tzinfo=UTC).date(),
                status=EventStatus.IN_REVIEW,
            )
        )
        await session.commit()
    await _spent_today(session, org_id, sibling_event_id, 2)

    with pytest.raises(ApiError) as refusal:
        await proposals.assert_within_daily_cap(session, event_id=world.event.id)

    assert refusal.value.code == "AI_DAILY_CAP_REACHED"
    assert "2" in refusal.value.message


@freeze_time(FROZEN_DAY)
async def test_a_null_cap_falls_back_to_the_server_default(
    client: AsyncClient, session: AsyncSession, world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "ai_daily_proposal_cap", 1, raising=False)
    org_id = await _event_org(session, world)
    await _spent_today(session, org_id, world.event.id, 1)

    with pytest.raises(ApiError) as refusal:
        await proposals.assert_within_daily_cap(session, event_id=world.event.id)

    assert "1" in refusal.value.message


async def test_a_cap_of_zero_turns_ai_off_for_the_org(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """Zero is a choice, not an absence: the org said no spend, so the very
    first request is refused — unlike the server default, where <=0 has always
    meant uncapped and still does."""
    org_id = await _event_org(session, world)
    with tenancy_disabled():
        org = await session.get(Organization, org_id)
        assert org is not None
        org.ai_daily_proposal_cap = 0
        await session.commit()

    with pytest.raises(ApiError) as refusal:
        await proposals.assert_within_daily_cap(session, event_id=world.event.id)

    assert refusal.value.code == "AI_DISABLED_FOR_ORG"


@freeze_time(FROZEN_DAY)
async def test_an_org_cap_overrides_a_meaner_server_default(
    client: AsyncClient, session: AsyncSession, world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "ai_daily_proposal_cap", 1, raising=False)
    org_id = await _event_org(session, world)
    with tenancy_disabled():
        org = await session.get(Organization, org_id)
        assert org is not None
        org.ai_daily_proposal_cap = 5
        await session.commit()
    await _spent_today(session, org_id, world.event.id, 2)

    # Two spent against a cap of five: the org's own number governs.
    await proposals.assert_within_daily_cap(session, event_id=world.event.id)
