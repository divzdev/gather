"""The proposal row, and the short-lived sessions that touch it.

Every question the assistant answers opens one `ai_proposals` row before a model
is called, and exactly one path closes it. That is the whole safety property of
the feature — a dropped connection or a provider timeout leaves evidence rather
than nothing — and it is why this is a module rather than a handful of helpers
inside the orchestration.

`scoped` is the other reason. This code is consumed by an SSE route, so it owns
its own sessions: a `yield` dependency would pin an asyncpg connection for the
length of two model calls. Every database touch in the assistant goes through
here, opens short, and closes **before** anything talks to a model.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import db
from app.core.tenancy import tenant_scope
from app.features.ai import prompts, proposals
from app.features.ai.adapters.base import Completion
from app.features.ai.gateway import OrgAiConfig
from app.features.ai.service import org_ai
from app.models import AiProposalKind, AiProposalStatus, Event

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Ledger:
    """The row this question is being recorded against, and where it lives.

    These three travel together everywhere below; passing them as three
    arguments through four functions was a data clump waiting to be mistyped.
    """

    event_id: uuid.UUID
    org_id: uuid.UUID
    proposal_id: uuid.UUID
    #: Read once when the row is opened, so every card can name where it lands
    #: without another query per action.
    event_name: str = ""


@asynccontextmanager
async def scoped(event_id: uuid.UUID, org_id: uuid.UUID) -> AsyncIterator[AsyncSession]:
    """A short, tenant-bound session that is closed before the next model call.

    Every database touch in this module goes through here. The pattern appeared
    four times before it was worth a helper, and the risk it removes is real: a
    session opened without `tenant_scope` raises on the first query, which is
    the tenancy guard working, but only after the request has already spent a
    model call getting there.
    """
    async with db.session_factory() as session, session.begin():
        with tenant_scope(org_id=org_id, event_id=event_id):
            yield session


async def open_row(
    event_id: uuid.UUID, org_id: uuid.UUID, user_id: uuid.UUID, question: str
) -> tuple[Ledger, OrgAiConfig | None]:
    """Check the cap, open the proposal row, read the org's model config.

    All of it before a model is involved, and all of it committed and closed
    before this returns — nothing here may still be open when the first call
    goes out.
    """
    async with scoped(event_id, org_id) as session:
        await proposals.assert_within_daily_cap(session, event_id=event_id)
        proposal = await proposals.create(
            session,
            kind=AiProposalKind.ANSWER,
            payload={"question": question, "prose_prompt": prompts.ASK_PROSE},
            prompt_version=prompts.ASK_PLAN,
            user_id=user_id,
        )
        org = await org_ai(session)
        event = await session.get(Event, event_id)
        return Ledger(event_id, org_id, proposal.id, event.name if event else ""), org


async def close(
    ledger: Ledger,
    *,
    output: dict[str, Any],
    reasoning: str,
    completion: Completion,
    kind: AiProposalKind | None = None,
) -> None:
    """Resolve the row as answered.

    `completion.usage` is the *planning* call's only. `LLMAdapter.stream` yields
    bare strings, so the prose call — the larger prompt of the two — reports no
    usage through the interface as it stands. Recording half the cost silently
    would be worse than saying so: see spec 0005's Deviations.
    """
    async with scoped(ledger.event_id, ledger.org_id) as session:
        proposal = await proposals.get(session, ledger.proposal_id)
        if kind is not None:
            # The row is opened before the model is called, when nothing yet
            # knows whether this is a question or a change. It is stamped here,
            # where the plan has been read — the alternative is two rows or a
            # guess, and the cap counts rows.
            proposal.kind = kind
        await proposals.record(
            session,
            proposal,
            output={**output, "usage_covers": "planning call only"},
            reasoning=reasoning,
            model=completion.model,
            usage=completion.usage,
        )


async def abandon(ledger: Ledger, reason: str) -> None:
    async with scoped(ledger.event_id, ledger.org_id) as session:
        proposal = await proposals.get(session, ledger.proposal_id)
        await proposals.fail(session, proposal, reason=reason)


async def never_strand(ledger: Ledger) -> None:
    """Resolve the row if nothing else did.

    Runs in a `finally`, so it covers the paths no `except` can: the reader
    closing the tab, which throws `GeneratorExit` into this generator mid-token,
    and task cancellation. A row left saying `streaming` forever is worse than a
    failed one — it also counts against the daily cap, so a handful of abandoned
    tabs would silently eat an organisation's budget for the day.
    """
    try:
        async with scoped(ledger.event_id, ledger.org_id) as session:
            proposal = await proposals.get(session, ledger.proposal_id)
            if proposal.status is AiProposalStatus.STREAMING:
                await proposals.fail(session, proposal, reason="The answer was interrupted.")
    except Exception:
        logger.warning("could not resolve stranded proposal %s", ledger.proposal_id, exc_info=True)


async def aside(
    ledger: Ledger,
    planning: Completion,
    *,
    kind: str,
    key: str,
    text: str,
    started: float,
) -> tuple[str, dict[str, Any]]:
    """Asking back, or declining. Both resolve the row and end the stream, and
    neither costs the second model call."""
    await close(
        ledger,
        output={kind: text, "is_stub": planning.is_stub},
        reasoning=text,
        completion=planning,
    )
    # Same provenance as `done`. A refusal is still a model answering, and
    # "which model told me it could not do that" is the same question.
    return kind, {
        key: text,
        "is_stub": planning.is_stub,
        "model": planning.model,
        "usage": planning.usage,
        "usage_covers": "plan",
        "elapsed_ms": round((time.monotonic() - started) * 1000),
    }
