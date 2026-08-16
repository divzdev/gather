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
import time
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.config import get_settings
from app.core.errors import ApiError
from app.features.ai import catalog, prompts, proposals, write_catalog
from app.features.ai.adapters.base import LLMAdapter
from app.features.ai.gateway import describe_choice, select_adapter
from app.features.ai.ledger import Ledger, abandon, aside, close, never_strand, open_row, scoped
from app.features.ai.propose import propose

logger = logging.getLogger(__name__)

__all__ = ["MAX_HISTORY", "MAX_QUERIES", "AskRequest", "Plan", "Turn", "answer"]

#: A plan may name at most this many queries. A greedy plan is trimmed rather
#: than refused: three real answers beat one error about asking for five.
MAX_QUERIES = 3

#: Turns of conversation carried into the planner. Six is two or three
#: exchanges, which is what a follow-up ever reaches back to; without a bound,
#: a long session grows the prompt until it hits the token cap.
MAX_HISTORY = 6

#: A ceiling on the planning call, not a diet. Set to 400 first — on the theory
#: that a plan naming three queries is thirty tokens — and it broke: real plans
#: from muse-spark ran 639 to 860 tokens, so the JSON was truncated mid-object
#: and every question came back "the model returned an empty answer".
#:
#: The lesson is that a cap cannot make a model terse, only cut it off. Latency
#: comes from the input side (the catalog block, trimmed) and from the two calls
#: being sequential. This is now only a runaway guard, well clear of anything
#: observed.
PLAN_MAX_TOKENS = 1500

#: The resolution call answers with one name or `null`, so this is a runaway
#: guard rather than a budget. Kept well clear of PLAN_MAX_TOKENS on purpose:
#: this call exists to be cheaper than interrupting somebody.
RESOLVE_MAX_TOKENS = 200

#: How many cards one question may draw. Deliberately the same number
#: `ApplyRequest.indexes` accepts: a plan that drew 30 cards produced an
#: "Apply all 30" the route then rejected outright, and the drawer marked every
#: card failed. A cap the screen can exceed is not a cap.


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


class PlannedAction(BaseModel):
    """One proposed change, as the model wrote it. Same latitude as
    `PlannedQuery`: decoration is tolerated, meaning is validated later."""

    name: str
    #: The existing row in the organiser's own words. Absent on a create.
    target: str | None = None
    values: dict[str, Any] = Field(default_factory=dict)


class Plan(BaseModel):
    queries: list[PlannedQuery] = Field(default_factory=list)
    actions: list[PlannedAction] = Field(default_factory=list)
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
    queries = json.dumps(catalog.describe(), indent=1)
    actions = json.dumps(write_catalog.describe(), indent=1)
    return (
        f"Catalog of available queries:\n{queries}\n\n"
        f"Catalog of proposable actions:\n{actions}\n\n"
        f"{_transcript(history, question, today)}"
    )


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
    async with scoped(event_id, org_id) as session:
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
    started = time.monotonic()
    yield "planning", {}

    try:
        ledger, org = await open_row(event_id, org_id, user_id, request.question)
    except ApiError as error:
        # The cap and the tenancy guard both land here. There is no row to fail
        # yet, which is the point of checking before opening one.
        yield "error", {"message": error.message}
        return

    llm = adapter or select_adapter(org=org)
    # Named before either call goes out, so the line under the composer is
    # filled in *during* the wait — "is this thing still on the local llama?"
    # is a question asked at second three, not after the answer lands. The model
    # comes off the adapter rather than the org config so an injected adapter
    # cannot be misreported; the provider label has no adapter to come from.
    choice = describe_choice(org=org)
    yield "model", {"name": llm.model, "provider": choice.label, "is_stub": choice.is_stub}
    try:
        async for event in _answer(ledger, llm, request, today, settings.ai_max_tokens, started):
            yield event
    except ApiError as error:
        await abandon(ledger, error.message)
        yield "error", {"message": error.message}
    except Exception:
        # A provider raising a socket error, a query raising on a schema it did
        # not expect — neither is an ApiError, and both used to escape leaving
        # the row saying it was still streaming.
        await abandon(ledger, "The assistant could not finish that answer.")
        yield "error", {"message": "The assistant could not finish that answer."}
        raise
    finally:
        await never_strand(ledger)


async def _answer(
    ledger: Ledger,
    llm: LLMAdapter,
    request: AskRequest,
    today: date,
    max_tokens: int,
    started: float,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """The answer itself, once the row is open. Split out so `answer()` can wrap
    every path in one place and guarantee the row is resolved."""
    try:
        planning = await llm.complete(
            system=prompts.load(prompts.ASK_PLAN),
            user=_plan_request(request.history, request.question, today),
            max_tokens=min(PLAN_MAX_TOKENS, max_tokens),
        )
        plan = proposals.parse(planning.text, Plan)
    except ApiError as error:
        await abandon(ledger, error.message)
        yield "error", {"message": error.message}
        return

    if plan.clarify:
        yield await aside(
            ledger, planning, kind="clarify", key="question", text=plan.clarify, started=started
        )
        return
    # Not `and not plan.queries`: a model that declines *and* names queries has
    # still declined, and running them anyway spends a second call writing prose
    # about rows it already said were beside the point.
    if plan.refusal:
        yield await aside(
            ledger, planning, kind="refusal", key="message", text=plan.refusal, started=started
        )
        return

    # Actions first, and exclusively (story 36). The organiser is about to be
    # shown something to approve; running queries underneath that would make half
    # the reply about a different question.
    if plan.actions:
        async for event in propose(ledger, llm, plan, planning, request.question, started):
            yield event
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
        await abandon(ledger, error.message)
        yield "error", {"message": error.message}
        return

    if not _is_readable(prose):
        # The tokens have already gone out; the client drops them when an error
        # arrives, which is the right trade. Buffering the whole answer to check
        # it first would cost the streaming this feature exists to have.
        reason = "The model replied with data instead of an answer. Try asking again."
        await abandon(ledger, reason)
        yield "error", {"message": reason}
        return

    await close(
        ledger,
        output={"answer": prose, "queries": ran, "is_stub": planning.is_stub},
        reasoning=prose,
        completion=planning,
    )
    yield (
        "done",
        {
            "proposal_id": str(ledger.proposal_id),
            "queries": ran,
            "is_stub": planning.is_stub,
            # Named so the person can see which model answered, and what it
            # cost — "very slow, is it still using the local one?" is not a
            # question anybody should have to read a database to answer.
            "model": planning.model,
            "usage": planning.usage,
            # Planning only: `stream()` yields bare strings and reports no
            # usage, so the prose call's tokens are not available here. The
            # screen says "plan" rather than implying this is the whole cost.
            "usage_covers": "plan",
            "elapsed_ms": round((time.monotonic() - started) * 1000),
        },
    )
