"""Adversarial probes at the spec-0008 seams. Review artefact, not yet agreed.

Everything here goes through the same seams the agreed tests use: the write
catalog in-process, `answer()` over SSE, and the apply route over AsyncClient.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import date
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import create_resource
from app.core.tenancy import tenancy_disabled, tenant_scope
from app.features.ai import assistant
from app.features.program.resources import EVENT_DAY, ROOM
from app.features.program.schemas import EventDayCreate, RoomCreate
from app.models import AiProposal, EventDay, Room
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

# ───────────────── the card's index vs. the stored list's position ─────────────────


async def test_a_dropped_action_does_not_shift_the_cards_index(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    """The drawer presses `action.index`; the route indexes the stored list.

    A plan whose first entry is dropped makes those two disagree.
    """
    scripted(
        plan(
            {"name": "delete_room", "target": "Big One", "values": {}},
            create("create_room", name="Studio"),
        )
    )

    events = sse((await ask(client, world, "delete Big One and add Studio")).text)
    card = payload(events, "proposal")["actions"][0]

    assert card["index"] == 0, f"card claims index {card['index']} but is stored at position 0"


async def test_pressing_create_on_a_card_after_a_dropped_action_creates_that_card(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """The wrong-row case: two good actions behind one dropped one."""
    scripted(
        plan(
            {"name": "delete_room", "target": "Ghost", "values": {}},
            create("create_room", name="Alpha"),
            create("create_room", name="Beta"),
        )
    )
    body = sse((await ask(client, world, "delete Ghost, add Alpha and Beta")).text)
    proposal = payload(body, "proposal")
    cards = proposal["actions"]
    alpha = next(card for card in cards if card["values"]["name"] == "Alpha")

    result = (await _apply(client, world, str(proposal["proposal_id"]), [alpha["index"]])).json()

    assert result["results"][0]["label"] == "Alpha", result
    assert [room.name for room in await _rooms(session, world)] == ["Alpha"]


# ───────────────── a proposal of another kind ─────────────────


async def test_applying_a_proposal_that_is_not_a_program_change_is_refused(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """The `answer` rows the assistant already writes share this table."""
    scripted(json.dumps({"queries": [{"name": "event_overview", "args": {}}]}), "It has 0 rooms.")
    await ask(client, world, "how many rooms do I have")

    with tenancy_disabled():
        row = (
            await session.scalars(select(AiProposal).where(AiProposal.event_id == world.event.id))
        ).one()

    response = await _apply(client, world, str(row.id), [0])

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "AI_NOT_APPLICABLE"


# ───────────────── event days, which have both hooks ─────────────────


async def test_creating_an_event_day_outside_the_window_fails_that_action_alone(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    """Story 8, through the assistant rather than the writer directly."""
    scripted(plan(create("create_event_day", day_date="2099-01-01")))
    proposal_id = await _propose(client, world, "add a day on 1 Jan 2099")

    result = (await _apply(client, world, proposal_id, [0])).json()["results"][0]

    assert result["status"] == "failed"
    assert "outside the event" in result["error"]


async def test_moving_an_event_day_moves_its_sessions(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Story 15: the `on_update` hook is the writer's, so the AI path runs it."""
    from datetime import UTC, datetime

    from app.models import Session as SessionRow
    from app.models import SessionStatus

    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        day = await create_resource(session, EVENT_DAY, EventDayCreate(day_date=date(2027, 5, 12)))
        await session.flush()
        talk = SessionRow(
            org_id=world.org_id,
            event_id=world.event.id,
            title="Keynote",
            slug="keynote",
            event_day_id=day.id,
            starts_at=datetime(2027, 5, 12, 9, 0, tzinfo=UTC),
            duration_minutes=30,
            status=SessionStatus.SCHEDULED,
        )
        session.add(talk)
        await session.commit()

    scripted(plan(edit("update_event_day", "2027-05-12", day_date="2027-05-13")))
    proposal_id = await _propose(client, world, "move the first day to the 13th")

    result = (await _apply(client, world, proposal_id, [0])).json()["results"][0]

    assert result["status"] == "applied", result
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        moved = (await session.scalars(select(SessionRow).where(SessionRow.id == talk.id))).one()
        await session.refresh(moved)
        day_row = (await session.scalars(select(EventDay).where(EventDay.id == day.id))).one()
        await session.refresh(day_row)
    assert day_row.day_date == date(2027, 5, 13)
    assert moved.starts_at is not None and moved.starts_at.date() == date(2027, 5, 13)


# ───────────────── hostile arguments ─────────────────


