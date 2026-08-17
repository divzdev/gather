"""A schedule-change email carries a real calendar invite.

`notify_affected` built one for every affected speaker, used it to set a boolean,
and threw the text away — so the email offered a Google link and an Outlook link
and nothing at all to anyone using Apple Calendar or Thunderbird. The brief names
iCal explicitly.
"""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import mail
from app.core.tenancy import tenancy_disabled, tenant_scope
from app.models import Event, EventStatus, Message, MessageStatus, Organization


def scoped(event: Event):
    """Message is event-scoped, so a write needs a tenant bound."""
    return tenant_scope(org_id=event.org_id, event_id=event.id)


CALENDAR = (
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\n"
    "UID:test@gather\r\nSEQUENCE:3\r\nEND:VEVENT\r\nEND:VCALENDAR"
)


@pytest.fixture
async def event(session: AsyncSession) -> Event:
    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        org = Organization(name=f"Org {suffix}", slug=f"org-{suffix}")
        session.add(org)
        await session.flush()
        row = Event(
            org_id=org.id,
            name="Calendar Conf",
            slug=f"calendar-{suffix}",
            timezone="UTC",
            starts_on=datetime(2027, 5, 12).date(),
            ends_on=datetime(2027, 5, 14).date(),
            status=EventStatus.SCHEDULED,
        )
        session.add(row)
        await session.commit()
    return row


async def test_a_message_with_a_calendar_writes_an_ics_beside_the_html(
    session: AsyncSession, event: Event, tmp_path
) -> None:
    mail.MAIL_DIR = tmp_path  # type: ignore[assignment]

    with scoped(event):
        message = await mail.send_now(
            session,
            event_id=event.id,
            to_email="speaker@conf.test",
            subject="Your session moved",
            body="<p>It moved.</p>",
            calendar=CALENDAR,
        )

    assert message.status is MessageStatus.SENT
    written = sorted(path.suffix for path in tmp_path.iterdir())
    assert written == [".html", ".ics"], f"only wrote {written}"
    ics = next(path for path in tmp_path.iterdir() if path.suffix == ".ics")
    assert "BEGIN:VCALENDAR" in ics.read_text()
    assert "SEQUENCE:3" in ics.read_text()


async def test_a_message_without_a_calendar_writes_only_the_html(
    session: AsyncSession, event: Event, tmp_path
) -> None:
    mail.MAIL_DIR = tmp_path  # type: ignore[assignment]

    with scoped(event):
        await mail.send_now(
            session,
            event_id=event.id,
            to_email="speaker@conf.test",
            subject="No invite here",
            body="<p>Nothing to add.</p>",
        )

    assert sorted(path.suffix for path in tmp_path.iterdir()) == [".html"]


async def test_the_flag_cannot_disagree_with_the_calendar(
    session: AsyncSession, event: Event, tmp_path
) -> None:
    """`ics_attached` used to be a separate argument, so a caller could set it
    true and send no calendar. It is derived now and takes no argument."""
    mail.MAIL_DIR = tmp_path  # type: ignore[assignment]

    with scoped(event):
        with_invite = await mail.send_now(
            session,
            event_id=event.id,
            to_email="a@conf.test",
            subject="With",
            body="<p>x</p>",
            calendar=CALENDAR,
        )
    with scoped(event):
        without = await mail.send_now(
            session, event_id=event.id, to_email="b@conf.test", subject="Without", body="<p>x</p>"
        )

    assert with_invite.ics_attached is True
    assert with_invite.ics_body == CALENDAR
    assert without.ics_attached is False
    assert without.ics_body is None


async def test_an_empty_calendar_is_not_an_invite(
    session: AsyncSession, event: Event, tmp_path
) -> None:
    """`ics.build()` returns "" for a session with no time yet. That is 'nothing
    to send', not 'send an empty file'."""
    mail.MAIL_DIR = tmp_path  # type: ignore[assignment]

    with scoped(event):
        message = await mail.send_now(
            session,
            event_id=event.id,
            to_email="c@conf.test",
            subject="Not placed yet",
            body="<p>x</p>",
            calendar="",
        )

    assert message.ics_attached is False
    assert message.ics_body is None
    assert sorted(path.suffix for path in tmp_path.iterdir()) == [".html"]


async def test_the_calendar_survives_being_queued_for_later(
    session: AsyncSession, event: Event, tmp_path
) -> None:
    """The worker delivers rows it did not queue, so the invite has to be on the
    row rather than held in the caller's memory."""
    mail.MAIL_DIR = tmp_path  # type: ignore[assignment]

    with scoped(event):
        queued = await mail.queue(
            session,
            event_id=event.id,
            to_email="later@conf.test",
            subject="Queued now, sent later",
            body="<p>x</p>",
            calendar=CALENDAR,
        )
        await session.flush()
    message_id = queued.id
    session.expunge_all()

    with tenancy_disabled():
        reloaded = await session.get(Message, message_id)
    assert reloaded is not None
    with scoped(event):
        await mail.deliver(reloaded)

    assert reloaded.status is MessageStatus.SENT
    assert sorted(path.suffix for path in tmp_path.iterdir()) == [".html", ".ics"]
