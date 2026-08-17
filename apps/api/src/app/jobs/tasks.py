"""What the worker actually does on each pass.

Kept apart from the loop so every job is an ordinary async function that takes a
session: it can be called from a test, or from a one-off script, without starting
a worker or waiting for a tick.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import tenancy_disabled, tenant_scope
from app.features.submissions import service as proposals
from app.features.tasks import service as deliverables
from app.models import Event, EventStatus, SpeakerTask, TaskStatus


@dataclass(frozen=True, slots=True)
class SweepResult:
    events: int
    overdue: int
    reminded: int
    skipped: int
    #: Holders of an unfinished CFP draft told the call is about to close.
    #: Counted apart from `reminded`, which is deliverables: they are different
    #: people at different points in the funnel, and one number covering both
    #: would answer neither question.
    drafts_reminded: int = 0


#: Archived events are done with; a draft has nobody on it yet. Reminding either
#: is noise, and the second one would email people about a conference that has
#: not been announced.
ACTIVE = (
    EventStatus.CFP_OPEN,
    EventStatus.IN_REVIEW,
    EventStatus.SCHEDULED,
    EventStatus.LIVE,
)


async def _active_events(session: AsyncSession) -> list[Event]:
    with tenancy_disabled():
        return list(
            (await session.execute(select(Event).where(Event.status.in_(ACTIVE)))).scalars().all()
        )


async def count_overdue(session: AsyncSession, event_id: uuid.UUID, now: datetime) -> int:
    """How many deliverables are past their date.

    Overdue is derived rather than stored — a task is overdue because the clock
    passed its due date — so this counts rather than transitions. The sweep
    exists to *act* on that number, not to write it down.
    """
    rows = (
        (
            await session.execute(
                select(SpeakerTask).where(
                    SpeakerTask.event_id == event_id,
                    SpeakerTask.status.notin_([TaskStatus.COMPLETE, TaskStatus.SUBMITTED]),
                )
            )
        )
        .scalars()
        .all()
    )
    return sum(1 for row in rows if deliverables.derive_status(row, now) is TaskStatus.OVERDUE)


async def sweep(session: AsyncSession, *, remind: bool = True) -> SweepResult:
    """One pass over every active event.

    Reminders go through the same service the organiser's own bulk-nudge button
    calls, so the 24-hour floor per speaker per task is enforced once, in one
    place, rather than being reimplemented here and drifting.
    """
    now = datetime.now(UTC)
    events = await _active_events(session)
    overdue = reminded = skipped = drafts = 0

    for event in events:
        with tenant_scope(org_id=event.org_id, event_id=event.id):
            overdue += await count_overdue(session, event.id, now)
            if remind:
                sent, held = await deliverables.nudge_outstanding(session)
                reminded += sent
                skipped += held
                # The other half of the funnel: someone who never finished
                # submitting is not on the roster and owes no deliverable, so
                # nothing above would ever reach them.
                drafts += await proposals.remind_unfinished_drafts(session, event=event, now=now)
            await session.flush()

    return SweepResult(
        events=len(events),
        overdue=overdue,
        reminded=reminded,
        skipped=skipped,
        drafts_reminded=drafts,
    )
