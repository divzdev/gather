"""Organizer-side review administration: rounds, scorecards, assignment, export."""

from __future__ import annotations

import csv
import io
import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select

from app.core import mail
from app.core.deps import DbSession, bind_tenant, get_verified_user, require_role
from app.core.errors import ApiError, NotFoundError
from app.core.xlsx import spreadsheet
from app.features.review import service
from app.features.review.schemas import (
    AssignRequest,
    AutoDistributeRequest,
    AutoDistributeResponse,
    CriterionCreate,
    CriterionRead,
    CriterionUpdate,
    NudgeResponse,
    ReviewerProgress,
    RoundCreate,
    RoundRead,
    RoundUpdate,
)
from app.models import (
    MessagePurpose,
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
    prefix="/v1/events/{event_id}/review-rounds",
    tags=["review admin"],
    dependencies=[Depends(bind_tenant)],
)

ADMIN = (Role.OWNER, Role.ADMIN)
STAFF = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)


@router.get("", response_model=list[RoundRead])
async def list_rounds(
    session: DbSession, _: User = Depends(require_role(*STAFF))
) -> list[RoundRead]:
    rows = (
        (await session.execute(select(ReviewRound).order_by(ReviewRound.sort_order)))
        .scalars()
        .all()
    )
    # One grouped count rather than a query per round.
    counts = dict(
        (
            await session.execute(
                select(
                    ReviewerAssignment.review_round_id,
                    func.count(func.distinct(ReviewerAssignment.submission_id)),
                ).group_by(ReviewerAssignment.review_round_id)
            )
        )
        .tuples()
        .all()
    )
    return [
        RoundRead.model_validate(row).model_copy(
            update={"submission_count": int(counts.get(row.id, 0))}
        )
        for row in rows
    ]


@router.post("", response_model=RoundRead, status_code=status.HTTP_201_CREATED)
async def create_round(
    body: RoundCreate, session: DbSession, _: User = Depends(require_role(*ADMIN))
) -> ReviewRound:
    round_ = ReviewRound(**body.model_dump())
    session.add(round_)
    await session.flush()
    return round_


@router.patch("/{round_id}", response_model=RoundRead)
async def update_round(
    round_id: uuid.UUID,
    body: RoundUpdate,
    session: DbSession,
    _: User = Depends(require_role(*ADMIN)),
) -> ReviewRound:
    round_ = await service.get_round(session, round_id)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(round_, key, value)

    # Checked here rather than on the schema, which never sees the half an edit
    # is not carrying. `RoundCreate` has ordered this since it was written, so
    # without it the guard was reachable only by getting the dates wrong the
    # first time: one PATCH afterwards put the round into the state creation
    # refuses, and a round that closes before it opens accepts no scores at all.
    if (
        round_.opens_at is not None
        and round_.closes_at is not None
        and round_.opens_at >= round_.closes_at
    ):
        raise ApiError(
            "A review round has to open before it closes.",
            code="VALIDATION_FAILED",
            status_code=422,
            field="closes_at",
        )

    await session.flush()
    return round_


@router.get("/{round_id}/criteria", response_model=list[CriterionRead])
async def list_criteria(
    round_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*STAFF))
) -> list[RubricCriterion]:
    return await service.criteria_for(session, round_id)


@router.post(
    "/{round_id}/criteria", response_model=CriterionRead, status_code=status.HTTP_201_CREATED
)
async def create_criterion(
    round_id: uuid.UUID,
    body: CriterionCreate,
    session: DbSession,
    _: User = Depends(require_role(*ADMIN)),
) -> RubricCriterion:
    await service.get_round(session, round_id)
    criterion = RubricCriterion(review_round_id=round_id, **body.model_dump())
    session.add(criterion)
    await session.flush()
    return criterion


@router.patch("/{round_id}/criteria/{criterion_id}", response_model=CriterionRead)
async def update_criterion(
    round_id: uuid.UUID,
    criterion_id: uuid.UUID,
    body: CriterionUpdate,
    session: DbSession,
    _: User = Depends(require_role(*ADMIN)),
) -> RubricCriterion:
    """Editing a live scorecard never deletes scores already given.

    Weight and wording change; existing `review_scores` rows stay exactly as the
    reviewer left them, and the mean simply recomputes.
    """
    criterion = await session.get(RubricCriterion, criterion_id)
    if criterion is None or criterion.review_round_id != round_id:
        raise NotFoundError(f"No criterion with id {criterion_id}.")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(criterion, key, value)
    await session.flush()

    affected = (
        (
            await session.execute(
                select(Review.submission_id).where(Review.review_round_id == round_id).distinct()
            )
        )
        .scalars()
        .all()
    )
    for submission_id in affected:
        await service.recompute_score(session, submission_id)
    return criterion


@router.post("/{round_id}/assignments", status_code=status.HTTP_201_CREATED)
async def assign(
    round_id: uuid.UUID,
    body: AssignRequest,
    session: DbSession,
    _: User = Depends(require_role(*ADMIN)),
) -> dict[str, int]:
    await service.get_round(session, round_id)
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
    created = 0
    for submission_id in body.submission_ids:
        for user_id in body.user_ids:
            if (submission_id, user_id) in existing:
                continue
            session.add(
                ReviewerAssignment(
                    review_round_id=round_id, submission_id=submission_id, user_id=user_id
                )
            )
            created += 1
    await session.flush()
    return {"created": created}


