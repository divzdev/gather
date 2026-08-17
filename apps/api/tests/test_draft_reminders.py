"""Someone holding an unfinished proposal is told the call is about to close.

The form builder's Notifications step has advertised "Reminder: 5 days before
close" and "Reminder: 1 day before close" for as long as it has existed, both
captioned "Sends to everyone with an unfinished draft". Nothing sent them.

The clock is passed in rather than read, because a five-day window is otherwise
untestable without waiting five days.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import tenancy_disabled, tenant_scope
from app.features.submissions import service
from app.models import (
    Event,
    EventStatus,
    Form,
    FormKind,
    Message,
    Organization,
    Speaker,
    Submission,
    SubmissionSpeaker,
    SubmissionStatus,
)

CLOSES = datetime(2027, 4, 30, 23, 59, tzinfo=UTC)

SCHEMA: dict[str, object] = {"sections": [], "logic": [], "settings": {}}


class World:
    def __init__(self, event: Event, form: Form, drafter: Speaker, submitter: Speaker) -> None:
        self.event = event
        self.form = form
        self.drafter = drafter
        self.submitter = submitter

    def scope(self):
        return tenant_scope(org_id=self.event.org_id, event_id=self.event.id)


@pytest.fixture
async def world(session: AsyncSession) -> World:
    """One event, one unfinished draft, one already-submitted proposal."""
    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        org = Organization(name=f"Org {suffix}", slug=f"org-{suffix}")
        session.add(org)
        await session.flush()
        event = Event(
            org_id=org.id,
            name="Reminder Conf",
            slug=f"reminder-{suffix}",
            timezone="UTC",
            starts_on=datetime(2027, 5, 12).date(),
            ends_on=datetime(2027, 5, 14).date(),
            status=EventStatus.CFP_OPEN,
            cfp_closes_at=CLOSES,
        )
        session.add(event)
        await session.flush()
        form = Form(
            org_id=org.id,
            event_id=event.id,
            name="CFP",
            kind=FormKind.CFP,
            schema=dict(SCHEMA),
            closes_at=CLOSES,
        )
        session.add(form)

        people = {}
        for role, status in (
            ("drafter", SubmissionStatus.DRAFT),
            ("done", SubmissionStatus.SUBMITTED),
        ):
            speaker = Speaker(org_id=org.id, email=f"{role}-{suffix}@conf.test", name=role.title())
            session.add(speaker)
            await session.flush()
            submission = Submission(
                org_id=org.id,
                event_id=event.id,
                form_id=form.id,
                code=f"{role[:3].upper()}{suffix[:3].upper()}",
                title=f"{role} proposal",
                answers={},
                status=status,
                draft_token=uuid.uuid4(),
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
            people[role] = speaker
        await session.commit()

    return World(event, form, people["drafter"], people["done"])


async def remind(session: AsyncSession, world: World, *, at: datetime) -> int:
    with world.scope():
        return await service.remind_unfinished_drafts(session, event=world.event, now=at)


async def mail_to(session: AsyncSession, event: Event) -> list[Message]:
    with tenancy_disabled():
        rows = await session.scalars(select(Message).where(Message.event_id == event.id))
        return list(rows)


async def test_five_days_out_the_drafter_is_reminded(session: AsyncSession, world: World) -> None:
    sent = await remind(session, world, at=CLOSES - timedelta(days=4, hours=12))

    assert sent == 1
    addresses = [message.to_email for message in await mail_to(session, world.event)]
    assert addresses == [world.drafter.email]


async def test_someone_who_already_submitted_is_not_reminded(
    session: AsyncSession, world: World
) -> None:
    await remind(session, world, at=CLOSES - timedelta(days=4, hours=12))

    addresses = [message.to_email for message in await mail_to(session, world.event)]
    assert world.submitter.email not in addresses


async def test_the_reminder_carries_a_way_back_into_the_draft(
    session: AsyncSession, world: World
) -> None:
    await remind(session, world, at=CLOSES - timedelta(days=4, hours=12))

    body = (await mail_to(session, world.event))[0].body_rendered
    with tenancy_disabled():
        # Scoped to this event: `tenancy_disabled` sees every org's rows, so an
        # unscoped query here reads whichever draft another test left behind.
        token = await session.scalar(
            select(Submission.draft_token).where(
                Submission.event_id == world.event.id,
                Submission.status == SubmissionStatus.DRAFT,
            )
        )
    assert str(token) in body, "the reminder is not one click from being acted on"


async def test_the_same_window_does_not_send_twice(session: AsyncSession, world: World) -> None:
    """The worker runs far more often than nightly."""
    first = await remind(session, world, at=CLOSES - timedelta(days=4, hours=12))
    second = await remind(session, world, at=CLOSES - timedelta(days=4, hours=6))
    third = await remind(session, world, at=CLOSES - timedelta(days=4, hours=1))

    assert (first, second, third) == (1, 0, 0)
    assert len(await mail_to(session, world.event)) == 1


async def test_the_day_before_is_a_second_reminder(session: AsyncSession, world: World) -> None:
    await remind(session, world, at=CLOSES - timedelta(days=4, hours=12))
    again = await remind(session, world, at=CLOSES - timedelta(hours=12))

    assert again == 1
    assert len(await mail_to(session, world.event)) == 2


async def test_nothing_between_the_two_windows(session: AsyncSession, world: World) -> None:
    assert await remind(session, world, at=CLOSES - timedelta(days=3)) == 0
    assert await remind(session, world, at=CLOSES - timedelta(days=2)) == 0
    assert await mail_to(session, world.event) == []


async def test_nothing_once_the_call_has_closed(session: AsyncSession, world: World) -> None:
    assert await remind(session, world, at=CLOSES + timedelta(hours=1)) == 0


async def test_nothing_when_the_call_has_no_close_date(session: AsyncSession, world: World) -> None:
    with tenancy_disabled():
        form = await session.get(Form, world.form.id)
        assert form is not None
        form.closes_at = None
        event = await session.get(Event, world.event.id)
        assert event is not None
        event.cfp_closes_at = None
        await session.commit()
        world.event = event

    assert await remind(session, world, at=CLOSES - timedelta(days=4, hours=12)) == 0
