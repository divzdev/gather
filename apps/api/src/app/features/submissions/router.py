from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, or_, select

from app.core.deps import DbSession, bind_tenant, require_role
from app.core.errors import NotFoundError
from app.core.pagination import ListQueryDep, PageMeta, paginate
from app.core.xlsx import spreadsheet
from app.features.submissions import service
from app.features.submissions.schemas import (
    BulkDecisionRequest,
    BulkDecisionResponse,
    CoordinatorAssign,
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
    SubmissionNote,
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
            form_id=s.form_id,
            title=s.title,
            answers=s.answers,
            status=s.status,
            decision_status=s.decision_status,
            track_id=s.track_id,
            session_format_id=s.session_format_id,
            score_avg=s.score_avg,
            review_count=s.review_count,
            submitted_at=s.submitted_at,
            coordinator_user_id=s.coordinator_user_id,
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
    if tracks := query.filters.get("track_id"):
        statement = statement.where(Submission.track_id.in_(tracks))
    if reviewed := query.filters.get("reviewed"):
        # "Ready to decide" is the one console view that is not a status: in
        # review *and* somebody has actually scored it. Without this the view
        # can only be approximated in the browser, which stops being possible
        # the moment the list is paged.
        statement = statement.where(
            Submission.review_count > 0 if reviewed[0] == "true" else Submission.review_count == 0
        )
    if query.q:
        # Title, code and speaker name — the three things somebody has in front
        # of them when they search. Matching only the title would have been the
        # quiet cost of moving this list to the server: the console filtered all
        # three in the browser, over a slice of the rows.
        term = f"%{query.q}%"
        by_speaker = (
            select(SubmissionSpeaker.submission_id)
            .join(Speaker, Speaker.id == SubmissionSpeaker.speaker_id)
            .where(Speaker.name.ilike(term))
        )
        statement = statement.where(
            or_(
                Submission.title.ilike(term),
                Submission.code.ilike(term),
                Submission.id.in_(by_speaker),
            )
        )

    sortable: dict[str, Any] = {
        "title": Submission.title,
        "code": Submission.code,
        "score_avg": Submission.score_avg,
        "submitted_at": Submission.submitted_at,
    }
    # Nulls last in both directions. Postgres puts them first on a descending
    # sort, so "best score first" opened with every unreviewed proposal — the
    # ones with no score at all — above the highest-scoring talk in the event.
    # An absent score is not a high one, and it is not a low one either.
    ordering: list[Any] = [
        column.desc().nulls_last() if field.descending else column.asc().nulls_last()
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
        session,
        submission_id=submission_id,
        outcome=body.outcome,
        user_id=user.id,
        reason=body.reason,
    )
    return (await _with_speakers(session, [submission]))[0]


@router.patch("/{submission_id}/coordinator", response_model=SubmissionRead)
async def assign_coordinator(
    submission_id: uuid.UUID,
    body: CoordinatorAssign,
    session: DbSession,
    _: User = Depends(require_role(*READ)),
) -> SubmissionRead:
    """Set or clear the proposal's point of contact. Coordinators may do this —
    handing work around the team is the day-to-day they exist for."""
    submission = await service.set_coordinator(
        session, submission_id=submission_id, coordinator_user_id=body.coordinator_user_id
    )
    return (await _with_speakers(session, [submission]))[0]


@router.post("/{submission_id}/withdraw", response_model=SubmissionRead)
async def withdraw(
    submission_id: uuid.UUID,
    session: DbSession,
    _: User = Depends(require_role(*READ)),
) -> SubmissionRead:
    """The speaker has pulled out.

    Coordinators can do this, unlike deciding: it records something that already
    happened rather than making a call. The session survives and drops to
    unscheduled — see the service for why it is not deleted.
    """
    submission = await service.withdraw(session, submission_id=submission_id)
    return (await _with_speakers(session, [submission]))[0]


@router.post("/bulk-decision", response_model=BulkDecisionResponse)
async def bulk_decide(
    body: BulkDecisionRequest,
    session: DbSession,
    user: User = Depends(require_role(*DECIDE)),
) -> BulkDecisionResponse:
    # The reason is written against every row, not just the first: a bulk
    # waitlist is exactly the decision somebody asks about later, and a thread
    # that is silent on the forty while explaining the one is worse than useless.
    for submission_id in body.submission_ids:
        await service.decide(
            session,
            submission_id=submission_id,
            outcome=body.outcome,
            user_id=user.id,
            reason=body.reason,
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


class NoteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=5000)

    @field_validator("body")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        # min_length alone lets "   " through, and a note of three spaces is
        # indistinguishable from a misclick.
        stripped = value.strip()
        if stripped == "":
            raise ValueError("a note needs some text")
        return stripped


class NoteRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    body: str
    author_name: str
    created_at: datetime
    #: Set when this note is the rationale recorded with a decision, so the
    #: thread can distinguish "why we waitlisted it" from ordinary commentary.
    decision_outcome: SubmissionStatus | None = None


@router.get("/{submission_id}/notes", response_model=list[NoteRead])
async def list_notes(
    submission_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*READ))
) -> list[NoteRead]:
    """Internal only. These never reach a speaker-facing surface."""
    rows = (
        (
            await session.execute(
                select(SubmissionNote, User)
                .join(User, User.id == SubmissionNote.author_user_id)
                .where(SubmissionNote.submission_id == submission_id)
                .order_by(SubmissionNote.created_at.desc())
            )
        )
        .tuples()
        .all()
    )
    return [
        NoteRead(
            id=note.id,
            body=note.body,
            author_name=author.name,
            created_at=note.created_at,
            decision_outcome=note.decision_outcome,
        )
        for note, author in rows
    ]