@router.post("/{round_id}/auto-distribute", response_model=AutoDistributeResponse)
async def auto_distribute(
    round_id: uuid.UUID,
    body: AutoDistributeRequest,
    session: DbSession,
    _: User = Depends(require_role(*ADMIN)),
) -> AutoDistributeResponse:
    await service.get_round(session, round_id)
    result = await service.auto_distribute(
        session,
        round_id=round_id,
        reviewer_ids=body.user_ids,
        per_submission=body.per_submission,
        cap_per_reviewer=body.cap_per_reviewer,
    )
    return AutoDistributeResponse(**result)


@router.get("/{round_id}/progress", response_model=list[ReviewerProgress])
async def progress(
    round_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*STAFF))
) -> list[ReviewerProgress]:
    rows = (
        (
            await session.execute(
                select(
                    User.id,
                    User.name,
                    User.email,
                    func.count(ReviewerAssignment.id),
                    func.count(ReviewerAssignment.completed_at),
                )
                .join(ReviewerAssignment, ReviewerAssignment.user_id == User.id)
                .where(ReviewerAssignment.review_round_id == round_id)
                .group_by(User.id, User.name, User.email)
                .order_by(User.name)
            )
        )
        .tuples()
        .all()
    )
    return [
        ReviewerProgress(
            user_id=user_id, name=name, email=email, assigned=int(assigned), completed=int(done)
        )
        for user_id, name, email, assigned, done in rows
    ]


@router.post(
    "/{round_id}/nudge",
    response_model=NudgeResponse,
    dependencies=[Depends(get_verified_user)],
)
async def nudge(
    round_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*ADMIN))
) -> NudgeResponse:
    """Email reviewers with outstanding assignments. Nobody who is done is emailed."""
    round_ = await service.get_round(session, round_id)
    rows = (
        (
            await session.execute(
                select(
                    User,
                    func.count(ReviewerAssignment.id) - func.count(ReviewerAssignment.completed_at),
                )
                .join(ReviewerAssignment, ReviewerAssignment.user_id == User.id)
                .where(ReviewerAssignment.review_round_id == round_id)
                .group_by(User.id)
            )
        )
        .tuples()
        .all()
    )

    sent = skipped = 0
    for user, outstanding in rows:
        if int(outstanding) <= 0:
            skipped += 1
            continue
        await mail.send_now(
            session,
            event_id=round_.event_id,
            to_email=user.email,
            purpose=MessagePurpose.REVIEWER_NUDGE,
            subject=f"{int(outstanding)} proposals still need your review",
            body=(
                f"<p>Hi {user.name},</p><p>You have <strong>{int(outstanding)}</strong> "
                f"proposals left to review in {round_.name}.</p>"
            ),
        )
        sent += 1
    return NudgeResponse(sent=sent, skipped=skipped)


@router.post("/{round_id}/advance")
async def advance(
    round_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*ADMIN))
) -> dict[str, int]:
    return await service.advance(session, round_id=round_id)


RESULT_COLUMNS = [
    "code",
    "title",
    "speakers",
    "status",
    "reviews",
    "average_score",
    "conflict_flagged",
]


async def _result_rows(session: DbSession, round_id: uuid.UUID) -> list[list[str | int]]:
    """The export's contents, built once so CSV and XLSX cannot drift apart."""
    await service.get_round(session, round_id)
    rows = (
        (
            await session.execute(
                select(Submission).order_by(
                    Submission.score_avg.desc().nullslast(), Submission.code
                )
            )
        )
        .scalars()
        .all()
    )
    names: dict[uuid.UUID, list[str]] = {}
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
        names.setdefault(link.submission_id, []).append(speaker.name)

    flagged = set(
        (
            await session.execute(
                select(Review.submission_id).where(Review.conflict_of_interest.is_(True))
            )
        )
        .scalars()
        .all()
    )

    return [
        [
            submission.code,
            submission.title,
            "; ".join(names.get(submission.id, [])),
            submission.status.value,
            submission.review_count,
            "" if submission.score_avg is None else f"{submission.score_avg}",
            "yes" if submission.id in flagged else "",
        ]
        for submission in rows
    ]


@router.get("/{round_id}/results.csv")
async def export_results(
    round_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*STAFF))
) -> Response:
    """One row per submission with its aggregate score and review counts."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(RESULT_COLUMNS)
    writer.writerows(await _result_rows(session, round_id))

    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="review-results.csv"'},
    )


@router.get("/{round_id}/results.xlsx")
async def export_results_xlsx(
    round_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*STAFF))
) -> Response:
    """The same rows as a spreadsheet, which is what programme committees
    actually pass around.

    Scores go in as numbers rather than text so the column sorts and averages in
    Excel instead of ordering 10 before 9.
    """
    rows = [
        [*row[:5], float(row[5]) if row[5] not in ("", None) else None, row[6]]
        for row in await _result_rows(session, round_id)
    ]
    return spreadsheet(
        title="Review results",
        filename="review-results.xlsx",
        header=RESULT_COLUMNS,
        rows=rows,
        widths=(10, 60, 34, 14, 9, 14, 16),
    )
