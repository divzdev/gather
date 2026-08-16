"""Second-pass adversarial probes at the spec-0008 seams. Review artefact.

Attacks the *fixes* from review iteration 1: the survivor-counted card index, the
separate exact-match query in `write_catalog.resolve`, and the advisory lock in
`apply`.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import date
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import db
from app.core.crud import create_resource
from app.core.tenancy import tenancy_disabled, tenant_scope
from app.features.ai import apply as apply_service
from app.features.ai import proposals, propose
from app.features.program.resources import EVENT_DAY, ROOM
from app.features.program.schemas import EventDayCreate, RoomCreate
from app.models import AiProposal, AiProposalStatus, EventDay, Room
from test_ai_apply import _apply, _cards, _propose, _rooms
from test_ai_assistant import (  # noqa: F401
    World,
    ask,
    names,
    no_model_configured,
    payload,
    scripted,
    sessions_hit_the_test_database,
    sse,
    world,
)
from test_ai_assistant_writes import create, edit, plan, resolved

BAD = {"name": "delete_room", "target": "Ghost", "values": {}}


# ─────────────── the card index, attacked harder ───────────────


async def test_two_drops_before_and_between_do_not_shift_the_index(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Drops at the front, in the middle and at the end, all in one plan."""
    scripted(
        plan(
            BAD,
            BAD,
            create("create_room", name="Alpha"),
            BAD,
            create("create_room", name="Beta"),
            BAD,
        )
    )
    proposal = payload(sse((await ask(client, world, "do six things")).text), "proposal")
    cards = proposal["actions"]

    assert [card["values"]["name"] for card in cards] == ["Alpha", "Beta"]
    assert [card["index"] for card in cards] == [0, 1]

    beta = cards[1]
    result = (await _apply(client, world, str(proposal["proposal_id"]), [beta["index"]])).json()
    assert result["results"][0]["label"] == "Beta", result
    assert [room.name for room in await _rooms(session, world)] == ["Beta"]


