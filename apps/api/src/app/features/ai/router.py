"""AI suggestions: ask for one, read it back, adopt it, or throw it away.

Every route here is staff-or-reviewer authenticated, tenant-bound and rate
limited. The limit is not decoration: the deployed demo hands a staff session to
anyone who clicks "sign in as organizer", and a real provider key sits behind
these routes.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request
from redis.asyncio import Redis

from app.core import rate_limit
from app.core.deps import CurrentUser, DbSession, bind_tenant, require_role
from app.core.errors import ApiError
from app.features.ai import proposals, service
from app.features.ai.schemas import AcceptScoreRequest, ProposalRead, ScoreRequest
from app.models import AiProposalStatus, Role, User

router = APIRouter(
    prefix="/v1/events/{event_id}/ai",
    tags=["ai"],
    dependencies=[Depends(bind_tenant)],
)

# An admin can see and use everything a reviewer can — the scoring assist is
# most useful to whoever is actually working the queue.
ANY_REVIEWER = (Role.OWNER, Role.ADMIN, Role.COORDINATOR, Role.REVIEWER)
STAFF = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)


def _redis(request: Request) -> Redis:
    redis: Redis = request.app.state.redis
    return redis


@router.post("/review-rounds/{round_id}/score", response_model=ProposalRead, status_code=201)
async def suggest_scores(
    event_id: uuid.UUID,
    round_id: uuid.UUID,
    body: ScoreRequest,
    request: Request,
    session: DbSession,
    user: CurrentUser,
    _: User = Depends(require_role(*ANY_REVIEWER)),
) -> ProposalRead:
    """Suggest scores for one submission. Writes a proposal and nothing else."""
    await rate_limit.enforce(_redis(request), rate_limit.AI, bucket="ai", identifier=str(user.id))
    proposal = await service.score_submission(
        session,
        event_id=event_id,
        round_id=round_id,
        submission_id=body.submission_id,
        user_id=user.id,
    )
    return ProposalRead.model_validate(proposal)


@router.post("/duplicates", response_model=ProposalRead, status_code=201)
async def find_duplicates(
    event_id: uuid.UUID,
    request: Request,
    session: DbSession,
    user: CurrentUser,
    _: User = Depends(require_role(*STAFF)),
) -> ProposalRead:
    """Suspected duplicate submissions, shortlisted in SQL and adjudicated by a model.

    Read-only: it reports pairs, it does not withdraw anything. Staff rather than
    reviewers, because the person who acts on a duplicate is running the
    programme, not scoring it.
    """
    await rate_limit.enforce(_redis(request), rate_limit.AI, bucket="ai", identifier=str(user.id))
    proposal = await service.find_duplicates(session, event_id=event_id, user_id=user.id)
    return ProposalRead.model_validate(proposal)


@router.get("/proposals/{proposal_id}", response_model=ProposalRead)
async def read_proposal(
    proposal_id: uuid.UUID,
    session: DbSession,
    _: User = Depends(require_role(*ANY_REVIEWER)),
) -> ProposalRead:
    """Read a proposal back.

    Exists so a dropped connection mid-stream is recoverable: the row was written
    before the model was called, so there is always something to return to.
    """
    return ProposalRead.model_validate(await proposals.get(session, proposal_id))


@router.post("/proposals/{proposal_id}/accept", status_code=200)
async def accept_proposal(
    proposal_id: uuid.UUID,
    body: AcceptScoreRequest,
    session: DbSession,
    user: CurrentUser,
    _: User = Depends(require_role(*ANY_REVIEWER)),
) -> dict[str, str]:
    """Adopt a suggestion as your own review.

    The scores become a `reviews` row owned by the caller, written through the
    same service method the scorecard uses. Nothing about this request trusts the
    model's output beyond it being a starting point.
    """
    review = await service.accept_scores(
        session,
        proposal_id=proposal_id,
        round_id=body.review_round_id,
        submission_id=body.submission_id,
        user_id=user.id,
        values=body.values,
        comment=body.comment,
    )
    return {"review_id": str(review.id), "status": review.status.value}


@router.post("/proposals/{proposal_id}/discard", response_model=ProposalRead)
async def discard_proposal(
    proposal_id: uuid.UUID,
    session: DbSession,
    _: User = Depends(require_role(*ANY_REVIEWER)),
) -> ProposalRead:
    proposal = await proposals.get(session, proposal_id)
    if proposal.status is AiProposalStatus.ACCEPTED:
        raise ApiError("That suggestion has already been accepted.", code="AI_ALREADY_ACCEPTED")
    return ProposalRead.model_validate(
        await proposals.resolve(session, proposal, status=AiProposalStatus.DISCARDED)
    )
