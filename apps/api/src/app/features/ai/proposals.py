"""The lifecycle of an AI suggestion: created, answered, then adopted or thrown away.

Every model result in this product lands here first, as a row, before anything
can act on it. That is the whole safety property: there is no code path where a
model's output reaches a domain table. Acceptance is a separate authenticated
request that calls the same service method the UI calls, with the same
validation, recorded against the human who accepted it.

The row is written *before* the model is called, so a dropped connection or a
provider timeout leaves evidence rather than nothing.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ApiError, NotFoundError
from app.core.tenancy import current_tenant, tenancy_disabled
from app.models import AiProposal, AiProposalKind, AiProposalStatus, Organization

#: Models are told to reply with bare JSON and mostly do, but a fenced block is
#: the most common deviation and is not worth failing a proposal over.
FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.S)


def _now() -> datetime:
    return datetime.now(UTC)


async def assert_within_daily_cap(session: AsyncSession, *, event_id: uuid.UUID) -> None:
    """Refuse once the *organization* has spent its allowance for the day.

    The per-user rate limit stops one person hammering the button. This stops
    twenty people each hammering it politely, which is the shape the public demo
    box is actually exposed to: `demo_logins_allowed` hands a staff session to
    anyone who asks.

    The count is org-wide, not per event (spec 0003): the daily proposal cap is
    a ceiling on a bill, the bill is per org, and one number that silently
    multiplies by the number of events is not a ceiling. The org's own cap wins
    when set; NULL falls back to the server default. Zero differs by owner —
    an org's 0 is a decision ("no spend") and turns AI off; the server
    default's <=0 has always meant uncapped and still does.
    """
    org_id = current_tenant().org_id
    with tenancy_disabled():
        org_cap: int | None = await session.scalar(
            select(Organization.ai_daily_proposal_cap).where(Organization.id == org_id)
        )
    if org_cap == 0:
        raise ApiError(
            "AI suggestions are turned off for this organisation — its daily "
            "cap is set to zero. An owner or admin can change that in Settings.",
            code="AI_DISABLED_FOR_ORG",
            status_code=429,
        )
    cap = org_cap if org_cap is not None else get_settings().ai_daily_proposal_cap
    if cap <= 0:
        return
    since = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    # Counted across every event the org runs, which the automatic tenancy
    # filter would forbid from inside one event's scope — hence the explicit,
    # greppable escape with its own org predicate (architecture.md: bulk/cross-
    # event reads carry their tenant filter by hand).
    with tenancy_disabled():
        used = await session.scalar(
            select(func.count(AiProposal.id)).where(
                AiProposal.org_id == org_id, AiProposal.created_at >= since
            )
        )
    if (used or 0) >= cap:
        raise ApiError(
            f"This organisation has used its {cap} AI suggestions for today. "
            "The limit resets at midnight UTC; an owner or admin can raise the "
            "cap in Settings.",
            code="AI_DAILY_CAP_REACHED",
            status_code=429,
        )


async def create(
    session: AsyncSession,
    *,
    kind: AiProposalKind,
    payload: dict[str, Any],
    prompt_version: str,
    user_id: uuid.UUID | None,
) -> AiProposal:
    """Open a proposal. Nothing has been asked of a model yet."""
    proposal = AiProposal(
        kind=kind,
        input={**payload, "prompt_version": prompt_version},
        output={},
        status=AiProposalStatus.STREAMING,
        created_by_user_id=user_id,
    )
    session.add(proposal)
    await session.flush()
    return proposal


def parse[TAnswer: BaseModel](text: str, schema: type[TAnswer]) -> TAnswer:
    """Turn a model's reply into a validated object, or say why it could not be.

    A model is allowed to be wrong, so this treats its output exactly like an
    untrusted request body. The failure has to carry a readable reason: it ends
    up on the proposal row and then on somebody's screen.
    """
    candidate = text.strip()
    fenced = FENCE.search(candidate)
    if fenced is not None:
        candidate = fenced.group(1).strip()
    if candidate == "":
        raise ApiError("The model returned an empty answer.", code="AI_BAD_ANSWER")

    try:
        raw = json.loads(candidate)
    except json.JSONDecodeError as error:
        raise ApiError(
            f"The model did not return JSON: {error.msg} at position {error.pos}.",
            code="AI_BAD_ANSWER",
        ) from error
    if not isinstance(raw, dict):
        raise ApiError(
            f"The model returned {type(raw).__name__}, not an object.", code="AI_BAD_ANSWER"
        )

    try:
        return schema.model_validate(raw)
    except ValidationError as error:
        first = error.errors()[0]
        where = ".".join(str(part) for part in first["loc"]) or "(root)"
        raise ApiError(
            f"The model's answer did not fit the expected shape at {where}: {first['msg']}.",
            code="AI_BAD_ANSWER",
        ) from error


async def record(
    session: AsyncSession,
    proposal: AiProposal,
    *,
    output: dict[str, Any],
    reasoning: str,
    model: str,
    usage: dict[str, int],
) -> AiProposal:
    proposal.output = output
    proposal.reasoning = reasoning or None
    proposal.model = model
    proposal.token_usage = dict(usage)
    proposal.status = AiProposalStatus.READY
    await session.flush()
    return proposal


async def fail(session: AsyncSession, proposal: AiProposal, *, reason: str) -> AiProposal:
    """Record why a proposal produced nothing usable.

    A failed proposal is kept rather than deleted. "The AI did nothing" and "the
    AI was asked and could not answer" are different facts, and only one of them
    is a bug worth chasing.
    """
    proposal.output = {"error": reason}
    proposal.status = AiProposalStatus.FAILED
    proposal.resolved_at = _now()
    await session.flush()
    return proposal


async def get(session: AsyncSession, proposal_id: uuid.UUID) -> AiProposal:
    proposal = await session.get(AiProposal, proposal_id)
    if proposal is None:
        raise NotFoundError("That AI suggestion no longer exists.")
    return proposal


async def resolve(
    session: AsyncSession, proposal: AiProposal, *, status: AiProposalStatus
) -> AiProposal:
    """Close a proposal out — accepted, partially accepted, or discarded."""
    proposal.status = status
    proposal.resolved_at = _now()
    await session.flush()
    return proposal
