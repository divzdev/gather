"""Boundaries for the AI feature: what a model may return, and what a client may ask for.

The model's reply is untrusted input. It arrives as text from a system that is
allowed to be wrong, so it is validated exactly as strictly as an HTTP body —
which is what turns a bad answer into a `failed` proposal with a reason instead
of a traceback.
"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import AiProposalKind, AiProposalStatus

# ─────────────────────────── what the model returns ───────────────────────────


class ScoreItem(BaseModel):
    """One suggested score. `value` stays a float until the rubric validates it.

    Bounds are checked against the criterion's own scale in the service, not
    here — this schema does not know which round it belongs to.
    """

    model_config = ConfigDict(extra="ignore")

    criterion_id: uuid.UUID
    value: float
    reason: str = Field(default="", max_length=2_000)


class ScoreAnswer(BaseModel):
    model_config = ConfigDict(extra="ignore")

    scores: list[ScoreItem] = Field(default_factory=list, max_length=50)
    summary: str = Field(default="", max_length=4_000)


class DuplicatePair(BaseModel):
    model_config = ConfigDict(extra="ignore")

    left_id: uuid.UUID
    right_id: uuid.UUID
    is_duplicate: bool = False
    confidence: Literal["high", "medium", "low", "unknown"] = "unknown"
    reason: str = Field(default="", max_length=2_000)


class DuplicateAnswer(BaseModel):
    model_config = ConfigDict(extra="ignore")

    pairs: list[DuplicatePair] = Field(default_factory=list, max_length=60)
    summary: str = Field(default="", max_length=4_000)


# `extra="ignore"` rather than `"forbid"` on the four above is deliberate, and is
# the one place in this codebase that departs from the house rule. A model that
# helpfully adds a field it was not asked for should not fail the whole request;
# a client that does is a bug we want to hear about. The schemas below are
# request bodies and keep `"forbid"`.


# ─────────────────────────── what a client sends ───────────────────────────


class ScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    submission_id: uuid.UUID


class AcceptScoreRequest(BaseModel):
    """Adopt a proposal's scores as the caller's own review.

    `values` is absent when the reviewer took the suggestion unchanged, and
    present when they edited it first — which is the common case and the point
    of the whole pattern.
    """

    model_config = ConfigDict(extra="forbid")

    review_round_id: uuid.UUID
    submission_id: uuid.UUID
    values: dict[uuid.UUID, int] | None = None
    comment: str | None = Field(default=None, max_length=5_000)


# ─────────────────────────── what the API returns ───────────────────────────


class ProposalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: AiProposalKind
    status: AiProposalStatus
    input: dict[str, object]
    output: dict[str, object]
    reasoning: str | None
    model: str | None
    token_usage: dict[str, object]

    @property
    def is_stub(self) -> bool:
        return (self.model or "").startswith("stub:")
