"""Adversarial: can the assistant be made to see another organisation's event?

Seam 2. `catalog.py` writes no tenant predicate anywhere — it relies entirely on
the `do_orm_execute` hook. That hook attaches `with_loader_criteria` to ORM
entities, and refuses statements that name a tenant-scoped table with no entity
to attach to. Between those two behaviours sits a third case: a statement whose
FROM is a *join*, whose columns are wrapped in a SQL function, or whose filter
lives in a scalar subquery. Those are exactly the shapes `catalog.py` uses.

So: two organisations, each with a full event, and every catalog entry run in
the first one's scope. Every expected number below is the first org's fixture
literal, chosen so that a leak reads as a different number rather than as a
missing row.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.tenancy import tenancy_disabled, tenant_scope
from app.features.ai import catalog
from app.models import (
    CommentAuthorKind,
    DecisionStatus,
    Event,
    EventDay,
    EventSpeaker,
    EventStatus,
    File,
    FileComment,
    Form,
    FormKind,
    Message,
    MessageStatus,
    Organization,
    Review,
    ReviewRound,
    ReviewStatus,
    Room,
    Session,
    SessionFormat,
    SessionStatus,
    Speaker,
    SpeakerStatus,
    SpeakerTask,
    Submission,
    SubmissionStatus,
    TaskFile,
    TaskKind,
    TaskStatus,
    TaskTemplate,
    Track,
    User,
)

FORM_SCHEMA: dict[str, object] = {"fields": [{"key": "abstract", "type": "textarea"}]}


@dataclass
class Tenant:
    org_id: uuid.UUID
    event_id: uuid.UUID
    submissions: int
    messages: int
    speakers: int


async def _seed(session: AsyncSession, label: str, *, size: int) -> Tenant:
    """One organisation with one event carrying `size` of nearly everything."""
    suffix = uuid.uuid4().hex[:8]
    org = Organization(name=f"{label} {suffix}", slug=f"{label}-{suffix}")
    session.add(org)
    await session.flush()
    event = Event(
        org_id=org.id,
        name=f"{label} Conf",
        slug=f"{label}-{suffix}",
        timezone="UTC",
        starts_on=datetime(2027, 5, 12).date(),
        ends_on=datetime(2027, 5, 13).date(),
        status=EventStatus.IN_REVIEW,
    )
    session.add(event)
    await session.flush()
    form = Form(org_id=org.id, event_id=event.id, name="CFP", kind=FormKind.CFP, schema=FORM_SCHEMA)
    track = Track(org_id=org.id, event_id=event.id, name=f"{label} Track")
    fmt = SessionFormat(org_id=org.id, event_id=event.id, name=f"{label} Format")
    room = Room(org_id=org.id, event_id=event.id, name=f"{label} Hall")
    day = EventDay(
        org_id=org.id,
        event_id=event.id,
        day_date=datetime(2027, 5, 12).date(),
        starts_at_local=datetime(2027, 5, 12, 9).time(),
        ends_at_local=datetime(2027, 5, 12, 17).time(),
    )
    round_ = ReviewRound(org_id=org.id, event_id=event.id, name=f"{label} Round 1")
    user = User(
        email=f"{label}-{suffix}@example.com",
        name=f"{label} Staff",
        password_hash=hash_password("correct horse battery staple"),
    )
    session.add_all([form, track, fmt, room, day, round_, user])
    await session.flush()

    for index in range(size):
        speaker = Speaker(
            org_id=org.id, email=f"sp-{suffix}-{index}@example.com", name=f"{label} Speaker {index}"
        )
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
        template = TaskTemplate(
            org_id=org.id,
            event_id=event.id,
            name=f"{label} Headshot {index}",
            kind=TaskKind.UPLOAD,
            is_required=True,
            requires_review=True,
        )
        session.add(template)
        await session.flush()
        submission = Submission(
            org_id=org.id,
            event_id=event.id,
            form_id=form.id,
            code=f"{label[0].upper()}{index:05d}",
            title=f"{label} talk {index}",
            answers={"abstract": "x"},
            status=SubmissionStatus.ACCEPTED,
            decision_status=DecisionStatus.PENDING_SEND,
            track_id=track.id,
            session_format_id=fmt.id,
        )
        session.add(submission)
        await session.flush()
        session.add(
            Review(
                org_id=org.id,
                event_id=event.id,
                review_round_id=round_.id,
                submission_id=submission.id,
                user_id=user.id,
                status=ReviewStatus.SCORED,
            )
        )
        session.add(
            Message(
                org_id=org.id,
                event_id=event.id,
                to_email=f"a{index}@example.com",
                subject="hi",
                body_rendered="hi",
                status=MessageStatus.BOUNCED,
            )
        )
        task = SpeakerTask(
            org_id=org.id,
            event_id=event.id,
            speaker_id=speaker.id,
            task_template_id=template.id,
            due_at=datetime.now(UTC) - timedelta(days=1),
            status=TaskStatus.NOT_STARTED,
        )
        session.add(task)
        await session.flush()
        uploaded = File(
            org_id=org.id,
            event_id=event.id,
            version_group_id=uuid.uuid4(),
            s3_key=f"{label}/{index}",
            filename=f"{label}-{index}.png",
            content_type="image/png",
            byte_size=10,
        )
        session.add(uploaded)
        await session.flush()
        session.add(
            TaskFile(org_id=org.id, event_id=event.id, speaker_task_id=task.id, file_id=uploaded.id)
        )
        # Sessions exist only for the *second* half, so `accepted_without_session`
        # has something to find in both orgs.
        if index % 2 == 0:
            session.add(
                Session(
                    org_id=org.id,
                    event_id=event.id,
                    submission_id=submission.id,
                    title=f"{label} session {index}",
                    slug=f"{label}-{suffix}-{index}",
                    duration_minutes=30,
                    event_day_id=day.id,
                    room_id=room.id,
                    starts_at=datetime(2027, 5, 12, 10 + index, 0, tzinfo=UTC),
                    status=SessionStatus.SCHEDULED,
                )
            )
    await session.commit()
    return Tenant(
        org_id=org.id,
        event_id=event.id,
        submissions=size,
        messages=size,
        speakers=1,
    )


@pytest.fixture
async def neighbours(session: AsyncSession) -> AsyncIterator[tuple[Tenant, Tenant]]:
    """Two organisations. `mine` is deliberately the smaller one."""
    with tenancy_disabled():
        mine = await _seed(session, "mine", size=1)
        theirs = await _seed(session, "theirs", size=4)
    yield mine, theirs


@pytest.mark.parametrize(
    ("name", "args", "reader", "expected"),
    [
        ("submissions_by", {"group_by": "status"}, lambda r: r["total"], 1),
        ("submissions_by", {"group_by": "track"}, lambda r: r["total"], 1),
        ("submissions_by", {"group_by": "format"}, lambda r: r["total"], 1),
        ("outbox_delivery", {}, lambda r: r["total"], 1),
        ("speakers_by_status", {}, lambda r: r["total"], 1),
        ("tasks_outstanding", {}, lambda r: r["count"], 1),
        ("sessions_in_window", {}, lambda r: r["count"], 1),
        ("decisions_pending_send", {}, lambda r: r["count"], 1),
        ("accepted_without_session", {}, lambda r: r["count"], 0),
        ("files_awaiting_review", {}, lambda r: r["count"], 1),
        ("review_progress", {}, lambda r: r["scored_reviews"], 1),
        ("agenda_conflicts", {}, lambda r: r["count"], 0),
    ],
)
async def test_no_catalog_query_can_see_the_other_organisation(
    session: AsyncSession,
    neighbours: tuple[Tenant, Tenant],
    name: str,
    args: dict[str, object],
    reader: object,
    expected: int,
) -> None:
    mine, _ = neighbours
    with tenant_scope(org_id=mine.org_id, event_id=mine.event_id):
        result = await catalog.run(session, name, args)

    assert reader(result) == expected, f"{name} counted rows outside its own tenant: {result}"


async def test_group_labels_never_name_another_organisations_track(
    session: AsyncSession, neighbours: tuple[Tenant, Tenant]
) -> None:
    """A count that is right by luck is still a leak if the *label* is theirs."""
    mine, _ = neighbours
    with tenant_scope(org_id=mine.org_id, event_id=mine.event_id):
        result = await catalog.run(session, "submissions_by", {"group_by": "track"})

    groups = [row["group"] for row in result["rows"]]
    assert not any(group.startswith("theirs") for group in groups), groups


async def test_review_progress_unreviewed_backlog_is_this_events_only(
    session: AsyncSession, neighbours: tuple[Tenant, Tenant]
) -> None:
    mine, _ = neighbours
    with tenant_scope(org_id=mine.org_id, event_id=mine.event_id):
        result = await catalog.run(session, "review_progress", {})

    # Every one of my submissions is scored, so nothing is outstanding. A
    # subquery that sees their scored reviews too would still say 0; a subquery
    # scoped correctly but an outer query that is not would say 4.
    assert result["unreviewed"] == 0
    assert [row["name"] for row in result["rounds"]] == ["mine Round 1"]


async def test_files_awaiting_review_is_not_silenced_by_a_neighbours_comment(
    session: AsyncSession, neighbours: tuple[Tenant, Tenant]
) -> None:
    """The `answered` subquery is unscoped by construction — prove it cannot be
    poisoned by an organisation that shares a version group id."""
    mine, theirs = neighbours
    with tenancy_disabled():
        mine_group = await session.scalar(
            select(File.version_group_id).where(File.org_id == mine.org_id)
        )
        their_user = await session.scalar(select(User.id).where(User.name == "theirs Staff"))
        session.add(
            FileComment(
                org_id=theirs.org_id,
                version_group_id=mine_group,
                file_version=1,
                body="not your comment",
                author_kind=CommentAuthorKind.STAFF,
                author_name="theirs Staff",
                author_user_id=their_user,
            )
        )
        await session.commit()

    with tenant_scope(org_id=mine.org_id, event_id=mine.event_id):
        result = await catalog.run(session, "files_awaiting_review", {})

    assert result["count"] == 1, "another org's comment must not mark my file answered"


async def test_a_submission_with_no_track_is_counted_as_unassigned(
    session: AsyncSession, neighbours: tuple[Tenant, Tenant]
) -> None:
    """The `coalesce` branch, which the module's own comment calls out as the
    thing that keeps a by-track breakdown from summing to less than the total.
    Nothing else exercises it."""
    mine, _ = neighbours
    with tenancy_disabled():
        form_id = await session.scalar(select(Form.id).where(Form.event_id == mine.event_id))
        session.add(
            Submission(
                org_id=mine.org_id,
                event_id=mine.event_id,
                form_id=form_id,
                code="MNOTRK",
                title="No track at all",
                answers={"abstract": "x"},
                status=SubmissionStatus.SUBMITTED,
            )
        )
        await session.commit()

    with tenant_scope(org_id=mine.org_id, event_id=mine.event_id):
        result = await catalog.run(session, "submissions_by", {"group_by": "track"})

    counts = {row["group"]: row["count"] for row in result["rows"]}
    assert counts == {"mine Track": 1, "unassigned": 1}
    assert result["total"] == 2, "a by-track breakdown that sums to less than the total is a lie"


async def test_sessions_in_window_narrows_by_room(
    session: AsyncSession, neighbours: tuple[Tenant, Tenant]
) -> None:
    """The `room` argument is a substring match on a name the model supplies,
    and nothing in the suite runs it."""
    mine, _ = neighbours
    with tenant_scope(org_id=mine.org_id, event_id=mine.event_id):
        hit = await catalog.run(session, "sessions_in_window", {"room": "mine Hall"})
        miss = await catalog.run(session, "sessions_in_window", {"room": "theirs Hall"})

    assert hit["count"] == 1
    assert miss["count"] == 0, "a room belonging to another org must not match"
