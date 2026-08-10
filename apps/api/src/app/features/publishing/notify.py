"""Telling speakers their slot moved.

Only the people actually affected are emailed, and only about their own session.
Publishing a schedule where one talk shifted by ten minutes must not mail eighty
speakers — that is how organisers train their audience to ignore them.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import mail
from app.features.publishing import ics
from app.models import MessagePurpose, Speaker

WHEN = "%a %d %b, %H:%M UTC"


def _format(value: str | None) -> str:
    if not value:
        return "not scheduled"
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).strftime(WHEN)


def affected(current: dict[str, Any], previous: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """Speaker id to the change they need to hear about.

    A speaker on two moved sessions gets one email about the first; the volume
    matters more here than the completeness, and the schedule link covers the rest.
    """
    before = {row["id"]: row for row in (previous or {}).get("sessions", [])}
    changes: dict[str, dict[str, Any]] = {}

    for talk in current.get("sessions", []):
        old = before.get(talk["id"])
        if old is None:
            kind, was = "added", None
        elif (old.get("starts_at"), old.get("room")) != (talk.get("starts_at"), talk.get("room")):
            kind, was = "moved", old
        else:
            continue

        for person in talk.get("speakers", []):
            changes.setdefault(person["id"], {"kind": kind, "session": talk, "was": was})
    return changes


async def schedule_changes(
    session: AsyncSession,
    *,
    event_id: uuid.UUID,
    snapshot: dict[str, Any],
    previous: dict[str, Any] | None,
    version: int,
) -> int:
    """Queue one message per affected speaker. Returns how many were sent."""
    changes = affected(snapshot, previous)
    if not changes:
        return 0

    speaker_ids = [uuid.UUID(key) for key in changes]
    people = {
        person.id: person
        for person in (await session.execute(select(Speaker).where(Speaker.id.in_(speaker_ids))))
        .scalars()
        .all()
    }

    now = datetime.now(UTC)
    event = snapshot.get("event", {})
    sent = 0
    for key, change in changes.items():
        person = people.get(uuid.UUID(key))
        if person is None:
            continue

        talk = change["session"]
        where = talk.get("room") or "a room to be confirmed"
        calendar = ics.build(talk, event=event, sequence=version, now=now)
        links = ics.calendar_links(talk, event=event)
        moved_from = (
            f"<p>Previously {_format(change['was'].get('starts_at'))}"
            f" in {change['was'].get('room') or 'no room'}.</p>"
            if change["was"] is not None
            else ""
        )
        add_to = (
            f'<p><a href="{links["google"]}">Add to Google Calendar</a> · '
            f'<a href="{links["outlook"]}">Add to Outlook</a></p>'
            if links
            else ""
        )

        await mail.send_now(
            session,
            event_id=event_id,
            to_email=person.email,
            to_speaker_id=person.id,
            purpose=MessagePurpose.SCHEDULE_CHANGE,
            ics_attached=calendar != "",
            subject=(
                f"Your session time at {event.get('name', 'the conference')}"
                if change["kind"] == "moved"
                else f"You are on the schedule for {event.get('name', 'the conference')}"
            ),
            body=(
                f"<p>Hi {person.name},</p>"
                f"<p><strong>{talk.get('title')}</strong> is now "
                f"{_format(talk.get('starts_at'))} in {where}.</p>"
                f"{moved_from}{add_to}"
                # The calendar entry rides in the body: the outbox stores rendered
                # HTML and has no attachment transport, and a speaker who can see
                # the text can still save it.
                f'<pre data-ics="1">{calendar}</pre>'
            ),
        )
        sent += 1

    await session.flush()
    return sent
