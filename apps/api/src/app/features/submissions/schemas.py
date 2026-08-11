from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import DecisionStatus, SubmissionStatus


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CoSpeaker(Strict):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr


class DraftRequest(Strict):
    form_id: uuid.UUID
    title: str = Field(min_length=1, max_length=300)
    answers: dict[str, Any] = Field(default_factory=dict)
    speaker_email: EmailStr
    speaker_name: str = Field(min_length=1, max_length=200)
    #: Everyone else on the talk. The person submitting is always primary; the
    #: form's own settings decide how many of these are allowed.
    co_speakers: list[CoSpeaker] = Field(default_factory=list, max_length=20)
    draft_token: uuid.UUID | None = None


class SubmitRequest(DraftRequest):
    pass


class DraftResponse(Strict):
    id: uuid.UUID
    code: str
    draft_token: uuid.UUID | None
    status: SubmissionStatus


class SubmittedResponse(Strict):
    id: uuid.UUID
    code: str
    status: SubmissionStatus
    confirmation_message: str


class SpeakerSummary(Strict):
    id: uuid.UUID
    name: str
    email: str
    is_primary: bool


class SubmissionRead(Strict):
    id: uuid.UUID
    code: str
    #: Which form this arrived through — the seam that tells a proposal a
    #: stranger submitted from one an organiser typed in, and which version of
    #: the questions the answers belong to.
    form_id: uuid.UUID
    title: str
    answers: dict[str, Any]
    status: SubmissionStatus
    decision_status: DecisionStatus
    track_id: uuid.UUID | None
    session_format_id: uuid.UUID | None
    score_avg: Decimal | None
    review_count: int
    submitted_at: datetime | None
    speakers: list[SpeakerSummary] = Field(default_factory=list)


class DecisionRequest(Strict):
    outcome: SubmissionStatus


class BulkDecisionRequest(Strict):
    submission_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    outcome: SubmissionStatus


class BulkDecisionResponse(Strict):
    updated: int
    pending_send: int


class PendingDecisions(Strict):
    """Feeds the banner that tells an organizer decisions are recorded but unsent."""

    accepted: int
    waitlisted: int
    rejected: int
    total: int


class PromotedSession(Strict):
    id: uuid.UUID
    title: str
    slug: str
    duration_minutes: int


class PublicStatus(Strict):
    code: str
    title: str
    stage: str
    outcome: str | None
    submitted_at: datetime | None
    #: Whether the edit endpoint would take a change right now — the call is
    #: still open and review has not started. The page asks before offering a
    #: form rather than letting someone retype an abstract into a refusal.
    can_edit: bool = False


class OpenRequest(Strict):
    """The token travels in the body, not the query string. It arrives in a URL
    from the confirmation email, which cannot be helped, but it does not have to
    end up in the API's access log as well."""

    draft_token: uuid.UUID


class OpenResponse(Strict):
    code: str
    title: str
    answers: dict[str, Any]
    stage: str
    can_edit: bool


class EditRequest(Strict):
    """The proposal's own resume token is the credential. `code` is a lookup key
    and explicitly not a secret, so it cannot be the thing that authorises a
    write to somebody else's proposal."""

    draft_token: uuid.UUID
    title: str = Field(min_length=1, max_length=300)
    answers: dict[str, Any]
