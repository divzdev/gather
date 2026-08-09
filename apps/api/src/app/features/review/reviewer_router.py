"""The reviewer's own surface: a queue of exactly their assignments, and scoring.

Everything here is scoped to the signed-in reviewer. Reading a proposal that is
not theirs is a 403, not an empty result — an empty list would still confirm the
submission exists.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession, bind_tenant, require_role
from app.core.errors import NotFoundError
from app.features.forms.schema import FormSchema
from app.features.review import service
from app.features.review.schemas import (
    CriterionRead,
    QueueItem,
    ReviewRead,
    ReviewSubject,
    RoundRead,
    ScoreRequest,
)
from app.models import (
    Form,
    Review,
    ReviewerAssignment,
    ReviewRound,
    Role,
    RubricCriterion,
    Speaker,
    Submission,
    SubmissionSpeaker,
    User,
)

router = APIRouter(
    prefix="/v1/events/{event_id}/review",
    tags=["review"],
    dependencies=[Depends(bind_tenant)],
)

# Reviewers plus anyone senior — an admin should be able to see what a reviewer sees.
ANY_REVIEWER = (Role.OWNER, Role.ADMIN, Role.COORDINATOR, Role.REVIEWER)


async def _identity_keys(session: DbSession, submission: Submission) -> set[str]:
    """Answers the form marked as identity-bearing, stripped in a blind round."""
    form = await session.get(Form, submission.form_id)
    if form is None:
        return set()
    schema = FormSchema.model_validate(form.schema)
    return {f.key for f in schema.all_fields() if f.identity_bearing}


@router.get("/rounds", response_model=list[RoundRead])
async def my_rounds(
    session: DbSession,
    user: CurrentUser,
    _: User = Depends(require_role(*ANY_REVIEWER)),
) -> list[ReviewRound]:
    """The rounds this reviewer has work in.

    The admin round list is staff-only and carries configuration a reviewer has
    no business seeing; this returns only rounds they are assigned in, which is
    also what the queue needs to address itself.
    """
    rows = (
        (
            await session.execute(
                select(ReviewRound)
                .join(
                    ReviewerAssignment,
                    ReviewerAssignment.review_round_id == ReviewRound.id,
                )
                .where(ReviewerAssignment.user_id == user.id)
                .distinct()
                .order_by(ReviewRound.sort_order)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


@router.get("/queue", response_model=list[QueueItem])
async def queue(
    session: DbSession,
    user: CurrentUser,
    round_id: uuid.UUID = Query(...),
    _: User = Depends(require_role(*ANY_REVIEWER)),
) -> list[QueueItem]:
    rows = (
        (
            await session.execute(
                select(ReviewerAssignment, Submission)
                .join(Submission, Submission.id == ReviewerAssignment.submission_id)
                .where(
                    ReviewerAssignment.review_round_id == round_id,
                    ReviewerAssignment.user_id == user.id,
                )
                .order_by(Submission.code)
            )
        )
        .tuples()
        .all()
    )
    return [
        QueueItem(
            submission_id=submission.id,
            code=submission.code,
            title=submission.title,
            completed=assignment.completed_at is not None,
        )
        for assignment, submission in rows
    ]


@router.get("/submissions/{submission_id}", response_model=ReviewSubject)
async def read_for_review(
    submission_id: uuid.UUID,
    session: DbSession,
    user: CurrentUser,
    round_id: uuid.UUID = Query(...),
    _: User = Depends(require_role(*ANY_REVIEWER)),
) -> ReviewSubject:
    round_ = await service.get_round(session, round_id)
    await service.assert_assigned(
        session, round_id=round_id, submission_id=submission_id, user_id=user.id
    )
    submission = await session.get(Submission, submission_id)
    if submission is None:
        raise NotFoundError(f"No submission with id {submission_id}.")

    speakers = list(
        (
            await session.execute(
                select(Speaker)
                .join(SubmissionSpeaker, SubmissionSpeaker.speaker_id == Speaker.id)
                .where(SubmissionSpeaker.submission_id == submission_id)
            )
        )
        .scalars()
        .all()
    )
    view = service.blind_view(
        submission,
        speakers,
        is_blind=round_.is_blind,
        identity_keys=await _identity_keys(session, submission),
    )
    return ReviewSubject.model_validate(view)


@router.get("/rounds/{round_id}/criteria", response_model=list[CriterionRead])
async def scorecard(
    round_id: uuid.UUID,
    session: DbSession,
    _: User = Depends(require_role(*ANY_REVIEWER)),
) -> list[RubricCriterion]:
    return await service.criteria_for(session, round_id)


@router.put("/submissions/{submission_id}/scores", response_model=ReviewRead)
async def submit_scores(
    submission_id: uuid.UUID,
    body: ScoreRequest,
    session: DbSession,
    user: CurrentUser,
    round_id: uuid.UUID = Query(...),
    _: User = Depends(require_role(*ANY_REVIEWER)),
) -> ReviewRead:
    """Idempotent: scoring the same proposal again updates rather than duplicates,
    which is what makes save-on-selection safe."""
    review = await service.score(
        session,
        round_id=round_id,
        submission_id=submission_id,
        user_id=user.id,
        values=body.values,
        comment=body.comment,
        conflict_of_interest=body.conflict_of_interest,
    )
    submission = await session.get(Submission, submission_id)
    return ReviewRead(
        id=review.id,
        submission_id=review.submission_id,
        status=review.status,
        comment=review.comment,
        conflict_of_interest=review.conflict_of_interest,
        score_avg=submission.score_avg if submission else None,
    )


@router.get("/my-reviews", response_model=list[ReviewRead])
async def my_reviews(
    session: DbSession,
    user: CurrentUser,
    _: User = Depends(require_role(*ANY_REVIEWER)),
) -> list[ReviewRead]:
    rows = (await session.execute(select(Review).where(Review.user_id == user.id))).scalars().all()
    return [
        ReviewRead(
            id=r.id,
            submission_id=r.submission_id,
            status=r.status,
            comment=r.comment,
            conflict_of_interest=r.conflict_of_interest,
            score_avg=None,
        )
        for r in rows
    ]
