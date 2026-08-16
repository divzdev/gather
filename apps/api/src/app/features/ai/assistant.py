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
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import crud, db
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.tenancy import tenant_scope
from app.features.ai import catalog, prompts, proposals, write_catalog
from app.features.ai.adapters.base import Completion, LLMAdapter
from app.features.ai.gateway import OrgAiConfig, describe_choice, select_adapter
from app.features.ai.service import org_ai
from app.models import AiProposalKind, AiProposalStatus, Event

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
MAX_ACTIONS = 25


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


class Match(BaseModel):
    """The resolution call's whole vocabulary: one name, or nothing."""

    match: str | None = None


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


def _resolve_request(wanted: str, noun: str, offered: list[str]) -> str:
    """Everything the resolution call gets: the words, the noun, the names.

    No ids, no other columns, no history — history is where a stray primary key
    would most easily arrive, and choosing between names needs none of it.
    """
    listed = "\n".join(f"- {name}" for name in offered)
    return f'They said: "{wanted}"\n\nThe {noun}s that exist:\n{listed}'


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


def _describe_values(values: BaseModel) -> dict[str, Any]:
    """Only the fields that were actually given.

    The card shows what will be set, so a create described by name alone shows a
    name and nothing else — not a screenful of defaults nobody asked for
    (story 11).
    """
    described: dict[str, Any] = json.loads(values.model_dump_json(exclude_unset=True))
    return described


@dataclass(slots=True)
class _Proposed:
    """What one plan turned into: cards to press, and questions for the ones that
    could not be worked out.

    Both together, never one or the other. An unresolvable edit used to abandon
    the whole reply, throwing away creates that were already built beside it —
    "add Studio and make the big room bigger" answered nothing at all.
    """

    cards: list[dict[str, Any]] = field(default_factory=list)
    questions: list[str] = field(default_factory=list)


async def _plan_actions(
    ledger: _Ledger, llm: LLMAdapter, plan: Plan
) -> AsyncIterator[tuple[str, dict[str, Any]] | _Proposed]:
    """Turn the model's actions into cards, asking a model — then a human — when
    a target does not resolve.

    Yields SSE events as it goes and finishes by yielding the result, so the
    caller can stream `resolving` without this needing to know about SSE.

    **No database session is open across the model call**, which the two short
    `_scoped` blocks below exist to guarantee. The first cut wrapped the whole
    loop body in one session and called `_ask_which` inside it: an asyncpg
    connection and an idle-in-transaction Postgres session pinned for the length
    of a model round trip, against the rule this module's own docstring cites.
    It also meant a `yield` from inside the block, so a caller that stopped
    reading abandoned the generator mid-session and left the tenant ContextVar
    token unreset.
    """
    found_so_far = _Proposed()
    for planned in plan.actions:
        if len(found_so_far.cards) >= MAX_ACTIONS:
            # Bounded to what `ApplyRequest` will accept, so a greedy plan can
            # never draw a card that "Apply all" would then be refused for.
            break
        try:
            parsed = write_catalog.parse(
                planned.name, {"target": planned.target, "values": planned.values}
            )
        except (write_catalog.UnknownActionError, write_catalog.BadArgsError):
            # An invented action, or values the resource would refuse. Dropped
            # exactly as an unknown read query is: the rest of the plan stands.
            continue

        if parsed.action.verb == "create":
            found_so_far.cards.append(_card(len(found_so_far.cards), ledger, parsed))
            continue

        if parsed.target is None:  # pragma: no cover - `parse` refuses one
            continue

        async with _scoped(ledger.event_id, ledger.org_id) as session:
            found = await write_catalog.resolve(session, parsed.action.spec, parsed.target)

        if found.target is None and found.candidates:
            yield "resolving", {"target": parsed.target}
            found = await _ask_which(llm, parsed, found)

        if found.target is None:
            found_so_far.questions.append(_which(parsed, found))
            continue

        async with _scoped(ledger.event_id, ledger.org_id) as session:
            row = await crud.get_resource(session, parsed.action.spec, found.target.id)
            before = crud.previous_values(row, parsed.values)
        found_so_far.cards.append(
            _card(
                len(found_so_far.cards),
                ledger,
                parsed,
                target=found.target.label,
                before=before,
            )
        )
    yield found_so_far


