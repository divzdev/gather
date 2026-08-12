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