@router.post("/{submission_id}/notes", response_model=NoteRead, status_code=status.HTTP_201_CREATED)
async def add_note(
    submission_id: uuid.UUID,
    body: NoteCreate,
    session: DbSession,
    user: User = Depends(require_role(*READ)),
) -> NoteRead:
    """A note the programme team leaves for itself.

    Attributed rather than anonymous: a note nobody owns is a note nobody will
    act on, and the review record is exactly where accountability matters.
    """
    submission = await session.get(Submission, submission_id)
    if submission is None:
        raise NotFoundError(f"No submission with id {submission_id}.")

    note = SubmissionNote(submission_id=submission_id, author_user_id=user.id, body=body.body)
    session.add(note)
    await session.flush()
    return NoteRead(id=note.id, body=note.body, author_name=user.name, created_at=note.created_at)


EXPORT_COLUMNS = (
    "code",
    "title",
    "speakers",
    "status",
    "decision",
    "score_avg",
    "reviews",
    "submitted_at",
)
EXPORT_WIDTHS = (10, 60, 40, 14, 16, 10, 9, 26)


class ExportRequest(BaseModel):
    """Which rows, in the caller's order.

    A POST rather than query parameters because the screen exports what it is
    showing, and two hundred ids do not fit in a URL. Empty means everything.
    """

    model_config = ConfigDict(extra="forbid")

    submission_ids: list[uuid.UUID] = Field(default_factory=list, max_length=1000)


async def _export_rows(session: DbSession, body: ExportRequest) -> list[list[Any]]:
    statement = select(Submission)
    if body.submission_ids:
        statement = statement.where(Submission.id.in_(body.submission_ids))
    rows = list((await session.execute(statement)).scalars().all())

    order = {item: index for index, item in enumerate(body.submission_ids)}
    rows.sort(key=lambda row: order.get(row.id, len(order)))

    return [
        [
            row.code,
            row.title,
            "; ".join(person.name for person in row.speakers),
            row.status.value,
            row.decision_status.value,
            float(row.score_avg) if row.score_avg is not None else None,
            row.review_count,
            "" if row.submitted_at is None else row.submitted_at.isoformat(),
        ]
        for row in await _with_speakers(session, rows)
    ]


@router.post("/export.xlsx")
async def export_xlsx(
    body: ExportRequest,
    session: DbSession,
    _: User = Depends(require_role(*READ)),
) -> Response:
    """The proposals as a spreadsheet.

    Scores are numbers, not text, so the column averages and sorts in Excel.
    """
    return spreadsheet(
        title="Submissions",
        filename="submissions.xlsx",
        header=EXPORT_COLUMNS,
        rows=await _export_rows(session, body),
        widths=EXPORT_WIDTHS,
    )


@router.post("/export.csv")
async def export_csv(
    body: ExportRequest,
    session: DbSession,
    _: User = Depends(require_role(*READ)),
) -> Response:
    """The same rows, same order, same columns — as CSV.

    Server-side alongside the xlsx so the two files never disagree about what an
    export contains.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(EXPORT_COLUMNS)
    for row in await _export_rows(session, body):
        writer.writerow(["" if cell is None else cell for cell in row])

    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="submissions.csv"'},
    )
