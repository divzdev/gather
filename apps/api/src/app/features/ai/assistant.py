"""The event assistant: question in, plan, real queries, prose out.

Split out of `service.py` by use case rather than by helper, as the architecture
rules require once a service outgrows one file.

Two things make this module unusual, and both come from the same constraint.
It is consumed by an SSE route, so it **owns its own database sessions** rather
than being handed one: a `yield` dependency would pin an asyncpg connection for
the length of two model calls. Every database access below therefore opens a
short session, commits, and closes it *before* anything talks to a model.

The other is that a model's output is treated exactly like a request body from
the internet. A plan naming a query that does not exist, or passing arguments
that do not fit, is an ordinary Tuesday — that entry is dropped and the rest of
the plan runs. Only a reply we cannot read at all fails the proposal.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import db
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.tenancy import tenant_scope
from app.features.ai import catalog, prompts, proposals
from app.features.ai.adapters.base import Completion, LLMAdapter
from app.features.ai.gateway import OrgAiConfig, select_adapter
from app.features.ai.service import _org_ai
from app.models import AiProposalKind, AiProposalStatus

logger = logging.getLogger(__name__)

__all__ = ["MAX_HISTORY", "MAX_QUERIES", "AskRequest", "Plan", "Turn", "answer"]

#: A plan may name at most this many queries. A greedy plan is trimmed rather
#: than refused: three real answers beat one error about asking for five.
MAX_QUERIES = 3

#: Turns of conversation carried into the planner. Six is two or three
#: exchanges, which is what a follow-up ever reaches back to; without a bound,
#: a long session grows the prompt until it hits the token cap.
MAX_HISTORY = 6


class Turn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(max_length=2000)


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=1000)
    history: list[Turn] = Field(default_factory=list, max_length=40)


class PlannedQuery(BaseModel):
    #: Not `extra="forbid"`: a model that decorates its plan with a stray field
    #: has still told us which query it wants, and throwing the whole answer
    #: away over that would be pedantry the user pays for.
    name: str
    args: dict[str, Any] = Field(default_factory=dict)


class Plan(BaseModel):
    queries: list[PlannedQuery] = Field(default_factory=list)
    clarify: str | None = None
    refusal: str | None = None


def _transcript(history: list[Turn], question: str, today: date) -> str:
    recent = history[-MAX_HISTORY:]
    lines = [f"Today is {today.isoformat()}.", ""]
    if recent:
        lines.append("Recent conversation:")
        lines += [f"{turn.role}: {turn.content}" for turn in recent]
        lines.append("")
    lines.append(f"Question: {question}")
    return "\n".join(lines)


def _plan_request(history: list[Turn], question: str, today: date) -> str:
    catalogue = json.dumps(catalog.describe(), indent=1)
    return f"Catalog of available queries:\n{catalogue}\n\n{_transcript(history, question, today)}"


def _prose_request(
    history: list[Turn], question: str, today: date, results: list[dict[str, Any]]
) -> str:
    return (
        f"{_transcript(history, question, today)}\n\n"
        f"Rows returned:\n{json.dumps(results, indent=1, default=str)}"
    )


async def _run_plan(
    event_id: uuid.UUID, org_id: uuid.UUID, plan: Plan
) -> tuple[list[str], list[dict[str, Any]]]:
    """Execute the plan's surviving queries in one short session.

    Dropping rather than raising is deliberate: the planner is a language model,
    and a plan that names one good query and one hallucinated one should answer
    the good one.
    """
    ran: list[str] = []
    results: list[dict[str, Any]] = []
    #: Keyed on name *and* arguments: a small model will happily ask for
    #: `submissions_by` three times (observed with llama3.1:8b), while two days
    #: of `sessions_in_window` is a legitimate plan rather than a repeat.
    seen: set[str] = set()
    async with _scoped(event_id, org_id) as session:
        for planned in plan.queries:
            signature = f"{planned.name}:{sorted(planned.args.items())}"
            if signature in seen:
                continue
            seen.add(signature)
            if len(ran) >= MAX_QUERIES:
                break
            try:
                rows = await catalog.run(session, planned.name, planned.args)
            except (catalog.UnknownQueryError, catalog.BadArgsError):
                continue
            ran.append(planned.name)
            results.append({"query": planned.name, "result": rows})
    return ran, results


def _is_readable(prose: str) -> bool:
    """Whether what came back is an answer a person can read.

    A small model can carry JSON mode over from the planning call and reply
    `{}`. Rendering that as the answer is worse than admitting the call failed,
    because braces on screen look like the product is broken rather than like
    the model was.
    """
    stripped = _unfenced(prose)
    if stripped == "":
        return False
    if stripped[0] not in "{[":
        return True
    try:
        # `raw_decode`, not `loads`: a model that writes `{"answer": "..."}` and
        # then adds "Hope that helps." has still answered in JSON, and checking
        # only the last character lets that through.
        json.JSONDecoder().raw_decode(stripped)
    except ValueError:
        return True  # prose that merely starts with a brace
    return False


def _unfenced(text: str) -> str:
    """Strip a markdown code fence, which is how a chatty model dresses JSON."""
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped
    body = stripped[3:]
    if "\n" in body:
        _, body = body.split("\n", 1)
    return body.removesuffix("```").strip()


@dataclass(frozen=True, slots=True)
class _Ledger:
    """The row this question is being recorded against, and where it lives.

    These three travel together everywhere below; passing them as three
    arguments through four functions was a data clump waiting to be mistyped.
    """

    event_id: uuid.UUID
    org_id: uuid.UUID
    proposal_id: uuid.UUID


@asynccontextmanager
async def _scoped(event_id: uuid.UUID, org_id: uuid.UUID) -> AsyncIterator[AsyncSession]:
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


async def _open(
    event_id: uuid.UUID, org_id: uuid.UUID, user_id: uuid.UUID, question: str
) -> tuple[_Ledger, OrgAiConfig | None]:
    """Check the cap, open the proposal row, read the org's model config.

    All of it before a model is involved, and all of it committed and closed
    before this returns — nothing here may still be open when the first call
    goes out.
    """
    async with _scoped(event_id, org_id) as session:
        await proposals.assert_within_daily_cap(session, event_id=event_id)
        proposal = await proposals.create(
            session,
            kind=AiProposalKind.ANSWER,
            payload={"question": question, "prose_prompt": prompts.ASK_PROSE},
            prompt_version=prompts.ASK_PLAN,
            user_id=user_id,
        )
        org = await _org_ai(session)
        return _Ledger(event_id, org_id, proposal.id), org


async def _close(
    ledger: _Ledger, *, output: dict[str, Any], reasoning: str, completion: Completion
) -> None:
    """Resolve the row as answered.

    `completion.usage` is the *planning* call's only. `LLMAdapter.stream` yields
    bare strings, so the prose call — the larger prompt of the two — reports no
    usage through the interface as it stands. Recording half the cost silently
    would be worse than saying so: see spec 0005's Deviations.
    """
    async with _scoped(ledger.event_id, ledger.org_id) as session:
        proposal = await proposals.get(session, ledger.proposal_id)
        await proposals.record(
            session,
            proposal,
            output={**output, "usage_covers": "planning call only"},
            reasoning=reasoning,
            model=completion.model,
            usage=completion.usage,
        )


async def _abandon(ledger: _Ledger, reason: str) -> None:
    async with _scoped(ledger.event_id, ledger.org_id) as session:
        proposal = await proposals.get(session, ledger.proposal_id)
        await proposals.fail(session, proposal, reason=reason)


async def _never_strand(ledger: _Ledger) -> None:
    """Resolve the row if nothing else did.

    Runs in a `finally`, so it covers the paths no `except` can: the reader
    closing the tab, which throws `GeneratorExit` into this generator mid-token,
    and task cancellation. A row left saying `streaming` forever is worse than a
    failed one — it also counts against the daily cap, so a handful of abandoned
    tabs would silently eat an organisation's budget for the day.
    """
    try:
        async with _scoped(ledger.event_id, ledger.org_id) as session:
            proposal = await proposals.get(session, ledger.proposal_id)
            if proposal.status is AiProposalStatus.STREAMING:
                await proposals.fail(session, proposal, reason="The answer was interrupted.")
    except Exception:
        logger.warning("could not resolve stranded proposal %s", ledger.proposal_id, exc_info=True)


async def _aside(
    ledger: _Ledger, planning: Completion, *, kind: str, key: str, text: str
) -> tuple[str, dict[str, Any]]:
    """Asking back, or declining. Both resolve the row and end the stream, and
    neither costs the second model call."""
    await _close(
        ledger,
        output={kind: text, "is_stub": planning.is_stub},
        reasoning=text,
        completion=planning,
    )
    return kind, {key: text, "is_stub": planning.is_stub}


async def answer(
    *,
    event_id: uuid.UUID,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    request: AskRequest,
    adapter: LLMAdapter | None = None,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """One question, answered. Yields `(event, payload)` for the SSE route to write.

    The sequence is `planning` → `queries` → `token`… → `done`, or one of the
    three terminal alternatives: `clarify`, `refusal`, `error`. Every path
    resolves the proposal row exactly once.
    """
    settings = get_settings()
    today = datetime.now(UTC).date()
    yield "planning", {}

    try:
        ledger, org = await _open(event_id, org_id, user_id, request.question)
    except ApiError as error:
        # The cap and the tenancy guard both land here. There is no row to fail
        # yet, which is the point of checking before opening one.
        yield "error", {"message": error.message}
        return

    llm = adapter or select_adapter(org=org)
    try:
        async for event in _answer(ledger, llm, request, today, settings.ai_max_tokens):
            yield event
    except ApiError as error:
        await _abandon(ledger, error.message)
        yield "error", {"message": error.message}
    except Exception:
        # A provider raising a socket error, a query raising on a schema it did
        # not expect — neither is an ApiError, and both used to escape leaving
        # the row saying it was still streaming.
        await _abandon(ledger, "The assistant could not finish that answer.")
        yield "error", {"message": "The assistant could not finish that answer."}
        raise
    finally:
        await _never_strand(ledger)


async def _answer(
    ledger: _Ledger,
    llm: LLMAdapter,
    request: AskRequest,
    today: date,
    max_tokens: int,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """The answer itself, once the row is open. Split out so `answer()` can wrap
    every path in one place and guarantee the row is resolved."""
    try:
        planning = await llm.complete(
            system=prompts.load(prompts.ASK_PLAN),
            user=_plan_request(request.history, request.question, today),
            max_tokens=max_tokens,
        )
        plan = proposals.parse(planning.text, Plan)
    except ApiError as error:
        await _abandon(ledger, error.message)
        yield "error", {"message": error.message}
        return

    if plan.clarify:
        yield await _aside(ledger, planning, kind="clarify", key="question", text=plan.clarify)
        return
    # Not `and not plan.queries`: a model that declines *and* names queries has
    # still declined, and running them anyway spends a second call writing prose
    # about rows it already said were beside the point.
    if plan.refusal:
        yield await _aside(ledger, planning, kind="refusal", key="message", text=plan.refusal)
        return

    ran, results = await _run_plan(ledger.event_id, ledger.org_id, plan)
    yield "queries", {"names": ran}

    prose = ""
    try:
        async for chunk in llm.stream(
            system=prompts.load(prompts.ASK_PROSE),
            user=_prose_request(request.history, request.question, today, results),
            max_tokens=max_tokens,
        ):
            prose += chunk
            yield "token", {"text": chunk}
    except ApiError as error:
        await _abandon(ledger, error.message)
        yield "error", {"message": error.message}
        return

    if not _is_readable(prose):
        # The tokens have already gone out; the client drops them when an error
        # arrives, which is the right trade. Buffering the whole answer to check
        # it first would cost the streaming this feature exists to have.
        reason = "The model replied with data instead of an answer. Try asking again."
        await _abandon(ledger, reason)
        yield "error", {"message": reason}
        return

    await _close(
        ledger,
        output={"answer": prose, "queries": ran, "is_stub": planning.is_stub},
        reasoning=prose,
        completion=planning,
    )
    yield (
        "done",
        {"proposal_id": str(ledger.proposal_id), "queries": ran, "is_stub": planning.is_stub},
    )
