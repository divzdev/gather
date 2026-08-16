"""AI suggestions: ask for one, read it back, adopt it, or throw it away.

Every route here is staff-or-reviewer authenticated, tenant-bound and rate
limited. The limit is not decoration: the deployed demo hands a staff session to
anyone who clicks "sign in as organizer", and a real provider key sits behind
these routes.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from redis.asyncio import Redis

from app.core import db, rate_limit
from app.core.deps import (
    BearerCredentials,
    CurrentUser,
    DbSession,
    bind_tenant,
    get_current_user,
    require_role,
    resolve_role,
)
from app.core.errors import ApiError, RoleRequiredError
from app.core.tenancy import current_tenant, tenancy_disabled
from app.features.ai import apply as apply_service
from app.features.ai import assistant, proposals, service
from app.features.ai.gateway import describe_choice
from app.features.ai.schemas import AcceptScoreRequest, AiStatus, ProposalRead, ScoreRequest
from app.features.ai.service import org_ai
from app.models import AiProposalStatus, Event, Role, User

router = APIRouter(
    prefix="/v1/events/{event_id}/ai",
    tags=["ai"],
    dependencies=[Depends(bind_tenant)],
)

#: The event assistant lives on its own router because it must NOT carry
#: `bind_tenant`. That dependency takes a `DbSession`, and a `yield` dependency
#: tears down only after the response body is finished — which for an SSE
#: response means holding an asyncpg connection across two model calls. The
#: architecture rules forbid exactly that, so this router authenticates,
#: authorizes and resolves its tenant in a short session inside the handler,
#: and the streaming generator owns its own sessions from there.
stream_router = APIRouter(prefix="/v1/events/{event_id}/ai", tags=["ai"])

# An admin can see and use everything a reviewer can — the scoring assist is
# most useful to whoever is actually working the queue.
ANY_REVIEWER = (Role.OWNER, Role.ADMIN, Role.COORDINATOR, Role.REVIEWER)
STAFF = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)


def _redis(request: Request) -> Redis:
    redis: Redis = request.app.state.redis
    return redis


@router.get("/status", response_model=AiStatus)
async def ai_status(
    session: DbSession,
    _: User = Depends(require_role(*STAFF)),
) -> AiStatus:
    """Which model answers questions here, and what today has cost so far.

    Staff-only for the same reason the assistant is: it names the organisation's
    provider and its spend, neither of which is a reviewer's business.

    Cheap on purpose — two small queries and no model call — because the drawer
    fetches it on open and again after every answer, and a status line that
    costs a request to the provider would be its own bill.
    """
    org_id = current_tenant().org_id
    choice = describe_choice(org=await org_ai(session))
    usage = await proposals.usage_today(session, org_id=org_id)
    return AiStatus(
        provider=choice.provider,
        provider_label=choice.label,
        model=choice.model,
        source=choice.source,
        is_stub=choice.is_stub,
        used_today=usage.used,
        daily_cap=usage.cap,
        ai_disabled=usage.disabled,
    )


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


class ApplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Which of the proposal's changes to make. A list rather than "all" so the
    #: screen can offer both individual buttons and an Apply all, and so a retry
    #: names exactly what it is retrying.
    indexes: list[int] = Field(min_length=1, max_length=25)

    @field_validator("indexes")
    @classmethod
    def _distinct(cls, indexes: list[int]) -> list[int]:
        # A repeated index would apply twice on a route whose whole promise is
        # that it does not. Refused rather than deduplicated, because a client
        # sending [0, 0] has a bug worth hearing about.
        if len(set(indexes)) != len(indexes):
            raise ValueError("indexes must not repeat")
        return indexes


class ApplyResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    results: list[dict[str, object]]


@router.post("/proposals/{proposal_id}/apply", response_model=ApplyResult)
async def apply_proposal(
    proposal_id: uuid.UUID,
    body: ApplyRequest,
    session: DbSession,
    _: User = Depends(require_role(*STAFF)),
) -> ApplyResult:
    """Make the changes an organiser approved.

    Staff rather than any-reviewer: this is the same permission the setup screens
    require, and the assistant grants nobody a reach they did not already have.

    No model is called here. The card was approved on what it said, and asking
    again at press time could produce something else.
    """
    proposal = await proposals.get(session, proposal_id)
    results = await apply_service.apply(session, proposal=proposal, indexes=body.indexes)
    return ApplyResult(results=[result.as_dict() for result in results])


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


async def _authorize(
    credentials: BearerCredentials, event_id: uuid.UUID
) -> tuple[uuid.UUID, uuid.UUID]:
    """Who is asking, and which organisation's data they may be shown.

    Deliberately not a dependency: everything here needs a database session, and
    the whole point of this router is that no session outlives the handler. So
    it opens one, answers both questions, and closes it before a model is
    reached.
    """
    async with db.session_factory() as session:
        user = await get_current_user(credentials, session)
        role = await resolve_role(session, user.id, event_id)
        if role is None or role not in STAFF:
            # Reviewers are refused on purpose. Blind review is enforced at the
            # API, and a question answerer over submissions and speakers would
            # walk straight around it.
            raise RoleRequiredError(
                "The assistant is available to organisers.",
                details={"required": sorted(r.value for r in STAFF)},
            )
        with tenancy_disabled():
            event = await session.get(Event, event_id)
        if event is None:
            raise RoleRequiredError("You do not have access to this event.")
        return user.id, event.org_id


@stream_router.post("/ask")
async def ask(
    event_id: uuid.UUID,
    body: assistant.AskRequest,
    request: Request,
    credentials: BearerCredentials,
) -> StreamingResponse:
    """Answer a question about this event, as Server-Sent Events.

    The answer is streamed because the alternative is a four-second dead
    spinner. Failures after the stream opens arrive as an `error` event rather
    than a status code — by then the response has already begun.
    """
    user_id, org_id = await _authorize(credentials, event_id)
    await rate_limit.enforce(_redis(request), rate_limit.AI, bucket="ai", identifier=str(user_id))

    async def events() -> AsyncIterator[str]:
        async for name, data in assistant.answer(
            event_id=event_id, org_id=org_id, user_id=user_id, request=body
        ):
            yield f"event: {name}\ndata: {json.dumps(data)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        # Without these a reverse proxy will happily buffer the whole stream and
        # deliver it in one lump, which is the exact experience this avoids.
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
