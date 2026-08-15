"""The twelve queries the event assistant is allowed to run (spec 0005).

Seam 2. These call `catalog.run()` directly rather than going through the SSE
route, because at route level "the query returned the wrong rows" and "the
planner picked the wrong query" are indistinguishable failures — and the whole
premise of the feature is that the numbers are real, so the queries are the part
that has to be right.

Expected values come from the fixture literals below, never from re-running the
query's own logic in the assertion.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import tenancy_disabled, tenant_scope
from app.features.ai import catalog
from app.models import (
    DecisionStatus,
    Event,
    EventDay,
    EventSpeaker,
    EventStatus,
    Form,
    FormKind,
    Message,
    MessageStatus,
    Organization,
    Room,
    Session,
    SessionStatus,
    Speaker,
    SpeakerStatus,
    SpeakerTask,
    Submission,
    SubmissionSpeaker,
    SubmissionStatus,
    TaskKind,
    TaskStatus,
    TaskTemplate,
)

FORM_SCHEMA: dict[str, object] = {"fields": [{"key": "abstract", "type": "textarea"}]}


@dataclass
class World:
    """A small conference with one of everything the catalog reads.

    Deliberately lopsided — two accepted talks but only one session, one overdue
    task and one complete one, one bounced message — so a query that ignores its
    filter returns a different number than a query that honours it.
    """

    event: Event
    org_id: uuid.UUID
    speaker_id: uuid.UUID
    accepted_with_session: uuid.UUID
    accepted_without_session: uuid.UUID


@pytest.fixture
async def world(session: AsyncSession) -> AsyncIterator[World]:
    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        org = Organization(name=f"Org {suffix}", slug=f"org-{suffix}")
        session.add(org)
        await session.flush()
        event = Event(
            org_id=org.id,
            name="DevFlow Conf 2027",
            slug=f"devflow-cat-{suffix}",
            timezone="America/New_York",
            starts_on=datetime(2027, 5, 12).date(),
            ends_on=datetime(2027, 5, 13).date(),
            status=EventStatus.IN_REVIEW,
            cfp_closes_at=datetime(2027, 2, 1, tzinfo=UTC),
        )
        session.add(event)
        await session.flush()
        form = Form(
            org_id=org.id, event_id=event.id, name="CFP", kind=FormKind.CFP, schema=FORM_SCHEMA
        )
        session.add(form)

        speaker = Speaker(org_id=org.id, email=f"priya-{suffix}@example.com", name="Priya Raman")
        session.add(speaker)
        await session.flush()
        session.add(
            EventSpeaker(
                org_id=org.id,
                event_id=event.id,
                speaker_id=speaker.id,
                status=SpeakerStatus.CONFIRMED,
            )
        )

        # Three submissions: two accepted (one promoted, one not), one rejected
        # and already sent, so `decisions_pending_send` has exactly one row to
        # find and `submissions_by` has three to group.
        made: dict[str, uuid.UUID] = {}
        for key, status, decision in (
            ("promoted", SubmissionStatus.ACCEPTED, DecisionStatus.PENDING_SEND),
            ("orphan", SubmissionStatus.ACCEPTED, DecisionStatus.SENT),
            ("rejected", SubmissionStatus.REJECTED, DecisionStatus.SENT),
        ):
            submission = Submission(
                org_id=org.id,
                event_id=event.id,
                form_id=form.id,
                code=key[:6].upper(),
                title=f"Talk {key}",
                answers={"abstract": "About builds."},
                status=status,
                decision_status=decision,
            )
            session.add(submission)
            await session.flush()
            session.add(
                SubmissionSpeaker(
                    org_id=org.id,
                    event_id=event.id,
                    submission_id=submission.id,
                    speaker_id=speaker.id,
                    is_primary=True,
                )
            )
            made[key] = submission.id

        day = EventDay(
            org_id=org.id,
            event_id=event.id,
            day_date=datetime(2027, 5, 12).date(),
            starts_at_local=datetime(2027, 5, 12, 9, 0).time(),
            ends_at_local=datetime(2027, 5, 12, 17, 0).time(),
        )
        room = Room(org_id=org.id, event_id=event.id, name="Hall A")
        session.add_all([day, room])
        await session.flush()

        # Only the first accepted talk becomes a session, and it is placed.
        session.add(
            Session(
                org_id=org.id,
                event_id=event.id,
                submission_id=made["promoted"],
                title="Talk promoted",
                slug=f"talk-promoted-{suffix}",
                duration_minutes=30,
                event_day_id=day.id,
                room_id=room.id,
                starts_at=datetime(2027, 5, 12, 10, 0, tzinfo=UTC),
                status=SessionStatus.SCHEDULED,
            )
        )

        template = TaskTemplate(
            org_id=org.id,
            event_id=event.id,
            name="Headshot",
            kind=TaskKind.UPLOAD,
            is_required=True,
        )
        done = TaskTemplate(
            org_id=org.id, event_id=event.id, name="Bio", kind=TaskKind.FORM, is_required=True
        )
        session.add_all([template, done])
        await session.flush()
        # One outstanding and overdue, one complete. A query that forgets to
        # exclude complete tasks returns two.
        session.add(
            SpeakerTask(
                org_id=org.id,
                event_id=event.id,
                speaker_id=speaker.id,
                task_template_id=template.id,
                due_at=datetime.now(UTC) - timedelta(days=3),
                status=TaskStatus.NOT_STARTED,
            )
        )
        session.add(
            SpeakerTask(
                org_id=org.id,
                event_id=event.id,
                speaker_id=speaker.id,
                task_template_id=done.id,
                due_at=datetime.now(UTC) + timedelta(days=3),
                status=TaskStatus.COMPLETE,
            )
        )

        # Three messages, one of each interesting delivery state.
        for to, state in (
            ("sent@example.com", MessageStatus.SENT),
            ("bounced@example.com", MessageStatus.BOUNCED),
            ("complained@example.com", MessageStatus.COMPLAINED),
        ):
            session.add(
                Message(
                    org_id=org.id,
                    event_id=event.id,
                    to_email=to,
                    subject="You're in",
                    body_rendered="Congratulations.",
                    status=state,
                )
            )
        await session.commit()

    built = World(
        event=event,
        org_id=org.id,
        speaker_id=speaker.id,
        accepted_with_session=made["promoted"],
        accepted_without_session=made["orphan"],
    )
    with tenant_scope(org_id=org.id, event_id=event.id):
        yield built


async def test_every_catalog_entry_is_registered_with_a_schema() -> None:
    """The registry is what the planner prompt is built from, so a half-registered
    entry would advertise a query the planner then cannot successfully call."""
    assert len(catalog.CATALOG) == 12
    for name, entry in catalog.CATALOG.items():
        assert entry.name == name, "the key and the entry must agree, the prompt uses both"
        assert entry.description.strip(), f"{name} has no description for the planner"


async def test_an_unknown_query_name_is_refused_rather_than_guessed(
    session: AsyncSession, world: World
) -> None:
    with pytest.raises(catalog.UnknownQueryError):
        await catalog.run(session, "drop_everything", {})


async def test_tasks_outstanding_omits_completed_work(session: AsyncSession, world: World) -> None:
    result = await catalog.run(session, "tasks_outstanding", {})

    assert result["count"] == 1, "the complete Bio task must not be chased"
    assert result["rows"][0]["task"] == "Headshot"
    assert result["rows"][0]["speaker"] == "Priya Raman"
    assert result["rows"][0]["is_overdue"] is True


async def test_tasks_outstanding_can_narrow_to_overdue(session: AsyncSession, world: World) -> None:
    result = await catalog.run(session, "tasks_outstanding", {"overdue_only": True})

    assert result["count"] == 1
    assert all(row["is_overdue"] for row in result["rows"])


async def test_accepted_without_session_finds_only_the_unpromoted(
    session: AsyncSession, world: World
) -> None:
    result = await catalog.run(session, "accepted_without_session", {})

    assert result["count"] == 1, "the promoted talk already has a session"
    assert result["rows"][0]["title"] == "Talk orphan"


async def test_submissions_by_status_counts_every_status(
    session: AsyncSession, world: World
) -> None:
    result = await catalog.run(session, "submissions_by", {"group_by": "status"})

    counts = {row["group"]: row["count"] for row in result["rows"]}
    assert counts == {"accepted": 2, "rejected": 1}
    assert result["total"] == 3


async def test_event_overview_reports_the_event_in_its_own_timezone(
    session: AsyncSession, world: World
) -> None:
    result = await catalog.run(session, "event_overview", {})

    assert result["name"] == "DevFlow Conf 2027"
    assert result["timezone"] == "America/New_York"
    assert result["starts_on"] == "2027-05-12"
    assert result["status"] == "in_review"


async def test_decisions_pending_send_is_the_unsent_decision_only(
    session: AsyncSession, world: World
) -> None:
    """The decision/send separation made queryable. A row here is a decision the
    organiser has recorded and not yet told anybody about."""
    result = await catalog.run(session, "decisions_pending_send", {})

    assert result["count"] == 1
    assert result["rows"][0]["title"] == "Talk promoted"
    assert result["rows"][0]["status"] == "accepted"


async def test_outbox_delivery_separates_bounced_from_complained(
    session: AsyncSession, world: World
) -> None:
    result = await catalog.run(session, "outbox_delivery", {})

    counts = {row["group"]: row["count"] for row in result["rows"]}
    assert counts == {"sent": 1, "bounced": 1, "complained": 1}


async def test_speakers_by_status_counts_participation(session: AsyncSession, world: World) -> None:
    result = await catalog.run(session, "speakers_by_status", {})

    counts = {row["group"]: row["count"] for row in result["rows"]}
    assert counts == {"confirmed": 1}


async def test_sessions_in_window_finds_the_placed_session(
    session: AsyncSession, world: World
) -> None:
    result = await catalog.run(session, "sessions_in_window", {"day": "2027-05-12"})

    assert result["count"] == 1
    assert result["rows"][0]["title"] == "Talk promoted"
    assert result["rows"][0]["room"] == "Hall A"


async def test_sessions_in_window_on_an_empty_day_says_so(
    session: AsyncSession, world: World
) -> None:
    result = await catalog.run(session, "sessions_in_window", {"day": "2027-05-13"})

    assert result["count"] == 0
    assert result["rows"] == []


async def test_agenda_conflicts_is_clean_when_nothing_overlaps(
    session: AsyncSession, world: World
) -> None:
    result = await catalog.run(session, "agenda_conflicts", {})

    assert result["count"] == 0


async def test_review_progress_reports_an_unreviewed_backlog(
    session: AsyncSession, world: World
) -> None:
    result = await catalog.run(session, "review_progress", {})

    assert result["rounds"] == [], "no round has been opened in this world"
    assert result["unreviewed"] == 3, "every submission is unreviewed"


async def test_files_awaiting_review_is_empty_with_no_uploads(
    session: AsyncSession, world: World
) -> None:
    result = await catalog.run(session, "files_awaiting_review", {})

    assert result["count"] == 0


async def test_published_vs_draft_diff_reports_never_published(
    session: AsyncSession, world: World
) -> None:
    result = await catalog.run(session, "published_vs_draft_diff", {})

    assert result["published_version"] is None
    assert result["has_unpublished_changes"] is True


async def test_a_query_result_never_exceeds_the_row_cap(
    session: AsyncSession, world: World
) -> None:
    """A plan must not be able to pull the whole submissions table into a prompt.

    The cap is on the rows *returned*; `count` still reports the true total, so
    an answer built from a capped result can say "showing 50 of 214" rather than
    quietly understating the number.
    """
    result = await catalog.run(session, "submissions_by", {"group_by": "status"})

    assert len(result["rows"]) <= catalog.ROW_LIMIT


async def test_args_that_do_not_match_the_schema_are_refused(
    session: AsyncSession, world: World
) -> None:
    """The planner is a language model; its args are untrusted input like any other."""
    with pytest.raises(catalog.BadArgsError):
        await catalog.run(session, "submissions_by", {"group_by": "sql_injection"})
