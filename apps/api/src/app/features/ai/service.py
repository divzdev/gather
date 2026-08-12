"""Turning review work into a model request, and a model answer into a proposal.

Two things in here are load-bearing and easy to get wrong:

**A blind round stays blind.** The payload sent to the provider is built from
`review.blind_view()` with the same identity keys a blind reviewer gets — so a
model is never shown a name the human scoring alongside it cannot see. Rebuilding
that stripping here, rather than reusing it, is how the two would drift apart.

**Accepting a suggestion writes the accepting human's review, not the AI's.**
`reviews.user_id` is NOT NULL, so an AI-authored review is not representable in
the schema, and that is the correct constraint rather than an obstacle: a score
in this product is always somebody's judgement. Acceptance calls
`review.score()` — the same method the scorecard UI calls — with the caller's own
id, full validation, and `score_avg` recomputed in the same transaction.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ApiError, NotFoundError
from app.features.ai import prompts, proposals
from app.features.ai.gateway import LLMAdapter, select_adapter
from app.features.ai.schemas import ScoreAnswer
from app.features.review import service as review_service
from app.models import (
    AiProposal,
    AiProposalKind,
    AiProposalStatus,
    CriterionKind,
    Review,
    RubricCriterion,
    Speaker,
    Submission,
    SubmissionSpeaker,
)

#: Free-text criteria are not scored numerically anywhere else in the product, so
#: asking a model to put a number on one would invent a scale nobody agreed to.
SCORABLE = {CriterionKind.RATING, CriterionKind.SELECT}


async def _submission_payload(
    session: AsyncSession, *, submission: Submission, is_blind: bool
) -> dict[str, Any]:
    speakers = (
        (
            await session.execute(
                select(Speaker)
                .join(SubmissionSpeaker, SubmissionSpeaker.speaker_id == Speaker.id)
                .where(SubmissionSpeaker.submission_id == submission.id)
            )
        )
        .scalars()
        .all()
    )
    view = review_service.blind_view(
        submission,
        list(speakers),
        is_blind=is_blind,
        identity_keys=await review_service.identity_keys(session, submission),
    )
    # Only the parts a reader needs to form a judgement. Our primary keys are
    # meaningless to a model and echoing one back would be an identifier we then
    # had to distrust, so nothing here carries a UUID off the box.
    people = view.get("speakers")
    return {
        "title": view.get("title"),
        "answers": view.get("answers", {}),
        "speakers": [
            {"name": person.get("name"), "company": person.get("company")}
            for person in (people if isinstance(people, list) else [])
            if isinstance(person, dict)
        ],
    }


def _criteria_payload(criteria: list[RubricCriterion]) -> list[dict[str, Any]]:
    return [
        {
            "id": str(criterion.id),
            "label": criterion.label,
            "description": criterion.description or "",
            "scale_min": criterion.scale_min,
            "scale_max": criterion.scale_max,
        }
        for criterion in criteria
        if criterion.kind in SCORABLE
    ]


async def build_score_request(
    session: AsyncSession, *, round_id: uuid.UUID, submission_id: uuid.UUID
) -> tuple[str, str, list[RubricCriterion]]:
    """The exact system and user strings that will be sent, plus the rubric.

    Returned rather than sent so the caller can persist the proposal row first
    and — for the streaming route — close its database session before any network
    call happens.
    """
    round_ = await review_service.get_round(session, round_id)
    submission = await session.get(Submission, submission_id)
    if submission is None:
        raise NotFoundError("That submission no longer exists.")

    criteria = await review_service.criteria_for(session, round_id)
    scorable = [criterion for criterion in criteria if criterion.kind in SCORABLE]
    if not scorable:
        raise ApiError(
            "This round has no rating criteria to score against.", code="AI_NOTHING_TO_SCORE"
        )

    payload = {
        "submission": await _submission_payload(
            session, submission=submission, is_blind=round_.is_blind
        ),
        "criteria": _criteria_payload(criteria),
        "is_blind": round_.is_blind,
    }
    return prompts.load(prompts.SCORE), json.dumps(payload), scorable


def validate_scores(answer: ScoreAnswer, criteria: list[RubricCriterion]) -> list[dict[str, Any]]:
    """Keep the items that name a real criterion and sit inside its scale.

    A model that invents a criterion id or returns 11 on a 1-5 scale has produced
    an item this product cannot act on. Dropping it with a reason beats both
    failing the whole proposal and silently clamping a number a human will later
    read as considered.
    """
    by_id = {criterion.id: criterion for criterion in criteria}
    kept: list[dict[str, Any]] = []
    for item in answer.scores:
        criterion = by_id.get(item.criterion_id)
        if criterion is None:
            continue
        if not (criterion.scale_min <= item.value <= criterion.scale_max):
            continue
        kept.append(
            {
                "criterion_id": str(criterion.id),
                "label": criterion.label,
                "value": round(item.value),
                "reason": item.reason,
            }
        )
    return kept


async def score_submission(
    session: AsyncSession,
    *,
    event_id: uuid.UUID,
    round_id: uuid.UUID,
    submission_id: uuid.UUID,
    user_id: uuid.UUID,
    adapter: LLMAdapter | None = None,
) -> AiProposal:
    """Ask for suggested scores and record them. Writes nothing but the proposal."""
    await proposals.assert_within_daily_cap(session, event_id=event_id)
    system, user_message, criteria = await build_score_request(
        session, round_id=round_id, submission_id=submission_id
    )
    proposal = await proposals.create(
        session,
        kind=AiProposalKind.SCORE,
        payload={"review_round_id": str(round_id), "submission_id": str(submission_id)},
        prompt_version=prompts.SCORE,
        user_id=user_id,
    )

    llm = adapter or select_adapter()
    try:
        completion = await llm.complete(
            system=system, user=user_message, max_tokens=get_settings().ai_max_tokens
        )
        answer = proposals.parse(completion.text, ScoreAnswer)
    except ApiError as error:
        return await proposals.fail(session, proposal, reason=error.message)

    return await proposals.record(
        session,
        proposal,
        output={
            "scores": validate_scores(answer, criteria),
            "summary": answer.summary,
            "is_stub": completion.is_stub,
        },
        reasoning=answer.summary,
        model=completion.model,
        usage=completion.usage,
    )


async def accept_scores(
    session: AsyncSession,
    *,
    proposal_id: uuid.UUID,
    round_id: uuid.UUID,
    submission_id: uuid.UUID,
    user_id: uuid.UUID,
    values: dict[uuid.UUID, int] | None,
    comment: str | None,
) -> Review:
    """Adopt a proposal as the caller's own review.

    `values` present means the reviewer edited before adopting, which is the
    expected path. Either way this goes through `review.score()`, so assignment,
    round state and criterion membership are all enforced exactly as they are for
    a scorecard filled in by hand.
    """
    proposal = await proposals.get(session, proposal_id)
    if proposal.kind is not AiProposalKind.SCORE:
        raise ApiError("That suggestion is not a set of scores.", code="AI_WRONG_KIND")
    if proposal.status not in (AiProposalStatus.READY, AiProposalStatus.PARTIALLY_ACCEPTED):
        raise ApiError("That suggestion is not ready to accept.", code="AI_NOT_READY")

    # Integers, because a rubric scale is integral and `review.score()` parses
    # with `int(str(raw))` — handing it 2.0 raises "needs a number", which is a
    # baffling error to surface for a value the model got right.
    suggested = {
        uuid.UUID(str(item["criterion_id"])): int(item["value"])
        for item in proposal.output.get("scores", [])
    }
    chosen = suggested if values is None else values
    if not chosen:
        raise ApiError("There are no scores to accept.", code="AI_NOTHING_TO_ACCEPT")

    review = await review_service.score(
        session,
        round_id=round_id,
        submission_id=submission_id,
        user_id=user_id,
        values=dict(chosen),
        comment=comment,
    )
    await proposals.resolve(session, proposal, status=AiProposalStatus.ACCEPTED)
    return review