async def _propose(
    ledger: _Ledger,
    llm: LLMAdapter,
    plan: Plan,
    planning: Completion,
    question: str,
    started: float,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """The write half of an answer: cards to press, or a reason there are none.

    Its own function rather than a branch inside `_answer`, which was 135 lines
    and four levels deep by the time this was inline.
    """
    proposed = _Proposed()
    async for step in _plan_actions(ledger, llm, plan):
        if isinstance(step, _Proposed):
            proposed = step
        else:
            yield step

    if not proposed.cards:
        # Nothing survived. An empty card is worse than a sentence — it looks
        # like something to press — so this ends in words. The questions come
        # first when there are any: "which room did you mean" is a better reply
        # than "none of that is something I can change".
        reason = (
            " ".join(proposed.questions)
            if proposed.questions
            else "None of that is something I can change here."
        )
        kind = "clarify" if proposed.questions else "refusal"
        key = "question" if proposed.questions else "message"
        yield await _aside(ledger, planning, kind=kind, key=key, text=reason, started=started)
        return

    await _close(
        ledger,
        output={
            "actions": proposed.cards,
            "questions": proposed.questions,
            "is_stub": planning.is_stub,
        },
        reasoning=question,
        completion=planning,
        kind=AiProposalKind.PROGRAM_CHANGE,
    )
    yield (
        "proposal",
        {
            "proposal_id": str(ledger.proposal_id),
            "actions": proposed.cards,
            # Cards *and* questions: an unresolvable edit beside two good creates
            # used to throw all three away.
            "questions": proposed.questions,
            "is_stub": planning.is_stub,
            "model": planning.model,
            "usage": planning.usage,
            "usage_covers": "plan",
            "elapsed_ms": round((time.monotonic() - started) * 1000),
        },
    )


async def _ask_which(
    llm: LLMAdapter, parsed: write_catalog.Parsed, found: write_catalog.Resolution
) -> write_catalog.Resolution:
    """One small call: their words, the names that exist, one name or nothing back.

    A name that is not on the list counts as nothing. A model that answers
    "Main Hall" when no Main Hall exists has not chosen — it has invented — and
    the nearest-looking row is not a safe consolation.
    """
    offered = write_catalog.offer(found.candidates)
    try:
        reply = await llm.complete(
            system=prompts.load(prompts.ASK_RESOLVE),
            user=_resolve_request(parsed.target or "", parsed.action.spec.singular, offered),
            max_tokens=RESOLVE_MAX_TOKENS,
        )
        chosen = proposals.parse(reply.text, Match).match
    except ApiError:
        # A failed resolution is not a failed question: fall through to asking
        # the human, which is where this was heading anyway.
        return found
    for candidate in found.candidates:
        if chosen is not None and candidate.label == chosen:
            return write_catalog.Resolution(target=candidate, candidates=found.candidates)
    return found


def _which(parsed: write_catalog.Parsed, found: write_catalog.Resolution) -> str:
    """The question asked when nothing resolved. Names what exists, because the
    organiser's next message is going to be one of those names."""
    noun = parsed.action.spec.singular
    offered = write_catalog.offer(found.candidates)
    if not offered:
        return (
            f"This event has no {noun}s yet, so there is nothing named {parsed.target!r} to change."
        )
    return f"Which {noun} did you mean — {', '.join(offered)}?"


def _card(
    index: int,
    ledger: _Ledger,
    parsed: write_catalog.Parsed,
    *,
    target: str | None = None,
    before: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        # The position in the *surviving* list, which is what the apply route
        # indexes. It used to be the position in the model's plan, so one dropped
        # action shifted every card after it and pressing Create on "Alpha"
        # created "Beta" — the worst failure this feature could have, and
        # invisible from the screen.
        "index": index,
        # Story 2: a card read ten minutes later still says where the row lands.
        "event": ledger.event_name,
        "name": parsed.action.name,
        "verb": parsed.action.verb,
        "resource": parsed.action.spec.singular,
        # The setup screens key their queries on exactly this string, so a card
        # carries what the drawer needs to refresh them and the frontend needs
        # no table mapping "room" to "rooms" — one more place to drift.
        "collection": parsed.action.spec.plural,
        "target": target,
        "before": json.loads(json.dumps(before or {}, default=str)),
        "values": _describe_values(parsed.values),
        "status": "proposed",
    }


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
    #: Read once when the row is opened, so every card can name where it lands
    #: without another query per action.
    event_name: str = ""


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
        org = await org_ai(session)
        event = await session.get(Event, event_id)
        return _Ledger(event_id, org_id, proposal.id, event.name if event else ""), org


async def _close(
    ledger: _Ledger,
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
    async with _scoped(ledger.event_id, ledger.org_id) as session:
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
    ledger: _Ledger,
    planning: Completion,
    *,
    kind: str,
    key: str,
    text: str,
    started: float,
) -> tuple[str, dict[str, Any]]:
    """Asking back, or declining. Both resolve the row and end the stream, and
    neither costs the second model call."""
    await _close(
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
        ledger, org = await _open(event_id, org_id, user_id, request.question)
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
        await _abandon(ledger, error.message)
        yield "error", {"message": error.message}
        return

    if plan.clarify:
        yield await _aside(
            ledger, planning, kind="clarify", key="question", text=plan.clarify, started=started
        )
        return
    # Not `and not plan.queries`: a model that declines *and* names queries has
    # still declined, and running them anyway spends a second call writing prose
    # about rows it already said were beside the point.
    if plan.refusal:
        yield await _aside(
            ledger, planning, kind="refusal", key="message", text=plan.refusal, started=started
        )
        return

    # Actions first, and exclusively (story 36). The organiser is about to be
    # shown something to approve; running queries underneath that would make half
    # the reply about a different question.
    if plan.actions:
        async for event in _propose(ledger, llm, plan, planning, request.question, started):
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