async def test_a_card_after_an_unresolvable_edit_creates_that_card(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """An edit that survives `parse` but dies on the resolution ladder is the
    *other* way an action leaves the plan, and it is a different code path from
    a dropped parse."""
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        await create_resource(session, ROOM, RoomCreate(name="Existing"))
        await session.commit()
    scripted(
        plan(
            create("create_room", name="Alpha"),
            edit("update_room", "Ghost", capacity=80),
            create("create_room", name="Beta"),
        ),
        resolved(None),
    )
    proposal = payload(sse((await ask(client, world, "three things")).text), "proposal")
    cards = proposal["actions"]

    assert [card["values"]["name"] for card in cards] == ["Alpha", "Beta"]
    assert [card["index"] for card in cards] == [0, 1]
    assert proposal["questions"], "the unresolvable edit should still be asked about"

    result = (await _apply(client, world, str(proposal["proposal_id"]), [1])).json()
    assert result["results"][0]["label"] == "Beta", result


async def test_the_action_cap_counts_survivors_not_plan_entries(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    """Thirty good creates hidden behind thirty drops still fills the card cap."""
    entries: list[dict[str, Any]] = []
    for n in range(30):
        entries.append(BAD)
        entries.append(create("create_room", name=f"Room {n:02d}"))
    scripted(plan(*entries))
    proposal_id = await _propose(client, world, "add thirty rooms the hard way")

    cards = await _cards(client, world, proposal_id)
    assert len(cards) == propose.MAX_ACTIONS
    assert [card["index"] for card in cards] == list(range(propose.MAX_ACTIONS))

    response = await _apply(client, world, proposal_id, [card["index"] for card in cards])
    assert response.status_code == 200, response.text
    assert all(result["status"] == "applied" for result in response.json()["results"])
    assert sorted(result["label"] for result in response.json()["results"]) == sorted(
        card["values"]["name"] for card in cards
    )


# ─────────────── the exact-match query ───────────────


async def test_a_row_whose_name_casefolds_differently_can_still_be_applied(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """`func.lower()` is Postgres; `.casefold()` is Python, and for 'Straße' they
    disagree ('straße' vs 'strasse'). The ladder still draws the card, because a
    model picks the candidate by label — and then `apply` re-resolves by exact
    match and cannot find the row it just drew a card for.
    """
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        await create_resource(session, ROOM, RoomCreate(name="Straße", capacity=60))
        await session.commit()
    scripted(plan(edit("update_room", "Straße", capacity=80)), resolved("Straße"))

    events = sse((await ask(client, world, "make Straße hold 80")).text)
    assert "proposal" in names(events), names(events)
    proposal = payload(events, "proposal")

    result = (await _apply(client, world, str(proposal["proposal_id"]), [0])).json()["results"][0]

    assert result["status"] == "applied", result
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        assert (await session.scalars(select(Room))).one().capacity == 80


async def test_an_event_day_is_resolved_by_its_iso_date(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """The date cast: `cast(day_date AS text)` under `DateStyle=ISO`."""
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        await create_resource(session, EVENT_DAY, EventDayCreate(day_date=date(2027, 5, 12)))
        await create_resource(session, EVENT_DAY, EventDayCreate(day_date=date(2027, 5, 13)))
        await session.commit()
    scripted(plan(edit("update_event_day", "2027-05-13", label="Day Two")))

    events = sse((await ask(client, world, "call 13 May Day Two")).text)

    card = payload(events, "proposal")["actions"][0]
    assert card["target"] == "2027-05-13", card


async def test_a_human_written_date_falls_to_the_ladder_rather_than_the_wrong_day(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """ "13 May 2027" is not what the cast produces, so the exact query misses and
    the resolution call is asked — which must not be allowed to invent."""
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        await create_resource(session, EVENT_DAY, EventDayCreate(day_date=date(2027, 5, 12)))
        await create_resource(session, EVENT_DAY, EventDayCreate(day_date=date(2027, 5, 13)))
        await session.commit()
    scripted(plan(edit("update_event_day", "13 May 2027", label="Day Two")), resolved("2027-05-13"))

    card = payload(sse((await ask(client, world, "call 13 May Day Two")).text), "proposal")[
        "actions"
    ][0]

    assert card["target"] == "2027-05-13", card


async def test_a_resolution_call_naming_a_day_that_does_not_exist_is_not_taken(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        await create_resource(session, EVENT_DAY, EventDayCreate(day_date=date(2027, 5, 12)))
        await session.commit()
    scripted(
        plan(edit("update_event_day", "the second day", label="Day Two")), resolved("2027-09-09")
    )

    events = sse((await ask(client, world, "label the second day")).text)

    assert names(events)[-1] == "clarify", names(events)


# ─────────────── apply, under contention ───────────────


async def test_applying_a_proposal_discarded_while_the_press_was_in_flight_writes_nothing(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Story: two tabs. `apply` reads `status` *before* it takes the lock and
    refreshes, so a Discard that commits in between is not seen.

    Made deterministic by holding the same advisory lock from this test's own
    session, so the apply request is parked at the lock while the discard commits.
    """
    scripted(plan(create("create_room", name="Big One")))
    proposal_id = await _propose(client, world, "add Big One")

    await session.execute(
        text("SELECT pg_advisory_lock(hashtext('ai_apply'), hashtext(:proposal))"),
        {"proposal": proposal_id},
    )
    pressed = asyncio.create_task(_apply(client, world, proposal_id, [0]))
    await asyncio.sleep(0.3)  # let the request reach the lock and park there

    discarded = await client.post(
        f"/v1/events/{world.event.id}/ai/proposals/{proposal_id}/discard", headers=world.admin
    )
    assert discarded.status_code == 200, discarded.text

    await session.execute(
        text("SELECT pg_advisory_unlock(hashtext('ai_apply'), hashtext(:proposal))"),
        {"proposal": proposal_id},
    )
    response = await pressed

    assert response.status_code == 409, response.text
    assert await _rooms(session, world) == []


async def test_two_concurrent_applies_of_different_proposals_do_not_deadlock(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    scripted(plan(create("create_room", name="Alpha")))
    first_id = await _propose(client, world, "add Alpha")
    scripted(plan(create("create_room", name="Beta")))
    second_id = await _propose(client, world, "add Beta")

    left, right = await asyncio.gather(
        _apply(client, world, first_id, [0]),
        _apply(client, world, second_id, [0]),
    )

    assert left.status_code == 200 and right.status_code == 200
    assert sorted(room.name for room in await _rooms(session, world)) == ["Alpha", "Beta"]


async def test_a_second_press_of_a_failed_action_retries_rather_than_reports_applied(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """A failure is not a terminal state: fix the clash, press again."""
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        await create_resource(session, ROOM, RoomCreate(name="Big One"))
        await session.commit()
    scripted(plan(create("create_room", name="Big One")))
    proposal_id = await _propose(client, world, "add Big One")

    first = (await _apply(client, world, proposal_id, [0])).json()["results"][0]
    assert first["status"] == "failed", first

    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        clash = (await session.scalars(select(Room))).one()
        await session.delete(clash)
        await session.commit()

    second = (await _apply(client, world, proposal_id, [0])).json()["results"][0]

    assert second["status"] == "applied", second


async def test_a_fully_applied_proposal_keeps_its_resolved_at(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """`_resolution` recomputes over every action on every press."""
    scripted(plan(create("create_room", name="Alpha"), create("create_room", name="Beta")))
    proposal_id = await _propose(client, world, "add two")

    await _apply(client, world, proposal_id, [0, 1])
    with tenancy_disabled():
        row = (
            await session.scalars(select(AiProposal).where(AiProposal.id == uuid.UUID(proposal_id)))
        ).one()
        await session.refresh(row)
        first_stamp = row.resolved_at
    assert row.status is AiProposalStatus.ACCEPTED

    await _apply(client, world, proposal_id, [0])
    with tenancy_disabled():
        await session.refresh(row)

    assert row.resolved_at == first_stamp, "a re-press moved the acceptance timestamp"


async def test_a_moved_day_that_fails_leaves_its_sessions_where_they_were(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """The `on_update` hook writes beyond its own row; the SAVEPOINT has to undo
    that too when a later action in the same batch fails."""
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        await create_resource(session, EVENT_DAY, EventDayCreate(day_date=date(2027, 5, 12)))
        await create_resource(session, EVENT_DAY, EventDayCreate(day_date=date(2027, 5, 13)))
        await session.commit()
    scripted(plan(edit("update_event_day", "2027-05-12", day_date="2027-05-13")))
    proposal_id = await _propose(client, world, "move day one onto day two")

    result = (await _apply(client, world, proposal_id, [0])).json()["results"][0]

    assert result["status"] == "failed", result
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        days = sorted(day.day_date for day in (await session.scalars(select(EventDay))).all())
    assert days == [date(2027, 5, 12), date(2027, 5, 13)], days


async def test_apply_waits_while_another_press_holds_the_lock(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    """The advisory lock, proven by contention rather than assumed.

    Review found the earlier "concurrent" tests were nothing of the kind: an
    `AsyncClient` over ASGI serialises requests, and so does the test pool, so
    deleting the lock left them green five runs out of five. They asserted
    sequential idempotency, which already worked without it.

    Two presses cannot be made to genuinely race in this harness — so this
    asserts the mechanism instead: while another connection holds the same
    advisory key, `apply()` **does not proceed**, and it completes once the key
    is released. That is the property the race depends on, and it is observable.
    """
    scripted(plan(create("create_room", name="Big One")))
    proposal_id = uuid.UUID(await _propose(client, world, "add Big One"))

    async def press() -> list[Any]:
        async with db.session_factory() as session, session.begin():
            with tenant_scope(org_id=world.org_id, event_id=world.event.id):
                proposal = await proposals.get(session, proposal_id)
                return await apply_service.apply(session, proposal=proposal, indexes=[0])

    async with db.session_factory() as holder:
        # The transaction stays **open** for the duration. Committing here would
        # return this connection to the pool, `press()` could check out the same
        # one, and a Postgres advisory lock is re-entrant within a backend — the
        # test would pass with the lock deleted. (It did, until this was fixed.)
        async with holder.begin():
            await holder.execute(
                text("SELECT pg_advisory_xact_lock(hashtext('ai_apply'), hashtext(:proposal))"),
                {"proposal": str(proposal_id)},
            )

            pressing = asyncio.create_task(press())
            # Long enough that an unlocked apply would be long finished — the
            # whole operation is a handful of statements on a warm connection.
            await asyncio.sleep(1.0)
            assert not pressing.done(), "apply did not wait for the lock"

        # Leaving the block commits, which drops the transaction-scoped lock.
        results = await asyncio.wait_for(pressing, timeout=10)

    assert results[0].status == "applied"
