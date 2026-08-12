"""Building the push plan, and running it.

The rule that shapes this file: **a dry run and a real push are the same code
path**, differing only in whether the last step writes. An operator who reads a
dry run and then executes must get exactly what they were shown, and the only
way to guarantee that is to not have a second implementation.

The second rule: a row that cannot be pushed is **blocked with a reason**, never
skipped. A silent skip is how a speaker is missing from the registration
platform on the morning of the event and nobody knows why.
"""

from __future__ import annotations

import uuid
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.integrations import adapter
from app.models import (
    EventSpeaker,
    IntegrationPush,
    PushKind,
    Room,
    Session,
    SessionSpeaker,
    SessionStatus,
    Speaker,
    SpeakerStatus,
)

Action = Literal["create", "update", "blocked"]


def _row(
    *, kind: str, local_id: uuid.UUID, label: str, action: Action, reason: str | None = None
) -> dict[str, Any]:
    return {
        "kind": kind,
        "local_id": str(local_id),
        "label": label,
        "action": action,
        "reason": reason,
        "remote_id": None if action == "blocked" else adapter.remote_id(kind, str(local_id)),
    }


async def _already_pushed(session: AsyncSession, config_id: uuid.UUID) -> set[str]:
    """Local ids this event has successfully executed before.

    Read from the push log rather than a column on every row: the log is
    already the record of what was sent, and it means a second push knows to
    say "update" instead of creating a duplicate.
    """
    rows = await session.execute(
        select(IntegrationPush.rows).where(
            IntegrationPush.integration_config_id == config_id,
            IntegrationPush.kind == PushKind.EXECUTE,
        )
    )
    sent: set[str] = set()
    for payload in rows.scalars().all():
        for entry in payload.get("items", []):
            if entry.get("action") != "blocked":
                sent.add(str(entry.get("local_id")))
    return sent


async def build_plan(session: AsyncSession, *, config_id: uuid.UUID) -> dict[str, Any]:
    """Every speaker and session this event would send, and what would happen.

    Scope is deliberately narrow: accepted speakers and scheduled sessions. A
    proposal nobody has decided on is not programme data, and pushing it to the
    registration platform would publish a decision that has not been made.
    """
    seen = await _already_pushed(session, config_id)
    items: list[dict[str, Any]] = []

    speakers = (
        (
            await session.execute(
                select(Speaker, EventSpeaker)
                .join(EventSpeaker, EventSpeaker.speaker_id == Speaker.id)
                .order_by(Speaker.name)
            )
        )
        .tuples()
        .all()
    )
    for speaker, link in speakers:
        if link.status not in (SpeakerStatus.ACCEPTED, SpeakerStatus.CONFIRMED):
            continue
        if not speaker.email:
            items.append(
                _row(
                    kind="speaker",
                    local_id=speaker.id,
                    label=speaker.name,
                    action="blocked",
                    reason="No email address, which Accelevents keys attendees on.",
                )
            )
            continue
        items.append(
            _row(
                kind="speaker",
                local_id=speaker.id,
                label=speaker.name,
                action="update" if str(speaker.id) in seen else "create",
            )
        )

    rooms = {room.id: room.name for room in (await session.execute(select(Room))).scalars().all()}
    talks = (await session.execute(select(Session).order_by(Session.title))).scalars().all()
    for talk in talks:
        if talk.status == SessionStatus.UNSCHEDULED or talk.starts_at is None:
            items.append(
                _row(
                    kind="session",
                    local_id=talk.id,
                    label=talk.title,
                    action="blocked",
                    reason="Not scheduled yet, so it has no time to publish.",
                )
            )
            continue
        if talk.room_id is None or talk.room_id not in rooms:
            items.append(
                _row(
                    kind="session",
                    local_id=talk.id,
                    label=talk.title,
                    action="blocked",
                    reason="No room, and the remote session requires a location.",
                )
            )
            continue
        items.append(
            _row(
                kind="session",
                local_id=talk.id,
                label=talk.title,
                action="update" if str(talk.id) in seen else "create",
            )
        )

    speaker_links = (await session.execute(select(SessionSpeaker))).scalars().all()

    summary = {
        "create": sum(1 for row in items if row["action"] == "create"),
        "update": sum(1 for row in items if row["action"] == "update"),
        "blocked": sum(1 for row in items if row["action"] == "blocked"),
        "speakers": sum(1 for row in items if row["kind"] == "speaker"),
        "sessions": sum(1 for row in items if row["kind"] == "session"),
        "assignments": len(speaker_links),
    }
    return {"summary": summary, "items": items}


async def record(
    session: AsyncSession,
    *,
    event_id: uuid.UUID,
    config_id: uuid.UUID,
    plan: dict[str, Any],
    kind: PushKind,
    user_id: uuid.UUID | None,
) -> IntegrationPush:
    """Persist what was planned, or what was sent. Same row either way — the
    difference between a rehearsal and a performance is one enum."""
    push = IntegrationPush(
        event_id=event_id,
        integration_config_id=config_id,
        kind=kind,
        summary=plan["summary"],
        rows={"items": plan["items"]},
        created_by_user_id=user_id,
    )
    session.add(push)
    await session.flush()
    return push