async def test_a_deeply_nested_values_object_is_dropped_not_carried(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    nested: Any = {"name": "Big One"}
    for _ in range(60):
        nested = {"name": nested}
    scripted(plan({"name": "create_room", "values": nested}, create("create_room", name="Studio")))

    events = sse((await ask(client, world, "add rooms")).text)

    assert [card["values"]["name"] for card in payload(events, "proposal")["actions"]] == ["Studio"]


async def test_a_target_that_is_only_whitespace_is_refused(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        await create_resource(session, ROOM, RoomCreate(name="Big One"))
        await session.commit()
    scripted(plan(edit("update_room", "   ", capacity=80)))

    events = sse((await ask(client, world, "make it bigger")).text)

    assert "proposal" not in names(events)


async def test_a_target_matching_two_rows_by_case_alone_never_guesses(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Two rows a case-fold apart is a real ambiguity, not a first-match."""
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        await create_resource(session, ROOM, RoomCreate(name="Studio"))
        await create_resource(session, ROOM, RoomCreate(name="STUDIO"))
        await session.commit()
    scripted(plan(edit("update_room", "studio", capacity=80)), resolved(None))

    events = sse((await ask(client, world, "make studio hold 80")).text)

    assert names(events)[-1] == "clarify"


# ───────────────── batch size ─────────────────


async def test_every_card_drawn_can_be_applied(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    """A greedy plan is trimmed, not half-drawn.

    The review found `ApplyRequest.indexes` capped at 25 while the planner had no
    cap, so a 30-action plan drew 30 cards and "Apply all 30" was refused
    outright — the drawer then marked every card failed. Resolved by capping the
    cards at the same number rather than by raising the route's limit: a screen
    that cannot offer more than it can deliver needs no error path for the case.
    """
    scripted(plan(*[create("create_room", name=f"Room {n:02d}") for n in range(30)]))
    proposal_id = await _propose(client, world, "add thirty rooms")

    cards = await _cards(client, world, proposal_id)
    assert len(cards) == assistant.MAX_ACTIONS

    response = await _apply(client, world, proposal_id, [card["index"] for card in cards])

    assert response.status_code == 200, response.text
    assert all(result["status"] == "applied" for result in response.json()["results"])


# ───────────────── two presses at once ─────────────────


async def test_two_concurrent_applies_of_one_index_make_one_row(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Story 25 under a race rather than in sequence: a genuine double-click
    fires two requests before the first has committed."""
    scripted(plan(create("create_room", name="Big One")))
    proposal_id = await _propose(client, world, "add Big One")

    first, second = await asyncio.gather(
        _apply(client, world, proposal_id, [0]),
        _apply(client, world, proposal_id, [0]),
    )

    statuses = sorted([first.json()["results"][0]["status"], second.json()["results"][0]["status"]])
    assert len(await _rooms(session, world)) == 1
    assert statuses == ["applied", "applied"], statuses


async def test_two_concurrent_applies_of_one_update_index_are_not_two_updates(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """An update has no unique constraint to save it the way a create does."""
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        await create_resource(session, ROOM, RoomCreate(name="Big One", capacity=60))
        await session.commit()
    scripted(plan(edit("update_room", "Big One", capacity=80)))
    proposal_id = await _propose(client, world, "set Big One to 80")

    first, second = await asyncio.gather(
        _apply(client, world, proposal_id, [0]),
        _apply(client, world, proposal_id, [0]),
    )

    with tenancy_disabled():
        row = (
            await session.scalars(select(AiProposal).where(AiProposal.id == uuid.UUID(proposal_id)))
        ).one()
        await session.refresh(row)
    applied_ids = {
        first.json()["results"][0]["id"],
        second.json()["results"][0]["id"],
    }
    assert len(applied_ids) == 1, "two presses recorded two different rows"
    assert row.output["actions"][0]["status"] == "applied"


async def test_a_room_created_by_the_assistant_is_readable_over_the_setup_route(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    """The apply path and the setup screen have to agree afterwards."""
    scripted(plan(create("create_room", name="Big One", capacity=60)))
    proposal_id = await _propose(client, world, "add Big One")

    await _apply(client, world, proposal_id, [0])
    listed = await client.get(f"/v1/events/{world.event.id}/rooms", headers=world.admin)

    assert [(room["name"], room["capacity"]) for room in listed.json()] == [("Big One", 60)]
    assert listed.json()[0]["session_count"] == 0


async def test_an_unknown_proposal_id_is_a_404(client: AsyncClient, world: World) -> None:
    response = await _apply(client, world, str(uuid.uuid4()), [0])

    assert response.status_code == 404


async def test_a_room_name_of_only_unicode_survives_the_round_trip(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    name = "会議室 🎤 Ω"
    scripted(plan(create("create_room", name=name)))
    proposal_id = await _propose(client, world, "add a room")

    result = (await _apply(client, world, proposal_id, [0])).json()["results"][0]

    assert result["status"] == "applied", result
    assert result["label"] == name
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        assert (await session.scalars(select(Room))).one().name == name


# ───────────────── the candidate window ─────────────────


async def test_a_row_past_the_candidate_limit_is_still_editable(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """`resolve` reads `ORDER BY name LIMIT 25`, so an exactly-named row sorting
    past the 25th is invisible to it."""
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        for n in range(30):
            await create_resource(session, ROOM, RoomCreate(name=f"Room {n:02d}"))
        await session.commit()
    scripted(plan(edit("update_room", "Room 29", capacity=80)), resolved(None))

    events = sse((await ask(client, world, "set Room 29 capacity to 80")).text)

    assert "proposal" in names(events), f"exact name unreachable: {names(events)}"


async def test_an_unresolvable_edit_does_not_discard_a_sibling_create(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    """`_plan_actions` returns on the first clarify, dropping cards already built."""
    scripted(
        plan(
            create("create_room", name="Alpha"),
            edit("update_room", "Ghost", capacity=80),
        )
    )

    events = sse((await ask(client, world, "add Alpha and make Ghost hold 80")).text)

    assert "proposal" in names(events), f"the create was thrown away: {names(events)}"
