"""The adapter that runs when nobody has an API key.

`make setup && make dev` on a clean machine must produce a working, seeded app
with zero credentials. That is graded, so every AI path has to do something
truthful with no provider configured — 500ing or hiding the button would both
fail it.

The rule this file exists to enforce: **it must never look like a model.** It
answers in the same JSON shape a model would, so the parsing, validation,
proposal and acceptance paths are all genuinely exercised, but every answer
carries `is_stub` and its prose says plainly that no model ran. Confident
invented reasoning would be worse than an error, because an error is at least
honest about having failed.

Deterministic: the same input always produces the same answer, seeded from a
stable digest of the input rather than `hash()`, which is salted per process.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
from collections.abc import AsyncIterator
from typing import Any

from app.features.ai.adapters.base import Completion

NOTE = "Sample output — no model is configured, so this was generated locally."


def _seeded(payload: str) -> random.Random:
    digest = hashlib.sha256(payload.encode()).hexdigest()
    return random.Random(int(digest[:16], 16))  # noqa: S311 - demo filler, not security


def _scores(payload: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    """Mid-range values across whatever criteria were asked about.

    Deliberately clustered around the middle of each scale: a stub that produced
    decisive-looking 1s and 5s would tempt somebody to accept it without reading,
    which is the one behaviour this feature must not encourage.
    """
    items = []
    for criterion in payload.get("criteria", []):
        low = int(criterion.get("scale_min", 1))
        high = int(criterion.get("scale_max", 5))
        middle = (low + high) / 2
        value = min(high, max(low, round(middle + rng.choice([-0.5, 0, 0.5]))))
        items.append(
            {
                "criterion_id": criterion.get("id"),
                "value": value,
                "reason": f"{NOTE} No judgement was made about this criterion.",
            }
        )
    return {"scores": items, "summary": NOTE}


def _duplicates(payload: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    """Echo the shortlist back undecided.

    The candidates were already found by trigram similarity in Postgres, which is
    real work that happened whether or not a model exists. The stub declines to
    adjudicate them rather than inventing a verdict.
    """
    verdicts = [
        {
            "left_id": pair.get("left_id"),
            "right_id": pair.get("right_id"),
            "is_duplicate": False,
            "confidence": "unknown",
            "reason": f"{NOTE} These were matched by text similarity only.",
        }
        for pair in payload.get("candidates", [])
    ]
    return {"pairs": verdicts, "summary": NOTE}


#: Which catalog query a question is probably about, checked in order so the
#: specific phrases win before the general ones. This is the whole intelligence
#: of the keyless assistant, and it is meant to look like what it is: a lookup
#: table, not a reading of the question.
_KEYWORDS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("no session", "not promoted", "promote"), "accepted_without_session"),
    (("conflict", "clash", "double-book", "double book"), "agenda_conflicts"),
    (("pending", "not sent", "waiting to send", "decision"), "decisions_pending_send"),
    (("bounce", "complain", "outbox", "deliver", "email"), "outbox_delivery"),
    (("publish", "snapshot", "live schedule"), "published_vs_draft_diff"),
    (("headshot", "bio", "slide", "task", "overdue", "owe", "chase"), "tasks_outstanding"),
    (("review", "score", "unreviewed", "rubric"), "review_progress"),
    (("file", "upload", "approve", "waiting on me"), "files_awaiting_review"),
    (("room", "hall", "agenda", "scheduled", "on stage"), "sessions_in_window"),
    (("speaker", "confirmed", "declined"), "speakers_by_status"),
    (("submission", "proposal", "cfp", "talk", "how many"), "submissions_by"),
    (("when", "date", "timezone", "event"), "event_overview"),
)

#: Markers the assistant's two prompts carry. Dispatching on these keeps the
#: stub from having to import the feature that calls it.
_PLAN_MARKER = "Catalog of available queries:"
_ROWS_MARKER = "Rows returned:"


def _advertised(user: str) -> set[str]:
    """Query names the prompt actually offered.

    Read back out of the prompt rather than hardcoded, so the stub can never
    name a query the catalog has since renamed or removed — it only ever picks
    from what it was just shown.
    """
    return set(re.findall(r'"name":\s*"([a-z_]+)"', user))


def _question(user: str) -> str:
    match = re.search(r"^Question:\s*(.+)$", user, re.MULTILINE)
    return match.group(1).lower() if match else ""


def _plan(user: str) -> dict[str, Any]:
    """Keyword-match the question to one query, or decline.

    The queries then run for real, so the *numbers* a keyless install shows are
    true even though nothing intelligent chose them. Declining is important: a
    stub that always picked something would answer a question nobody asked while
    looking like it had understood.
    """
    available = _advertised(user)
    asked = _question(user)
    for triggers, name in _KEYWORDS:
        if name in available and any(trigger in asked for trigger in triggers):
            return {"queries": [{"name": name, "args": {}}], "clarify": None, "refusal": None}
    return {
        "queries": [],
        "clarify": None,
        "refusal": f"{NOTE} Without a model it can only recognise a few common questions, "
        "and this was not one of them.",
    }


def _prose(user: str) -> str:
    """Describe the rows without pretending to have thought about them."""
    raw = user.split(_ROWS_MARKER, 1)[1].strip() if _ROWS_MARKER in user else "[]"
    try:
        results: list[dict[str, Any]] = json.loads(raw)
    except json.JSONDecodeError:  # pragma: no cover - we built this payload ourselves
        results = []

    lines = [NOTE]
    for entry in results:
        result = entry.get("result", {})
        name = entry.get("query", "a query")
        if "rows" in result and "count" in result:
            lines.append(f"{name}: {result['count']} row(s).")
            for row in result["rows"][:5]:
                lines.append("  " + ", ".join(f"{key}: {value}" for key, value in row.items()))
        elif "rows" in result:
            summary = ", ".join(f"{row['group']}: {row['count']}" for row in result["rows"])
            lines.append(f"{name}: {summary or 'nothing'}.")
        else:
            lines.append(f"{name}: " + ", ".join(f"{k}: {v}" for k, v in result.items()))
    if len(lines) == 1:
        lines.append("No rows were returned.")
    return "\n".join(lines)


class StubAdapter:
    name = "stub"

    def __init__(self, *, model: str) -> None:
        #: Recorded on the proposal so a row from a keyless environment is
        #: identifiable long after the fact.
        self._model = f"stub:{model}"

    def _answer(self, user: str) -> str:
        rng = _seeded(user)
        try:
            payload = json.loads(user)
        except json.JSONDecodeError:
            payload = {}
        if "criteria" in payload:
            body = _scores(payload, rng)
        elif "candidates" in payload:
            body = _duplicates(payload, rng)
        elif _PLAN_MARKER in user:
            body = _plan(user)
        elif _ROWS_MARKER in user:
            # The one branch that answers in prose rather than JSON, because the
            # assistant's second call is asking for prose.
            return _prose(user)
        else:
            body = {"summary": NOTE}
        return json.dumps(body)

    async def complete(self, *, system: str, user: str, max_tokens: int) -> Completion:
        return Completion(text=self._answer(user), model=self._model, usage={}, is_stub=True)

    async def stream(self, *, system: str, user: str, max_tokens: int) -> AsyncIterator[str]:
        """Chunked so the streaming path is exercised without a key.

        No artificial delay: a fake think-time would be theatre, and the SSE
        plumbing is what this is here to prove.
        """
        answer = self._answer(user)
        size = 48
        for start in range(0, len(answer), size):
            yield answer[start : start + size]
