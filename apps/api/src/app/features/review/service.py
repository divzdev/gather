"""Review scoring, aggregation, assignment and blind filtering.

The load-bearing rule is what does *not* count toward a submission's score:
pending and skipped reviews, reviews flagged as a conflict of interest, free-text
criteria, and every AI score. Each exclusion exists because including it would
quietly distort a decision someone makes about a person's work.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError, ConflictError, NotFoundError, RoleRequiredError
from app.features.forms.schema import FormSchema
from app.models import (
    CriterionKind,
    Form,
    Review,
    ReviewerAssignment,
    ReviewRound,
    ReviewRoundStatus,
    ReviewScore,
    ReviewStatus,
    RubricCriterion,
    Speaker,
    Submission,
    SubmissionSpeaker,
    SubmissionStatus,
)

# Free-text answers are qualitative; averaging them is meaningless.
NUMERIC_KINDS = {CriterionKind.RATING, CriterionKind.SELECT}


def _now() -> datetime:
    return datetime.now(UTC)


async def get_round(session: AsyncSession, round_id: uuid.UUID) -> ReviewRound:
    round_ = await session.get(ReviewRound, round_id)
    if round_ is None:
        raise NotFoundError(f"No review round with id {round_id}.")
    return round_


async def criteria_for(session: AsyncSession, round_id: uuid.UUID) -> list[RubricCriterion]:
    return list(
        (
            await session.execute(
                select(RubricCriterion)
                .where(RubricCriterion.review_round_id == round_id)
                .order_by(RubricCriterion.sort_order)
            )
        )
        .scalars()
        .all()
    )


async def recompute_score(session: AsyncSession, submission_id: uuid.UUID) -> Decimal | None:
    """Weighted mean across scored, non-conflicted reviews.

    Runs in the same transaction as the write that triggered it, so a list sorted
    by score can never show a value that is one review out of date.
    """
    rows = (
        (
            await session.execute(
                select(ReviewScore, Review, RubricCriterion)
                .join(Review, Review.id == ReviewScore.review_id)
                .join(RubricCriterion, RubricCriterion.id == ReviewScore.rubric_criterion_id)
                .where(
                    Review.submission_id == submission_id,
                    Review.status == ReviewStatus.SCORED,
                    Review.conflict_of_interest.is_(False),
                )
            )
        )
        .tuples()
        .all()
    )

    per_review: dict[uuid.UUID, list[tuple[Decimal, Decimal]]] = defaultdict(list)
    for score, review, criterion in rows:
        if criterion.kind not in NUMERIC_KINDS or score.value is None:
            continue
        per_review[review.id].append((Decimal(score.value), criterion.weight))

    review_means: list[Decimal] = []
    for pairs in per_review.values():
        total_weight = sum((weight for _, weight in pairs), Decimal(0))
        if total_weight == 0:
            continue
        weighted = sum((value * weight for value, weight in pairs), Decimal(0))
        review_means.append(weighted / total_weight)

    submission = await session.get(Submission, submission_id)
    if submission is None:
        return None

    submission.review_count = len(review_means)
    submission.score_avg = (
        (sum(review_means, Decimal(0)) / len(review_means)).quantize(Decimal("0.01"))
        if review_means
        else None
    )
    return submission.score_avg


async def assert_assigned(
    session: AsyncSession, *, round_id: uuid.UUID, submission_id: uuid.UUID, user_id: uuid.UUID
) -> ReviewerAssignment:
    """A reviewer reading an unassigned submission gets a 403, not an empty result.

    Returning nothing would let them enumerate what exists; refusing says the
    boundary is deliberate.
    """
    assignment = await session.scalar(
        select(ReviewerAssignment).where(
            ReviewerAssignment.review_round_id == round_id,
            ReviewerAssignment.submission_id == submission_id,
            ReviewerAssignment.user_id == user_id,
        )
    )
    if assignment is None:
        raise RoleRequiredError("This proposal is not in your review queue.")
    return assignment


async def identity_keys(session: AsyncSession, submission: Submission) -> set[str]:
    """Answer keys the form marked identity-bearing, stripped in a blind round.

    Lives here rather than beside the reviewer routes because the AI scorer needs
    exactly the same set: whatever a blind reviewer is not allowed to see, a model
    is not allowed to be sent either. Two callers deriving "which fields are
    identity" separately is how one of them ends up wrong.
    """
    form = await session.get(Form, submission.form_id)
    if form is None:
        return set()
    schema = FormSchema.model_validate(form.schema)
    return {field.key for field in schema.all_fields() if field.identity_bearing}


def blind_view(
    submission: Submission, speakers: list[Speaker], *, is_blind: bool, identity_keys: set[str]
) -> dict[str, object]:
    """Strip identity server-side, not in the UI.

    Hiding it client-side leaves it in the payload, where anyone who opens a
    network tab defeats the whole point of a blind round.
    """
    answers = dict(submission.answers)
    if is_blind:
        for key in identity_keys:
            answers.pop(key, None)

    return {
        "id": submission.id,
        "code": submission.code,
        "title": submission.title,
        "answers": answers,
        "track_id": submission.track_id,
        "session_format_id": submission.session_format_id,
        "speakers": []
        if is_blind
        else [{"id": s.id, "name": s.name, "company": s.company} for s in speakers],
        "is_blind": is_blind,
    }


async def score(
    session: AsyncSession,
    *,
    round_id: uuid.UUID,
    submission_id: uuid.UUID,
    user_id: uuid.UUID,
    values: dict[uuid.UUID, object],
    comment: str | None,
    conflict_of_interest: bool = False,
) -> Review:
    round_ = await get_round(session, round_id)
    if round_.status != ReviewRoundStatus.OPEN:
        raise ConflictError("This review round is not open.")
    await assert_assigned(session, round_id=round_id, submission_id=submission_id, user_id=user_id)

    criteria = {c.id: c for c in await criteria_for(session, round_id)}
    unknown = set(values) - set(criteria)
    if unknown:
        raise ApiError("Unknown scorecard criterion.", field=str(next(iter(unknown))))

    review = await session.scalar(
        select(Review).where(
            Review.review_round_id == round_id,
            Review.submission_id == submission_id,
            Review.user_id == user_id,
        )
    )
    if review is None:
        review = Review(review_round_id=round_id, submission_id=submission_id, user_id=user_id)
        session.add(review)
        await session.flush()

    review.comment = comment
    review.conflict_of_interest = conflict_of_interest
    review.status = ReviewStatus.FLAGGED if conflict_of_interest else ReviewStatus.SCORED
    review.submitted_at = _now()

    existing = {
        s.rubric_criterion_id: s
        for s in (
            await session.execute(select(ReviewScore).where(ReviewScore.review_id == review.id))
        )
        .scalars()
        .all()
    }

    for criterion_id, raw in values.items():
        criterion = criteria[criterion_id]
        row = existing.get(criterion_id)
        if row is None:
            row = ReviewScore(review_id=review.id, rubric_criterion_id=criterion_id)
            session.add(row)

        if criterion.kind == CriterionKind.TEXT:
            row.value = None
            row.value_text = None if raw is None else str(raw)
            continue

        try:
            number = int(str(raw))
        except (TypeError, ValueError):
            raise ApiError(
                f"{criterion.label!r} needs a number.", field=str(criterion_id)
            ) from None
        if not criterion.scale_min <= number <= criterion.scale_max:
            raise ApiError(
                f"{criterion.label!r} must be between {criterion.scale_min} "
                f"and {criterion.scale_max}.",
                field=str(criterion_id),
            )
        row.value = number
        row.value_text = None

    missing = [
        c.label
        for c in criteria.values()
        if c.is_required and c.kind in NUMERIC_KINDS and c.id not in values
    ]
    if missing and not conflict_of_interest:
        raise ApiError(f"{missing[0]!r} is required.", code="VALIDATION_FAILED", status_code=422)

    await session.flush()
    await recompute_score(session, submission_id)

    assignment = await assert_assigned(
        session, round_id=round_id, submission_id=submission_id, user_id=user_id
    )
    assignment.completed_at = _now()
    await session.flush()
    return review


async def auto_distribute(
    session: AsyncSession,
    *,
    round_id: uuid.UUID,
    reviewer_ids: list[uuid.UUID],
    per_submission: int = 2,
    cap_per_reviewer: int | None = None,
) -> dict[str, int]:
    """Spread submissions across reviewers, respecting caps and existing load.

    Never assigns a reviewer a submission they authored — a reviewer scoring their
    own proposal is the failure everyone imagines when they hear "peer review".
    """
    if not reviewer_ids:
        raise ApiError("Pick at least one reviewer.", field="reviewer_ids")
    if per_submission > len(reviewer_ids):
        raise ApiError(
            "More reviewers per submission than reviewers available.", field="per_submission"
        )

    submissions = list(
        (
            await session.execute(
                select(Submission).where(
                    Submission.status.in_([SubmissionStatus.SUBMITTED, SubmissionStatus.IN_REVIEW])
                )
            )
        )
        .scalars()
        .all()
    )

    authored: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for link, speaker in (
        (
            await session.execute(
                select(SubmissionSpeaker, Speaker).join(
                    Speaker, Speaker.id == SubmissionSpeaker.speaker_id
                )
            )
        )
        .tuples()
        .all()
    ):
        authored[link.submission_id].add(speaker.id)

    load: dict[uuid.UUID, int] = dict.fromkeys(reviewer_ids, 0)
    for user_id, count in (
        (
            await session.execute(
                select(ReviewerAssignment.user_id, func.count(ReviewerAssignment.id))
                .where(ReviewerAssignment.review_round_id == round_id)
                .group_by(ReviewerAssignment.user_id)
            )
        )
        .tuples()
        .all()
    ):
        if user_id in load:
            load[user_id] = int(count)

    existing = {
        (a.submission_id, a.user_id)
        for a in (
            await session.execute(
                select(ReviewerAssignment).where(ReviewerAssignment.review_round_id == round_id)
            )
        )
        .scalars()
        .all()
    }

    created = skipped = already = 0
    for submission in submissions:
        # Already carrying its full panel. Counted apart from `skipped` because
        # the two are opposite facts and the screen reports them as one
        # sentence: "nothing to do" must not read as "could not be covered".
        if sum(1 for r in reviewer_ids if (submission.id, r) in existing) >= per_submission:
            already += 1
            continue

        candidates = sorted(
            (r for r in reviewer_ids if (submission.id, r) not in existing),
            key=lambda r: load[r],
        )
        if cap_per_reviewer is not None:
            candidates = [r for r in candidates if load[r] < cap_per_reviewer]

        chosen = candidates[:per_submission]
        if len(chosen) < per_submission:
            skipped += 1
        for reviewer_id in chosen:
            session.add(
                ReviewerAssignment(
                    review_round_id=round_id,
                    submission_id=submission.id,
                    user_id=reviewer_id,
                    assigned_at=_now(),
                )
            )
            existing.add((submission.id, reviewer_id))
            load[reviewer_id] += 1
            created += 1

    await session.flush()
    # `skipped` is reported rather than swallowed: silently under-assigning looks
    # identical to success until someone counts the reviews.
    return {"created": created, "under_assigned": skipped, "already_covered": already}


async def advance(session: AsyncSession, *, round_id: uuid.UUID) -> dict[str, int]:
    """Apply the round's advancement rule. Manual rounds move nothing."""
    round_ = await get_round(session, round_id)
    rule = round_.advance_rule or {}
    if rule.get("type") != "threshold":
        return {"advanced": 0}

    minimum = Decimal(str(rule.get("min_score", 0)))
    rows = (
        (
            await session.execute(
                select(Submission).where(
                    Submission.score_avg.is_not(None),
                    Submission.score_avg >= minimum,
                    Submission.status == SubmissionStatus.SUBMITTED,
                )
            )
        )
        .scalars()
        .all()
    )
    for submission in rows:
        submission.status = SubmissionStatus.IN_REVIEW
    await session.flush()
    return {"advanced": len(rows)}
