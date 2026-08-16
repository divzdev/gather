"""Turning a model's plan into cards a human can press.

The write half of the assistant, split out of `assistant.py` when that file
passed the 400-line limit. It is a coherent piece rather than an arbitrary cut:
everything here is about the journey from "the model named an action" to "there
is a card on screen", including the resolution ladder that decides whether an
edit can be placed at all.

Nothing here writes. `apply.py` does that, later, when somebody presses the
button.
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel

from app.core import crud
from app.core.errors import ApiError
from app.features.ai import prompts, proposals, write_catalog
from app.features.ai.adapters.base import Completion, LLMAdapter
from app.features.ai.ledger import Ledger, aside, close, scoped
from app.models import AiProposalKind

if TYPE_CHECKING:
    # Only the plan shape; `Ledger` comes from `ledger` at runtime, which is what
    # keeps this module free of a cycle back into the orchestration.
    from app.features.ai.assistant import Plan

#: How many cards one question may draw. Deliberately the same number
#: `ApplyRequest.indexes` accepts: a plan that drew 30 cards produced an
#: "Apply all 30" the route then rejected outright, and the drawer marked every
#: card failed. A cap the screen can exceed is not a cap.
MAX_ACTIONS = 25

#: The resolution call answers with one name or `null`, so this is a runaway
#: guard rather than a budget. Kept well clear of the planning cap on purpose:
#: this call exists to be cheaper than interrupting somebody.
RESOLVE_MAX_TOKENS = 200


def describe_values(values: BaseModel) -> dict[str, Any]:
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


class Match(BaseModel):
    """The resolution call's whole vocabulary: one name, or nothing."""

    match: str | None = None


def _resolve_request(wanted: str, noun: str, offered: list[str]) -> str:
    """Everything the resolution call gets: the words, the noun, the names.

    No ids, no other columns, no history — history is where a stray primary key
    would most easily arrive, and choosing between names needs none of it.
    """
    listed = "\n".join(f"- {name}" for name in offered)
    return f'They said: "{wanted}"\n\nThe {noun}s that exist:\n{listed}'


async def _plan_actions(
    ledger: Ledger, llm: LLMAdapter, plan: Plan
) -> AsyncIterator[tuple[str, dict[str, Any]] | _Proposed]:
    """Turn the model's actions into cards, asking a model — then a human — when
    a target does not resolve.

    Yields SSE events as it goes and finishes by yielding the result, so the
    caller can stream `resolving` without this needing to know about SSE.

    **No database session is open across the model call**, which the two short
    `scoped` blocks below exist to guarantee. The first cut wrapped the whole
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

        async with scoped(ledger.event_id, ledger.org_id) as session:
            found = await write_catalog.resolve(session, parsed.action.spec, parsed.target)

        if found.target is None and found.candidates:
            yield "resolving", {"target": parsed.target}
            found = await _ask_which(llm, parsed, found)

        if found.target is None:
            found_so_far.questions.append(_which(parsed, found))
            continue

        async with scoped(ledger.event_id, ledger.org_id) as session:
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


async def propose(
    ledger: Ledger,
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
        yield await aside(ledger, planning, kind=kind, key=key, text=reason, started=started)
        return

    await close(
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
    ledger: Ledger,
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
        "values": describe_values(parsed.values),
        "status": "proposed",
    }
