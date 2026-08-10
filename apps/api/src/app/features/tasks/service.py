"""Onboarding deliverables: what each accepted speaker still owes you.

Two rules shape everything here. **Overdue is derived**, never a transition a
caller performs — a task is overdue because the clock passed its due date, so it
is computed on read and can un-overdue itself when a date moves. And **a nudge
has a 24-hour floor** per speaker per task, so a bulk reminder run twice in a
morning emails nobody twice; it reports what it skipped instead of pretending.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, time, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import mail
from app.core.errors import ApiError
from app.core.tenancy import current_tenant, tenancy_disabled
from app.models import (
    Event,
    EventSpeaker,
    MessagePurpose,
    Session,
    SessionSpeaker,
    Speaker,
    SpeakerTask,
    TaskFile,
    TaskStatus,
    TaskTemplate,
)

NUDGE_FLOOR = timedelta(hours=24)
OPEN_STATUSES = (TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS, TaskStatus.OVERDUE)


async def _event(session: AsyncSession) -> Event:
    tenant = current_tenant()
    with tenancy_disabled():
        event = await session.get(Event, tenant.event_id)
    if event is None:  # pragma: no cover - bind_tenant proved it exists
        raise ApiError("This event is missing.", code="NOT_FOUND", status_code=404)
    return event


def resolve_due(rule: dict[str, Any], event: Event) -> datetime | None:
    """Turn a template's rule into a real date at assignment time.

    Stored as a rule rather than a date so "two weeks before the doors open"
    survives the organiser moving the conference.
    """
    kind = rule.get("type")
    if kind == "fixed" and rule.get("date"):
        parsed = datetime.fromisoformat(str(rule["date"]))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    if kind == "relative":
        days = int(rule.get("days_before_event", 0))
        return datetime.combine(event.starts_on - timedelta(days=days), time(23, 59), tzinfo=UTC)
    return None


def derive_status(task: SpeakerTask, now: datetime | None = None) -> TaskStatus:
    """`overdue` is a view of the clock, so it is never stored as a transition."""
    if task.status in (TaskStatus.COMPLETE, TaskStatus.SUBMITTED):
        return task.status
    if task.due_at is not None and task.due_at < (now or datetime.now(UTC)):
        return TaskStatus.OVERDUE
    return task.status


async def _speakers_in_scope(session: AsyncSession, applies_to: dict[str, Any]) -> list[uuid.UUID]:
    """Everyone on the roster, or only those speaking in named tracks/formats."""
    roster = list((await session.execute(select(EventSpeaker.speaker_id))).scalars().all())
    scope = applies_to.get("scope", "all")
    if scope == "all" or not applies_to.get("ids"):
        return roster

    column = Session.track_id if scope == "track" else Session.session_format_id
    matched = set(
        (
            await session.execute(
                select(SessionSpeaker.speaker_id)
                .join(Session, Session.id == SessionSpeaker.session_id)
                .where(column.in_([uuid.UUID(str(i)) for i in applies_to["ids"]]))
            )
        )
        .scalars()
        .all()
    )
    return [speaker_id for speaker_id in roster if speaker_id in matched]


async def assign(session: AsyncSession, template: TaskTemplate) -> int:
    """Materialise this template onto every speaker it applies to.

    Idempotent: a speaker who already has the task keeps the task, and their due
    date, rather than being handed a second copy.
    """
    event = await _event(session)
    due_at = resolve_due(template.due_rule, event)

    already = set(
        (
            await session.execute(
                select(SpeakerTask.speaker_id).where(SpeakerTask.task_template_id == template.id)
            )
        )
        .scalars()
        .all()
    )
    created = 0
    for speaker_id in await _speakers_in_scope(session, template.applies_to):
        if speaker_id in already:
            continue
        session.add(
            SpeakerTask(
                speaker_id=speaker_id,
                task_template_id=template.id,
                due_at=due_at,
                status=TaskStatus.NOT_STARTED,
            )
        )
        created += 1
    await session.flush()
    return created


async def load_rows(
    session: AsyncSession, *, speaker_id: uuid.UUID | None = None
) -> list[tuple[SpeakerTask, TaskTemplate, Speaker]]:
    query = (
        select(SpeakerTask, TaskTemplate, Speaker)
        .join(TaskTemplate, TaskTemplate.id == SpeakerTask.task_template_id)
        .join(Speaker, Speaker.id == SpeakerTask.speaker_id)
        .order_by(SpeakerTask.due_at.nulls_last(), TaskTemplate.sort_order, Speaker.name)
    )
    if speaker_id is not None:
        query = query.where(SpeakerTask.speaker_id == speaker_id)
    return list((await session.execute(query)).tuples().all())


async def file_ids_by_task(
    session: AsyncSession, task_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    if not task_ids:
        return {}
    rows = (
        (
            await session.execute(
                select(TaskFile.speaker_task_id, TaskFile.file_id).where(
                    TaskFile.speaker_task_id.in_(task_ids)
                )
            )
        )
        .tuples()
        .all()
    )
    grouped: dict[uuid.UUID, list[uuid.UUID]] = {}
    for task_id, file_id in rows:
        grouped.setdefault(task_id, []).append(file_id)
    return grouped


async def nudge_outstanding(
    session: AsyncSession, *, speaker_ids: list[uuid.UUID] | None = None
) -> tuple[int, int]:
    """One email per speaker listing everything they still owe.

    Returns (sent, skipped). A speaker nudged in the last 24 hours is skipped —
    the floor is per speaker per task, and the count is reported rather than
    silently swallowed.
    """
    event = await _event(session)
    now = datetime.now(UTC)
    rows = await load_rows(session)

    pending: dict[uuid.UUID, tuple[Speaker, list[SpeakerTask], list[str]]] = {}
    skipped = 0
    for task, template, speaker in rows:
        if speaker_ids is not None and speaker.id not in speaker_ids:
            continue
        if derive_status(task, now) not in OPEN_STATUSES:
            continue
        if task.last_nudged_at is not None and now - task.last_nudged_at < NUDGE_FLOOR:
            skipped += 1
            continue
        bucket = pending.setdefault(speaker.id, (speaker, [], []))
        bucket[1].append(task)
        bucket[2].append(template.name)

    for speaker, tasks, names in pending.values():
        listed = "".join(f"<li>{name}</li>" for name in names)
        plural = "s" if len(names) > 1 else ""
        await mail.send_now(
            session,
            event_id=event.id,
            to_email=speaker.email,
            to_speaker_id=speaker.id,
            purpose=MessagePurpose.TASK_REMINDER,
            subject=f"{len(names)} outstanding item{plural} for {event.name}",
            body=(
                f"<p>Hi {speaker.name},</p><p>These are still outstanding for "
                f"{event.name}:</p><ul>{listed}</ul>"
            ),
        )
        for task in tasks:
            task.last_nudged_at = now

    await session.flush()
    return len(pending), skipped
