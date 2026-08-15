"""The twelve questions the event assistant is allowed to ask the database.

This module is the whole reason the assistant can be trusted with numbers. The
model never supplies a fact: it names an entry here and supplies arguments, we
run the query ourselves, and only then is a model asked to write prose about the
rows that came back. A model that invents a query name fails validation; a model
that invents a number is contradicted by the rows printed beside it.

**Every entry is a read.** No mutating entry is registered, which is a stronger
guarantee than the proposal-and-accept gate the scoring assist uses: there is
nothing here for a hostile prompt to reach for. Adding a thirteenth entry is a
spec change, not a patch.

Tenancy is not applied by hand anywhere below. The session's `do_orm_execute`
hook scopes every ORM query to the current org and event, so a query written
here cannot see another organisation's rows even if it forgets to try.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, ValidationError
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
)

__all__ = ["CATALOG", "ROW_LIMIT", "BadArgsError", "Entry", "UnknownQueryError", "describe", "run"]

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


@dataclass(frozen=True, slots=True)
class Entry:
    """One answerable question: what it is called, what it is for, what it takes.

    `description` is not decoration — it is what the planner prompt is built
    from, so it is the only thing telling the model when this query is the right
    one. Write it for a reader who cannot see the code.
    """

    name: str
    description: str
    args: type[BaseModel]
    run: Callable[[AsyncSession, Any], Awaitable[dict[str, Any]]]


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


async def _tasks_outstanding(session: AsyncSession, args: TasksOutstandingArgs) -> dict[str, Any]:
    now = datetime.now(UTC)
    statement = (
        select(SpeakerTask, TaskTemplate.name, Speaker.name, Speaker.email)
        .join(TaskTemplate, TaskTemplate.id == SpeakerTask.task_template_id)
        .join(Speaker, Speaker.id == SpeakerTask.speaker_id)
        .where(SpeakerTask.status.not_in(_SETTLED))
        .order_by(SpeakerTask.due_at.asc().nullslast())
    )
    rows = []
    for task, template_name, speaker_name, email in (await session.execute(statement)).all():
        overdue = task.due_at is not None and task.due_at < now
        if args.overdue_only and not overdue:
            continue
        rows.append(
            {
                "task": template_name,
                "speaker": speaker_name,
                "email": email,
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


async def _sessions_in_window(session: AsyncSession, args: SessionsInWindowArgs) -> dict[str, Any]:
    statement = (
        select(Session, Room.name, EventDay.day_date)
        .join(Room, Room.id == Session.room_id)
        .join(EventDay, EventDay.id == Session.event_day_id)
        .order_by(Session.starts_at.asc())
    )
    if args.day is not None:
        statement = statement.where(EventDay.day_date == args.day)
    if args.room is not None:
        statement = statement.where(Room.name.ilike(f"%{args.room}%"))

    rows = [
        {
            "title": found.title,
            "room": room_name,
            "day": day_date.isoformat(),
            "starts_at": found.starts_at.isoformat() if found.starts_at else None,
            "duration_minutes": found.duration_minutes,
            "status": found.status.value,
        }
        for found, room_name, day_date in (await session.execute(statement)).all()
    ]
    return _capped(rows, len(rows))


async def _accepted_without_session(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
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


async def _agenda_conflicts(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
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


async def _review_progress(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
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
        "scored_reviews": scored or 0,
        "unreviewed": unreviewed or 0,
    }


class SubmissionsByArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    group_by: Literal["status", "track", "format"] = "status"


async def _submissions_by(session: AsyncSession, args: SubmissionsByArgs) -> dict[str, Any]:
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


async def _decisions_pending_send(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
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


async def _outbox_delivery(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
    statement = select(Message.status, func.count()).group_by(Message.status)
    pairs = [(status.value, count) for status, count in (await session.execute(statement))]
    return _grouped(sorted(pairs, key=lambda pair: -pair[1]))


async def _speakers_by_status(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
    statement = select(EventSpeaker.status, func.count()).group_by(EventSpeaker.status)
    pairs = [(status.value, count) for status, count in (await session.execute(statement))]
    return _grouped(sorted(pairs, key=lambda pair: -pair[1]))


async def _event_overview(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
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


async def _files_awaiting_review(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
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


async def _published_vs_draft_diff(session: AsyncSession, args: NoArgs) -> dict[str, Any]:
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


CATALOG: dict[str, Entry] = {
    entry.name: entry
    for entry in (
        Entry(
            "tasks_outstanding",
            "Speakers who still owe a deliverable (headshot, bio, slides), soonest due "
            "first. Use for 'who hasn't sent X', 'what's outstanding', chasing questions. "
            "Set overdue_only to narrow to what is already late.",
            TasksOutstandingArgs,
            _tasks_outstanding,
        ),
        Entry(
            "sessions_in_window",
            "Scheduled sessions, optionally narrowed to one day or one room. Use for "
            "'what's on in Hall A', 'what's happening Wednesday'. Only returns sessions "
            "that have been placed on the grid.",
            SessionsInWindowArgs,
            _sessions_in_window,
        ),
        Entry(
            "accepted_without_session",
            "Accepted submissions that have never been promoted to a session. Use for "
            "'what still needs promoting', 'which accepted talks aren't on the agenda'.",
            NoArgs,
            _accepted_without_session,
        ),
        Entry(
            "agenda_conflicts",
            "Clashes currently standing on the agenda: room and speaker double-bookings "
            "(hard) and track collisions (soft). Use for 'what conflicts', 'is the "
            "schedule clean', 'can I publish'.",
            NoArgs,
            _agenda_conflicts,
        ),
        Entry(
            "review_progress",
            "Review rounds and how far scoring has got, including how many submissions "
            "nobody has scored. Use for 'how is review going', 'what's left to review'.",
            NoArgs,
            _review_progress,
        ),
        Entry(
            "submissions_by",
            "Submission counts grouped by status, track or format. Use for 'how many "
            "did we get', 'how many accepted', 'breakdown by track'.",
            SubmissionsByArgs,
            _submissions_by,
        ),
        Entry(
            "decisions_pending_send",
            "Decisions recorded but not yet emailed to anyone. Use for 'what's waiting "
            "to send', 'have the rejections gone out'. Deciding and sending are separate "
            "steps in this product and this is the gap between them.",
            NoArgs,
            _decisions_pending_send,
        ),
        Entry(
            "outbox_delivery",
            "Message counts by delivery state, including bounced and complained. Use for "
            "'did the emails land', 'any bounces'.",
            NoArgs,
            _outbox_delivery,
        ),
        Entry(
            "speakers_by_status",
            "Speaker participation counts: prospective, accepted, confirmed, declined, "
            "withdrawn. Use for 'how many speakers have confirmed'.",
            NoArgs,
            _speakers_by_status,
        ),
        Entry(
            "event_overview",
            "The event itself: dates, timezone, lifecycle stage, CFP open and close "
            "times, location. Use for 'when is the event', 'when does the CFP close'.",
            NoArgs,
            _event_overview,
        ),
        Entry(
            "files_awaiting_review",
            "Uploaded deliverables on tasks that require review, which no organiser has "
            "commented on. Use for 'what's waiting on me', 'anything to approve'.",
            NoArgs,
            _files_awaiting_review,
        ),
        Entry(
            "published_vs_draft_diff",
            "How the working schedule differs from the last published snapshot. Use for "
            "'what would publishing change', 'is the public schedule current'.",
            NoArgs,
            _published_vs_draft_diff,
        ),
    )
}


def describe() -> list[dict[str, Any]]:
    """The catalog as the planner prompt sees it: name, purpose, argument shape.

    Built from the same registry the executor uses, so the prompt cannot come to
    advertise a query that is not there, or miss one that is.
    """
    return [
        {
            "name": entry.name,
            "description": entry.description,
            "args": entry.args.model_json_schema(),
        }
        for entry in CATALOG.values()
    ]


async def run(session: AsyncSession, name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute one catalog entry. The only way the assistant reaches the database.

    Both failure modes are ordinary here rather than exceptional: a language
    model naming a query that does not exist, or passing arguments that do not
    fit, is Tuesday. The caller drops that entry from the plan and carries on
    with the rest.
    """
    entry = CATALOG.get(name)
    if entry is None:
        raise UnknownQueryError(name)
    try:
        parsed = entry.args.model_validate(args)
    except ValidationError as error:
        raise BadArgsError(f"{name} rejected its arguments: {error.errors()[:2]}") from error
    return await entry.run(session, parsed)
