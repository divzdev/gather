"""The contract between the model and the database: what it may ask for.

`catalog_queries.py` holds the twelve queries themselves. This holds the
registry that names them for the planner, the argument validation standing
between a language model and an execution, and the single `run()` door they both
go through. The two are separate because they change for different reasons: a
query changes when the domain does, this changes when the contract with the
model does.

**Every entry is a read.** No mutating entry is registered, which is a stronger
guarantee than the proposal-and-accept gate the scoring assist uses: there is
nothing here for a hostile prompt to reach for. Adding a thirteenth entry is a
spec change, not a patch.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.ai.catalog_queries import (
    ROW_LIMIT,
    BadArgsError,
    NoArgs,
    SessionsInWindowArgs,
    SubmissionsByArgs,
    TasksOutstandingArgs,
    UnknownQueryError,
    accepted_without_session,
    agenda_conflicts,
    decisions_pending_send,
    event_overview,
    files_awaiting_review,
    outbox_delivery,
    published_vs_draft_diff,
    review_progress,
    sessions_in_window,
    speakers_by_status,
    submissions_by,
    tasks_outstanding,
)

__all__ = ["CATALOG", "ROW_LIMIT", "BadArgsError", "Entry", "UnknownQueryError", "describe", "run"]


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


CATALOG: dict[str, Entry] = {
    entry.name: entry
    for entry in (
        Entry(
            "tasks_outstanding",
            "Speakers who still owe a deliverable (headshot, bio, slides), soonest due "
            "first. Use for 'who hasn't sent X', 'what's outstanding', chasing questions. "
            "Set overdue_only to narrow to what is already late.",
            TasksOutstandingArgs,
            tasks_outstanding,
        ),
        Entry(
            "sessions_in_window",
            "Every session in this event, placed or not, each with an is_placed "
            "flag, a room and a day. Use for 'how many sessions do we have', "
            "'what still needs scheduling', 'what's on in Hall A', 'what's "
            "happening Wednesday'. Passing day or room narrows to placed "
            "sessions; passing neither returns them all.",
            SessionsInWindowArgs,
            sessions_in_window,
        ),
        Entry(
            "accepted_without_session",
            "Accepted submissions that have never been promoted to a session. Use for "
            "'what still needs promoting', 'which accepted talks aren't on the agenda'.",
            NoArgs,
            accepted_without_session,
        ),
        Entry(
            "agenda_conflicts",
            "Clashes currently standing on the agenda: room and speaker double-bookings "
            "(hard) and track collisions (soft). Use for 'what conflicts', 'is the "
            "schedule clean', 'can I publish'.",
            NoArgs,
            agenda_conflicts,
        ),
        Entry(
            "review_progress",
            "Review rounds, how far scoring has got, how many submissions nobody has "
            "scored, and each reviewer's assigned-versus-completed count. Use for "
            "'how is review going', 'what's left to review', 'who is behind'.",
            NoArgs,
            review_progress,
        ),
        Entry(
            "submissions_by",
            "Submission counts grouped by status, track or format. Use for 'how many "
            "did we get', 'how many accepted', 'breakdown by track'.",
            SubmissionsByArgs,
            submissions_by,
        ),
        Entry(
            "decisions_pending_send",
            "Decisions recorded but not yet emailed to anyone. Use for 'what's waiting "
            "to send', 'have the rejections gone out'. Deciding and sending are separate "
            "steps in this product and this is the gap between them.",
            NoArgs,
            decisions_pending_send,
        ),
        Entry(
            "outbox_delivery",
            "Message counts by delivery state, including bounced and complained. Use for "
            "'did the emails land', 'any bounces'.",
            NoArgs,
            outbox_delivery,
        ),
        Entry(
            "speakers_by_status",
            "Speaker participation counts: prospective, accepted, confirmed, declined, "
            "withdrawn. Use for 'how many speakers have confirmed'.",
            NoArgs,
            speakers_by_status,
        ),
        Entry(
            "event_overview",
            "The event itself: dates, timezone, lifecycle stage, CFP open and close "
            "times, location. Use for 'when is the event', 'when does the CFP close'.",
            NoArgs,
            event_overview,
        ),
        Entry(
            "files_awaiting_review",
            "Uploaded deliverables on tasks that require review, which no organiser has "
            "commented on. Use for 'what's waiting on me', 'anything to approve'.",
            NoArgs,
            files_awaiting_review,
        ),
        Entry(
            "published_vs_draft_diff",
            "How the working schedule differs from the last published snapshot. Use for "
            "'what would publishing change', 'is the public schedule current'.",
            NoArgs,
            published_vs_draft_diff,
        ),
    )
}


def _arg_spec(args: type[BaseModel]) -> dict[str, str]:
    """One line per argument: its type, its allowed values, its default.

    A full JSON Schema per entry cost about 1,200 prompt tokens across the
    twelve — most of it `title` and `anyOf` boilerplate a model does not need to
    call the query correctly. This carries the same information in a third of
    the space, and the prompt is sent on every single question.
    """
    schema = args.model_json_schema()
    defs = schema.get("$defs", {})
    spec: dict[str, str] = {}
    for name, field in (schema.get("properties") or {}).items():
        parts: list[str] = []
        options = field.get("enum") or _enum_of(field, defs)
        if options:
            parts.append("one of " + "|".join(str(option) for option in options))
        else:
            parts.append(_type_of(field))
        if "default" in field and field["default"] is not None:
            parts.append(f"default {field['default']}")
        elif "default" in field:
            parts.append("optional")
        spec[name] = ", ".join(parts)
    return spec


def _enum_of(field: dict[str, Any], defs: dict[str, Any]) -> list[Any] | None:
    for option in field.get("anyOf", []):
        if "enum" in option:
            return list(option["enum"])
        ref = option.get("$ref", "").rsplit("/", 1)[-1]
        if ref and "enum" in defs.get(ref, {}):
            return list(defs[ref]["enum"])
    return None


def _type_of(field: dict[str, Any]) -> str:
    if "type" in field:
        return str(field["type"])
    kinds = [option["type"] for option in field.get("anyOf", []) if option.get("type") != "null"]
    return kinds[0] if kinds else "string"


def describe() -> list[dict[str, Any]]:
    """The catalog as the planner prompt sees it: name, purpose, argument shape.

    Built from the same registry the executor uses, so the prompt cannot come to
    advertise a query that is not there, or miss one that is.
    """
    return [
        {"name": entry.name, "purpose": entry.description, "args": _arg_spec(entry.args)}
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
