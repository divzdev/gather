"""Which event an account lands on when it signs in.

`GET /v1/events` is not just a list: the console adopts `events[0]` at sign-in,
and again when a stored event id goes stale. So the order decides what an
organiser sees first, and getting it wrong hides the event they are actually
running behind one they are not.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import tenancy_disabled
from app.models import Event, EventStatus

# The event-with-an-admin fixture, reused rather than rebuilt.
from test_cfp_flow import cfp  # noqa: F401

Cfp = tuple[dict[str, str], Event, object]


async def _add_event(session: AsyncSession, org_id: uuid.UUID, name: str, starts: date) -> Event:
    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        event = Event(
            org_id=org_id,
            name=name,
            slug=f"{name.lower().replace(' ', '-')}-{suffix}",
            timezone="UTC",
            starts_on=starts,
            ends_on=starts + timedelta(days=2),
            status=EventStatus.DRAFT,
        )
        session.add(event)
        # Committed, not just flushed: the API answers on its own session and
        # cannot see an uncommitted row.
        await session.commit()
    return event


async def _names(client: AsyncClient, headers: dict[str, str]) -> list[str]:
    response = await client.get("/v1/events", headers=headers)
    assert response.status_code == 200
    return [row["name"] for row in response.json()]


async def test_a_later_event_does_not_displace_the_one_being_run(
    client: AsyncClient, session: AsyncSession, cfp: Cfp
) -> None:
    """The defect this ordering exists to prevent.

    Someone creates a throwaway event dated further out than the real one. Under
    `starts_on DESC` the throwaway became `events[0]`, so every later sign-in
    landed on an empty first-run dashboard and the populated event vanished
    behind a switcher nobody knew to open.
    """
    headers, running, _form = cfp
    far = await _add_event(
        session, running.org_id, "Forward Summit", running.starts_on + timedelta(days=365)
    )

    names = await _names(client, headers)

    assert names[0] == running.name, (
        f"signing in lands on {names[0]!r}; a throwaway event dated later "
        f"displaced the event being run"
    )
    assert far.name in names, "the later event should still be reachable, just not first"


async def test_the_soonest_upcoming_event_comes_first(
    client: AsyncClient, session: AsyncSession, cfp: Cfp
) -> None:
    headers, running, _form = cfp
    await _add_event(session, running.org_id, "Later", running.starts_on + timedelta(days=30))
    await _add_event(session, running.org_id, "Latest", running.starts_on + timedelta(days=60))

    assert await _names(client, headers) == [running.name, "Later", "Latest"]


async def test_a_finished_event_sorts_below_an_upcoming_one(
    client: AsyncClient, session: AsyncSession, cfp: Cfp
) -> None:
    """Even though it started sooner. Recency is not the question an organiser is
    asking; "what am I running" is."""
    headers, running, _form = cfp
    done = await _add_event(
        session, running.org_id, "Last Year", date.today() - timedelta(days=400)
    )

    names = await _names(client, headers)

    assert names.index(running.name) < names.index(done.name), (
        "a finished event outranked the one still to run"
    )
