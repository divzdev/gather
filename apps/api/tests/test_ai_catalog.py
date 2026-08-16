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
from sqlalchemy import select
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
    ReviewerAssignment,
    ReviewRound,
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
    User,
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

        # Created but never placed — "3 still to schedule" on the Sessions
        # screen. An inner join to Room/EventDay drops these entirely, which is
        # how "how many sessions do we have" answered zero against three.
        session.add(
            Session(
                org_id=org.id,
                event_id=event.id,
                # No submission: the invited keynote nobody applied for, which
                # the agenda can create outright.
                submission_id=None,
                title="Talk unplaced",
                slug=f"talk-unplaced-{suffix}",
                duration_minutes=30,
                status=SessionStatus.UNSCHEDULED,
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
        upcoming = TaskTemplate(
            org_id=org.id, event_id=event.id, name="Slides", kind=TaskKind.UPLOAD, is_required=True
        )
        session.add_all([template, done, upcoming])
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
        # Outstanding but not yet late, so `overdue_only` has something to
        # exclude and the filter is observable.
        session.add(
            SpeakerTask(
                org_id=org.id,
                event_id=event.id,
                speaker_id=speaker.id,
                task_template_id=upcoming.id,
                due_at=datetime.now(UTC) + timedelta(days=10),
                status=TaskStatus.NOT_STARTED,
            )
        )

        # A reviewer with two assignments, one finished — so "who is behind"
        # has a real number on both sides rather than a zero.
        reviewer = User(
            email=f"ravi-{suffix}@example.com",
            name="Ravi Reviewer",
            password_hash="x",
        )
        session.add(reviewer)
        round_ = ReviewRound(org_id=org.id, event_id=event.id, name="Round 1", sort_order=1)
        session.add_all([reviewer, round_])
        await session.flush()
        for key, done_at in (("promoted", datetime.now(UTC)), ("orphan", None)):
            session.add(
                ReviewerAssignment(
                    org_id=org.id,
                    event_id=event.id,
                    review_round_id=round_.id,
                    submission_id=made[key],
                    user_id=reviewer.id,
                    completed_at=done_at,
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

    chased = {row["task"] for row in result["rows"]}
    assert chased == {"Headshot", "Slides"}, "the complete Bio task must not be chased"
    assert "Bio" not in chased
    assert result["rows"][0]["task"] == "Headshot", "soonest due first, so the overdue one leads"
    assert result["rows"][0]["speaker"] == "Priya Raman"
    assert result["rows"][0]["is_overdue"] is True


async def test_tasks_outstanding_can_narrow_to_overdue(session: AsyncSession, world: World) -> None:
    """The filter has to *change* the answer.

    This test used to pass with the filter deleted: the fixture's only
    outstanding task was already overdue, so both settings returned the same
    row. `overdue_only` is a model-supplied argument, which makes an untested
    filter a way for a plan to quietly widen what it sees.
    """
    everything = await catalog.run(session, "tasks_outstanding", {})
    overdue = await catalog.run(session, "tasks_outstanding", {"overdue_only": True})

    assert everything["count"] == 2, "one overdue, one not yet due"
    assert overdue["count"] == 1
    assert [row["task"] for row in overdue["rows"]] == ["Headshot"]
    assert all(row["is_overdue"] for row in overdue["rows"])


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


async def test_asking_about_sessions_counts_the_unplaced_ones_too(
    session: AsyncSession, world: World
) -> None:
    """ "How many sessions do we have" must answer with the number on the
    Sessions screen.

    Reported from a real event: three sessions in the library, none placed, and
    the assistant said zero — because the query inner-joined Room and EventDay,
    which a session that has not been dragged onto the grid does not have.
    """
    result = await catalog.run(session, "sessions_in_window", {})

    titles = {row["title"] for row in result["rows"]}
    assert titles == {"Talk promoted", "Talk unplaced"}
    assert result["count"] == 2
    unplaced = next(row for row in result["rows"] if row["title"] == "Talk unplaced")
    assert unplaced["is_placed"] is False
    assert unplaced["room"] is None


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

    assert [row["name"] for row in result["rounds"]] == ["Round 1"]
    assert result["rounds"][0]["is_open"] is False, "the round is still a draft"
    assert result["unreviewed"] == 3, "an assignment is not a score — nothing is reviewed yet"


async def test_review_progress_names_who_is_behind(session: AsyncSession, world: World) -> None:
    """ "How is review going" is usually really "who is behind", so the catalog
    entry promises a per-reviewer split and this is what holds it to that."""
    result = await catalog.run(session, "review_progress", {})

    assert "reviewers" in result, "the entry advertises per-reviewer completion"
    by_name = {row["reviewer"]: row for row in result["reviewers"]}
    assert by_name["Ravi Reviewer"] == {
        "reviewer": "Ravi Reviewer",
        "assigned": 2,
        "completed": 1,
    }


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
    """A plan must not be able to pull the whole task list into a prompt.

    This asserted against `submissions_by`, which groups and never truncates —
    so it passed with the cap deleted. It now drives a query that really does
    call `_capped`, with more rows than the cap, which is the only shape where
    the limit is observable.

    `count` still reports the true total, so an answer built from a capped
    result can say "showing 50 of 60" rather than quietly understating it.
    """
    over = catalog.ROW_LIMIT + 10
    with tenancy_disabled():
        template = (
            await session.scalars(
                select(TaskTemplate).where(
                    TaskTemplate.name == "Headshot",
                    TaskTemplate.event_id == world.event.id,
                )
            )
        ).one()
        # One task each for many speakers, not many tasks for one: a speaker
        # owes a given deliverable at most once, which the schema enforces.
        # Sixty people owing a headshot is also the real shape of the problem.
        for index in range(over - 2):  # the fixture already carries two outstanding
            extra = Speaker(
                org_id=world.org_id,
                email=f"crowd-{index}-{uuid.uuid4().hex[:6]}@example.com",
                name=f"Speaker {index}",
            )
            session.add(extra)
            await session.flush()
            session.add(
                SpeakerTask(
                    org_id=world.org_id,
                    event_id=world.event.id,
                    speaker_id=extra.id,
                    task_template_id=template.id,
                    due_at=datetime.now(UTC) - timedelta(days=1),
                    status=TaskStatus.NOT_STARTED,
                )
            )
        await session.commit()

    result = await catalog.run(session, "tasks_outstanding", {})

    assert result["count"] == over, "the true total is still reported"
    assert len(result["rows"]) == catalog.ROW_LIMIT
    assert result["truncated"] is True


async def test_args_that_do_not_match_the_schema_are_refused(
    session: AsyncSession, world: World
) -> None:
    """The planner is a language model; its args are untrusted input like any other."""
    with pytest.raises(catalog.BadArgsError):
        await catalog.run(session, "submissions_by", {"group_by": "sql_injection"})
