from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy import func, select

from app.core.deps import DbSession, bind_tenant, require_role
from app.core.pagination import ListQueryDep, PageMeta, paginate
from app.features.submissions import service
from app.features.submissions.schemas import (
    BulkDecisionRequest,
    BulkDecisionResponse,
    DecisionRequest,
    PendingDecisions,
    PromotedSession,
    SpeakerSummary,
    SubmissionRead,
)
from app.models import (
    DecisionStatus,
    Role,
    Speaker,
    Submission,
    SubmissionSpeaker,
    SubmissionStatus,
    User,
)

router = APIRouter(
    prefix="/v1/events/{event_id}/submissions",
    tags=["submissions"],
    dependencies=[Depends(bind_tenant)],
)

DECIDE = (Role.OWNER, Role.ADMIN)
READ = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)


class SubmissionPage(BaseModel):
    data: list[SubmissionRead]
    meta: PageMeta


async def _with_speakers(session: DbSession, rows: list[Submission]) -> list[SubmissionRead]:
    if not rows:
        return []
    ids = [s.id for s in rows]
    links = (
        (
            await session.execute(
                select(SubmissionSpeaker, Speaker)
                .join(Speaker, Speaker.id == SubmissionSpeaker.speaker_id)
                .where(SubmissionSpeaker.submission_id.in_(ids))
                .order_by(SubmissionSpeaker.sort_order)
            )
        )
        .tuples()
        .all()
    )
    by_submission: dict[uuid.UUID, list[SpeakerSummary]] = {}
    for link, speaker in links:
        by_submission.setdefault(link.submission_id, []).append(
            SpeakerSummary(
                id=speaker.id,
                name=speaker.name,
                email=speaker.email,
                is_primary=link.is_primary,
            )
        )
    return [
        SubmissionRead(
            id=s.id,
            code=s.code,
            title=s.title,
            answers=s.answers,
            status=s.status,
            decision_status=s.decision_status,
            track_id=s.track_id,
            session_format_id=s.session_format_id,
            score_avg=s.score_avg,
            review_count=s.review_count,
            submitted_at=s.submitted_at,
            speakers=by_submission.get(s.id, []),
        )
        for s in rows
    ]


@router.get("", response_model=SubmissionPage)
async def list_submissions(
    session: DbSession,
    query: ListQueryDep,
    _: User = Depends(require_role(*READ)),
) -> SubmissionPage:
    statement = select(Submission)

    if statuses := query.filters.get("status"):
        statement = statement.where(Submission.status.in_(statuses))
    if query.q:
        statement = statement.where(Submission.title.ilike(f"%{query.q}%"))

    sortable: dict[str, Any] = {
        "title": Submission.title,
        "code": Submission.code,
        "score_avg": Submission.score_avg,
        "submitted_at": Submission.submitted_at,
    }
    ordering: list[Any] = [
        column.desc() if field.descending else column.asc()
        for field in query.sort
        if (column := sortable.get(field.name)) is not None
    ]
    statement = statement.order_by(*(ordering or [Submission.submitted_at.desc()]))

    rows, meta = await paginate(session, statement, query)
    return SubmissionPage(data=await _with_speakers(session, rows), meta=meta)


@router.get("/pending-decisions", response_model=PendingDecisions)
async def pending_decisions(
    session: DbSession, _: User = Depends(require_role(*READ))
) -> PendingDecisions:
    rows = (
        await session.execute(
            select(Submission.status, func.count(Submission.id))
            .where(Submission.decision_status == DecisionStatus.PENDING_SEND)
            .group_by(Submission.status)
        )
    ).all()
    counts = {status_value: int(count) for status_value, count in rows}
    accepted = counts.get(SubmissionStatus.ACCEPTED, 0)
    waitlisted = counts.get(SubmissionStatus.WAITLISTED, 0)
    rejected = counts.get(SubmissionStatus.REJECTED, 0)
    return PendingDecisions(
        accepted=accepted,
        waitlisted=waitlisted,
        rejected=rejected,
        total=accepted + waitlisted + rejected,
    )


@router.get("/{submission_id}", response_model=SubmissionRead)
async def read_submission(
    submission_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*READ))
) -> SubmissionRead:
    submission = await service.get(session, submission_id)
    return (await _with_speakers(session, [submission]))[0]


@router.post("/{submission_id}/decision", response_model=SubmissionRead)
async def decide(
    submission_id: uuid.UUID,
    body: DecisionRequest,
    session: DbSession,
    user: User = Depends(require_role(*DECIDE)),
) -> SubmissionRead:
    """Records the decision. Sends nothing — that is a separate, confirmed action."""
    submission = await service.decide(
        session, submission_id=submission_id, outcome=body.outcome, user_id=user.id
    )
    return (await _with_speakers(session, [submission]))[0]


@router.post("/bulk-decision", response_model=BulkDecisionResponse)
async def bulk_decide(
    body: BulkDecisionRequest,
    session: DbSession,
    user: User = Depends(require_role(*DECIDE)),
) -> BulkDecisionResponse:
    for submission_id in body.submission_ids:
        await service.decide(
            session, submission_id=submission_id, outcome=body.outcome, user_id=user.id
        )
    pending = await session.scalar(
        select(func.count(Submission.id)).where(
            Submission.decision_status == DecisionStatus.PENDING_SEND
        )
    )
    return BulkDecisionResponse(updated=len(body.submission_ids), pending_send=int(pending or 0))


@router.post(
    "/{submission_id}/promote",
    response_model=PromotedSession,
    status_code=status.HTTP_201_CREATED,
)
async def promote(
    submission_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*DECIDE))
) -> PromotedSession:
    talk = await service.promote(session, submission_id=submission_id)
    return PromotedSession(
        id=talk.id, title=talk.title, slug=talk.slug, duration_minutes=talk.duration_minutes
    )
