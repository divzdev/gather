"""The twelve queries themselves: what each one asks the database.

Separated from `catalog.py` because the two change for different reasons. This
file changes when the domain does — a new status, a renamed column, a query that
should exclude something it used to include. `catalog.py` changes when the
*contract with the model* does: how a plan is validated, what the planner is
told exists.

Tenancy is not applied by hand anywhere below. The session's `do_orm_execute`
hook scopes every ORM query to the current org and event, so a query written
here cannot see another organisation's rows even if it forgets to try. The rule
that follows: count with the entity form, `func.count(Model.id)`, never
`select(func.count()).select_from(Model)` — the latter gives the hook no entity
to hang criteria on, and it refuses rather than counting every organisation.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import current_tenant
from app.features.publishing import snapshot
from app.features.scheduling import conflicts
from app.models import (
    DecisionStatus,
    Event,
    EventDay,
    EventSpeaker,
    File,
    FileComment,
    Message,
    Review,
    ReviewerAssignment,
    ReviewRound,
    ReviewRoundStatus,
    ReviewStatus,
    Room,
    Session,
    SessionFormat,
    Speaker,
    SpeakerTask,
    Submission,
    SubmissionStatus,
    TaskFile,
    TaskStatus,
    TaskTemplate,
    Track,
    User,
)

#: No single query may return more than this many rows. `count` still carries the
#: true total, so an answer can say "showing 50 of 214" instead of understating.
#: Without it a plan naming `tasks_outstanding` on a real conference would put
#: several hundred rows into a prompt and blow the token cap.
ROW_LIMIT = 50

#: Tasks in these states are finished as far as chasing is concerned.
_SETTLED = (TaskStatus.COMPLETE,)


class UnknownQueryError(KeyError):
    """The plan named a query that does not exist. Dropped, never guessed at."""


class BadArgsError(ValueError):
    """The plan named a real query with arguments it will not accept."""


class NoArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")


async def _event(session: AsyncSession) -> Event:
    """The event the request is bound to.

    Read from the tenant context rather than passed down from the router,
    because everything else in this module relies on that context being set and
    a second source of truth for "which event" is how they drift apart.
    """
    event_id = current_tenant().event_id
    if event_id is None:
        raise BadArgsError("the assistant is always scoped to one event, and none is bound")
    found = await session.get(Event, event_id)
    if found is None:  # pragma: no cover - the tenant context named a real row
        raise BadArgsError(f"event not found: {event_id}")
    return found


def _capped(rows: list[dict[str, Any]], total: int) -> dict[str, Any]:
    return {"count": total, "rows": rows[:ROW_LIMIT], "truncated": total > ROW_LIMIT}


def _grouped(pairs: list[tuple[str, int]]) -> dict[str, Any]:
    rows = [{"group": group, "count": count} for group, count in pairs]
    return {"rows": rows, "total": sum(count for _, count in pairs)}


class TasksOutstandingArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    overdue_only: bool = False


async def tasks_outstanding(session: AsyncSession, args: TasksOutstandingArgs) -> dict[str, Any]:
    now = datetime.now(UTC)
    # Name, not address. These rows are pasted verbatim into the prose prompt
    # and sent to whichever provider the org configured; "who owes a headshot"
    # is answerable from the name alone, so the address never leaves the box.
    statement = (
        select(SpeakerTask, TaskTemplate.name, Speaker.name)
        .join(TaskTemplate, TaskTemplate.id == SpeakerTask.task_template_id)
        .join(Speaker, Speaker.id == SpeakerTask.speaker_id)
        .where(SpeakerTask.status.not_in(_SETTLED))
        .order_by(SpeakerTask.due_at.asc().nullslast())
    )
    rows = []
    for task, template_name, speaker_name in (await session.execute(statement)).all():
        overdue = task.due_at is not None and task.due_at < now
        if args.overdue_only and not overdue:
            continue
        rows.append(
            {
                "task": template_name,
                "speaker": speaker_name,
                "due_at": task.due_at.isoformat() if task.due_at else None,
                "is_overdue": overdue,
                "status": task.status.value,
            }
        )
    return _capped(rows, len(rows))


class SessionsInWindowArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day: date | None = None
    room: str | None = None


async def sessions_in_window(session: AsyncSession, args: SessionsInWindowArgs) -> dict[str, Any]:
    # Outer joins, because a session that has not been dragged onto the grid has
    # neither a room nor a day, and inner joins silently dropped every one of
    # them — "how many sessions do we have" answered zero against three.
    # Filtering by day or room still narrows to placed ones, which is what
    # those arguments mean.
    statement = (
        select(Session, Room.name, EventDay.day_date)
        .outerjoin(Room, Room.id == Session.room_id)
        .outerjoin(EventDay, EventDay.id == Session.event_day_id)
        .order_by(Session.starts_at.asc().nullslast(), Session.title.asc())
    )
    if args.day is not None:
        statement = statement.where(EventDay.day_date == args.day)
    if args.room is not None:
        statement = statement.where(Room.name.ilike(f"%{args.room}%"))

    rows = [
        {
            "title": found.title,
            "room": room_name,
            "day": day_date.isoformat() if day_date is not None else None,
            "starts_at": found.starts_at.isoformat() if found.starts_at else None,
            "duration_minutes": found.duration_minutes,
            "status": found.status.value,
            #: Explicit, so an answer can say "three sessions, none scheduled"
            #: rather than having to infer it from a null room.
            "is_placed": found.room_id is not None and found.event_day_id is not None,
        }
        for found, room_name, day_date in (await session.execute(statement)).all()
    ]
    return _capped(rows, len(rows))


async def accepted_without_session(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
    """Accepted, but never promoted. The gap the organiser has to close by hand,
    because accepting deliberately does not create a session."""
    promoted = select(Session.submission_id).where(Session.submission_id.is_not(None))
    statement = (
        select(Submission)
        .where(
            Submission.status == SubmissionStatus.ACCEPTED,
            Submission.id.not_in(promoted),
        )
        .order_by(Submission.decided_at.asc().nullslast())
    )
    rows = [
        {"title": found.title, "code": found.code, "decided_at": _iso(found.decided_at)}
        for found in (await session.scalars(statement)).all()
    ]
    return _capped(rows, len(rows))


async def agenda_conflicts(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
    """Delegates to the conflict engine rather than reimplementing overlap.

    The half-open `[start, start+duration)` rule, the soft-conflict toggle and
    the `conflict_key` all live there; a second implementation here would be a
    second set of answers about the same agenda.
    """
    event = await _event(session)
    found = await conflicts.detect(session, soft_enabled=event.soft_conflicts_enabled)
    rows = [
        {
            "kind": conflict.kind.value,
            "label": conflict.label,
            "is_hard": conflict.is_hard,
            "starts_at": conflict.starts_at.isoformat(),
            "session_count": len(conflict.session_ids),
        }
        for conflict in found
    ]
    return _capped(rows, len(rows))


async def review_progress(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
    rounds = (
        await session.scalars(select(ReviewRound).order_by(ReviewRound.sort_order.asc()))
    ).all()
    # The entity form, not `select(func.count()).select_from(Review)` — the
    # latter gives the tenancy hook no ORM entity to hang criteria on, and it
    # refuses rather than silently counting every organisation's reviews.
    scored = await session.scalar(
        select(func.count(Review.id)).where(Review.status == ReviewStatus.SCORED)
    )
    reviewed_submissions = select(Review.submission_id).where(Review.status == ReviewStatus.SCORED)
    unreviewed = await session.scalar(
        select(func.count(Submission.id)).where(Submission.id.not_in(reviewed_submissions))
    )
    # "How is review going" is usually really "who is behind", so the per-
    # reviewer split is part of the answer rather than a second question.
    per_reviewer = (
        await session.execute(
            select(
                User.name,
                func.count(ReviewerAssignment.id),
                func.count(ReviewerAssignment.completed_at),
            )
            .join(User, User.id == ReviewerAssignment.user_id)
            .group_by(User.name)
            .order_by(User.name)
        )
    ).all()

    return {
        "rounds": [
            {
                "name": found.name,
                "status": found.status.value,
                "is_blind": found.is_blind,
                "is_open": found.status == ReviewRoundStatus.OPEN,
            }
            for found in rounds
        ],
        "reviewers": [
            {"reviewer": name, "assigned": assigned, "completed": completed}
            for name, assigned, completed in per_reviewer
        ],
        "scored_reviews": scored or 0,
        "unreviewed": unreviewed or 0,
    }


class SubmissionsByArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    group_by: Literal["status", "track", "format"] = "status"


async def submissions_by(session: AsyncSession, args: SubmissionsByArgs) -> dict[str, Any]:
    if args.group_by == "status":
        by_status = select(Submission.status, func.count()).group_by(Submission.status)
        counted = [(status.value, count) for status, count in (await session.execute(by_status))]
        return _grouped(sorted(counted, key=lambda pair: -pair[1]))

    # A submission with no track (or no format) is grouped as "unassigned"
    # rather than dropped by the join — "how many by track" answered as a number
    # smaller than the total is the kind of quiet wrong answer this whole
    # feature exists to avoid.
    label = Track.name if args.group_by == "track" else SessionFormat.name
    by_label = (
        select(func.coalesce(label, "unassigned"), func.count())
        .select_from(Submission)
        .outerjoin(
            Track if args.group_by == "track" else SessionFormat,
            Track.id == Submission.track_id
            if args.group_by == "track"
            else SessionFormat.id == Submission.session_format_id,
        )
        .group_by(label)
    )
    pairs = [(str(name), count) for name, count in (await session.execute(by_label))]
    return _grouped(sorted(pairs, key=lambda pair: -pair[1]))


async def decisions_pending_send(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
    """Decided, not yet told. The decision/send separation, made askable."""
    statement = (
        select(Submission)
        .where(Submission.decision_status == DecisionStatus.PENDING_SEND)
        .order_by(Submission.decided_at.asc().nullslast())
    )
    rows = [
        {
            "title": found.title,
            "code": found.code,
            "status": found.status.value,
            "decided_at": _iso(found.decided_at),
        }
        for found in (await session.scalars(statement)).all()
    ]
    return _capped(rows, len(rows))


async def outbox_delivery(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
    statement = select(Message.status, func.count()).group_by(Message.status)
    pairs = [(status.value, count) for status, count in (await session.execute(statement))]
    return _grouped(sorted(pairs, key=lambda pair: -pair[1]))


async def speakers_by_status(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
    statement = select(EventSpeaker.status, func.count()).group_by(EventSpeaker.status)
    pairs = [(status.value, count) for status, count in (await session.execute(statement))]
    return _grouped(sorted(pairs, key=lambda pair: -pair[1]))


async def event_overview(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
    event = await _event(session)
    return {
        "name": event.name,
        "status": event.status.value,
        "timezone": event.timezone,
        "starts_on": event.starts_on.isoformat(),
        "ends_on": event.ends_on.isoformat(),
        "location": event.location,
        "cfp_opens_at": _iso(event.cfp_opens_at),
        "cfp_closes_at": _iso(event.cfp_closes_at),
    }


async def files_awaiting_review(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
    """Deliverables a speaker has sent that nobody on staff has answered.

    Keyed on the version group, like the comment thread itself, so replacing a
    file does not make an already-answered upload look unanswered again.
    """
    answered = select(FileComment.version_group_id).where(FileComment.author_user_id.is_not(None))
    statement = (
        select(File.filename, File.created_at, TaskTemplate.name, Speaker.name)
        .join(TaskFile, TaskFile.file_id == File.id)
        .join(SpeakerTask, SpeakerTask.id == TaskFile.speaker_task_id)
        .join(TaskTemplate, TaskTemplate.id == SpeakerTask.task_template_id)
        .join(Speaker, Speaker.id == SpeakerTask.speaker_id)
        .where(TaskTemplate.requires_review.is_(True), File.version_group_id.not_in(answered))
        .order_by(File.created_at.asc())
    )
    rows = [
        {
            "filename": filename,
            "task": task_name,
            "speaker": speaker_name,
            "uploaded_at": _iso(created_at),
        }
        for filename, created_at, task_name, speaker_name in (await session.execute(statement))
    ]
    return _capped(rows, len(rows))


async def published_vs_draft_diff(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
    """What publishing would change for the public, right now."""
    event = await _event(session)
    latest = await snapshot.latest(session)
    draft = await snapshot.build(session, event)
    difference = snapshot.diff(draft, latest.snapshot if latest else None)
    changed = {key: value for key, value in difference.items() if value}
    return {
        "published_version": latest.version if latest else None,
        "published_at": _iso(latest.published_at) if latest else None,
        "has_unpublished_changes": bool(changed) or latest is None,
        "changes": {
            key: len(value) if isinstance(value, list) else value for key, value in changed.items()
        },
    }


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None
