from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import CriterionKind, ReviewRoundStatus, ReviewStatus


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Read(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class RoundCreate(Strict):
    name: str = Field(min_length=1, max_length=200)
    is_blind: bool = False
    sort_order: int = 0
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    advance_rule: dict[str, Any] = Field(default_factory=lambda: {"type": "manual"})

    @model_validator(mode="after")
    def _window(self) -> RoundCreate:
        if self.opens_at and self.closes_at and self.opens_at >= self.closes_at:
            raise ValueError("opens_at must be before closes_at")
        return self


class RoundUpdate(Strict):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    is_blind: bool | None = None
    sort_order: int | None = None
    status: ReviewRoundStatus | None = None
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    advance_rule: dict[str, Any] | None = None


class RoundRead(Read):
    id: uuid.UUID
    name: str
    is_blind: bool
    sort_order: int
    status: ReviewRoundStatus
    opens_at: datetime | None
    closes_at: datetime | None
    advance_rule: dict[str, Any]


class CriterionCreate(Strict):
    label: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    kind: CriterionKind = CriterionKind.RATING
    choices: list[dict[str, Any]] = Field(default_factory=list)
    scale_min: int = Field(default=1, ge=0, le=100)
    scale_max: int = Field(default=5, ge=1, le=100)
    weight: Decimal = Field(default=Decimal("1.00"), ge=0, le=9)
    is_required: bool = True
    sort_order: int = 0

    @model_validator(mode="after")
    def _sane(self) -> CriterionCreate:
        if self.scale_min > self.scale_max:
            raise ValueError("scale_min cannot exceed scale_max")
        if self.kind == CriterionKind.SELECT and not self.choices:
            raise ValueError("a select criterion needs choices")
        return self


class CriterionUpdate(Strict):
    label: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    weight: Decimal | None = Field(default=None, ge=0, le=9)
    is_required: bool | None = None
    sort_order: int | None = None


class CriterionRead(Read):
    id: uuid.UUID
    label: str
    description: str | None
    kind: CriterionKind
    choices: list[dict[str, Any]]
    scale_min: int
    scale_max: int
    weight: Decimal
    is_required: bool
    sort_order: int


class AssignRequest(Strict):
    submission_ids: list[uuid.UUID] = Field(min_length=1, max_length=1000)
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)


class AutoDistributeRequest(Strict):
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)
    per_submission: int = Field(default=2, ge=1, le=10)
    cap_per_reviewer: int | None = Field(default=None, ge=1, le=1000)


class AutoDistributeResponse(Strict):
    created: int
    under_assigned: int


class ReviewerProgress(Strict):
    user_id: uuid.UUID
    name: str
    email: str
    assigned: int
    completed: int


class QueueItem(Strict):
    submission_id: uuid.UUID
    code: str
    title: str
    completed: bool


class ReviewSubject(Strict):
    """What a reviewer is shown. In a blind round, identity is already gone."""

    id: uuid.UUID
    code: str
    title: str
    answers: dict[str, Any]
    track_id: uuid.UUID | None
    session_format_id: uuid.UUID | None
    speakers: list[dict[str, Any]]
    is_blind: bool


class ScoreRequest(Strict):
    values: dict[uuid.UUID, Any] = Field(default_factory=dict)
    comment: str | None = Field(default=None, max_length=5000)
    conflict_of_interest: bool = False


class ReviewRead(Strict):
    id: uuid.UUID
    submission_id: uuid.UUID
    status: ReviewStatus
    comment: str | None
    conflict_of_interest: bool
    score_avg: Decimal | None


class NudgeResponse(Strict):
    sent: int
    skipped: int
