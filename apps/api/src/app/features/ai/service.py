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
from app.core.crypto import unseal
from app.core.errors import ApiError, NotFoundError
from app.core.tenancy import current_tenant, tenancy_disabled
from app.features.ai import prompts, proposals, queries
from app.features.ai.gateway import LLMAdapter, OrgAiConfig, select_adapter
from app.features.ai.schemas import DuplicateAnswer, ScoreAnswer
from app.features.review import service as review_service
from app.models import (
    AiProposal,
    AiProposalKind,
    AiProposalStatus,
    CriterionKind,
    Organization,
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


async def org_ai(session: AsyncSession) -> OrgAiConfig | None:
    """The org's model configuration, its key unsealed for exactly one request.

    Feature code still never *sees* the key — it goes straight into
    `select_adapter`, the one door to a model. Resolved per request rather than
    cached so removing the key in Settings takes effect immediately.
    """
    org_id = current_tenant().org_id
    with tenancy_disabled():
        row = (
            await session.execute(
                select(
                    Organization.ai_key_encrypted,
                    Organization.ai_provider,
                    Organization.ai_model,
                    Organization.ai_base_url,
                ).where(Organization.id == org_id)
            )
        ).first()
    if row is None:
        return None
    # The local provider is configured without a key, so a missing key is only
    # "unconfigured" for the providers that need one (spec 0006).
    key = unseal(row.ai_key_encrypted)
    if row.ai_provider is None:
        return None
    if key is None and row.ai_provider != "ollama":
        return None
    return OrgAiConfig(
        provider=row.ai_provider,
        api_key=key or "",
        model=row.ai_model,
        base_url=row.ai_base_url,
    )


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

    llm = adapter or select_adapter(org=await org_ai(session))
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


async def find_duplicates(
    session: AsyncSession,
    *,
    event_id: uuid.UUID,
    user_id: uuid.UUID,
    adapter: LLMAdapter | None = None,
) -> AiProposal:
    """Shortlist near-identical submissions, then ask a model which are real.

    Read-only by design. There is no "merge submissions" service to call, so
    acceptance would have nothing honest to run — the organiser reads the pairs
    and withdraws one by hand. Wrongly withdrawing a proposal costs a speaker
    their talk, which is not a decision to hand to a model.
    """
    await proposals.assert_within_daily_cap(session, event_id=event_id)
    candidates = await queries.duplicate_candidates(session, event_id=event_id)

    proposal = await proposals.create(
        session,
        kind=AiProposalKind.DUPLICATES,
        payload={"candidate_count": len(candidates)},
        prompt_version=prompts.DUPLICATES,
        user_id=user_id,
    )
    if not candidates:
        # Not a failure: "we looked and found nothing" is the answer most events
        # should get, and it must not read as the feature being broken.
        return await proposals.record(
            session,
            proposal,
            output={
                "pairs": [],
                "summary": "No submissions were similar enough to be worth a look.",
            },
            reasoning="",
            model="none",
            usage={},
        )

    by_pair = {(candidate.left_id, candidate.right_id): candidate for candidate in candidates}
    payload = json.dumps(
        {
            "candidates": [
                {
                    "left_id": str(candidate.left_id),
                    "left_title": candidate.left_title,
                    "right_id": str(candidate.right_id),
                    "right_title": candidate.right_title,
                    "text_similarity": round(candidate.score, 3),
                }
                for candidate in candidates
            ]
        }
    )

    llm = adapter or select_adapter(org=await org_ai(session))
    try:
        completion = await llm.complete(
            system=prompts.load(prompts.DUPLICATES),
            user=payload,
            max_tokens=get_settings().ai_max_tokens,
        )
        answer = proposals.parse(completion.text, DuplicateAnswer)
    except ApiError as error:
        return await proposals.fail(session, proposal, reason=error.message)

    pairs = []
    for verdict in answer.pairs:
        candidate = by_pair.get((verdict.left_id, verdict.right_id))
        # A verdict about a pair we never asked about is not actionable — the ids
        # would not resolve to anything an organiser could open.
        if candidate is None:
            continue
        pairs.append(
            {
                "left_id": str(candidate.left_id),
                "left_code": candidate.left_code,
                "left_title": candidate.left_title,
                "right_id": str(candidate.right_id),
                "right_code": candidate.right_code,
                "right_title": candidate.right_title,
                "text_similarity": round(candidate.score, 3),
                "is_duplicate": verdict.is_duplicate,
                "confidence": verdict.confidence,
                "reason": verdict.reason,
            }
        )

    return await proposals.record(
        session,
        proposal,
        output={
            "pairs": sorted(pairs, key=lambda row: not row["is_duplicate"]),
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
    # Provenance, not authorship. `review.user_id` is still the accepting human
    # and still NOT NULL, so an AI-authored review remains unrepresentable —
    # this only records that a suggestion was where the numbers started. Without
    # it the results screen shows a score with no way to tell whether a person
    # reached it or agreed with it, which is the difference an organiser reading
    # a borderline proposal most wants.
    review.ai_proposal_id = proposal.id
    await session.flush()
    await proposals.resolve(session, proposal, status=AiProposalStatus.ACCEPTED)
    return review
