"""The assistant proposing a change — spec 0008, seam 2.

Same seam and same scripted adapter as `test_ai_assistant.py`: `answer()` in,
SSE events out. What is new is the resolution ladder, and it is worth saying why
it is tested this hard. Every other failure here is visible — a card with the
wrong capacity is read before it is approved. Resolving to the *wrong row* is the
one failure that looks exactly like success, so the rungs are asserted
separately: resolved, unresolvable, out-of-list, and nothing-to-resolve.

Call counts are asserted throughout, because "the second call is spent only on
the ambiguous path" is a cost claim, and cost claims rot silently.
"""

from __future__ import annotations

import json
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import create_resource
from app.core.tenancy import tenancy_disabled, tenant_scope
from app.features.program.resources import ROOM
from app.features.program.schemas import RoomCreate
from app.models import AiProposal, AiProposalKind, AiProposalStatus
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


def plan(*actions: dict[str, Any]) -> str:
    return json.dumps({"queries": [], "actions": list(actions), "clarify": None, "refusal": None})


def create(action: str, **values: Any) -> dict[str, Any]:
    return {"name": action, "values": values}


def edit(action: str, target: str, **values: Any) -> dict[str, Any]:
    return {"name": action, "target": target, "values": values}


def resolved(match: str | None) -> str:
    return json.dumps({"match": match})


async def _rooms(session: AsyncSession, world: World, *names_: str) -> None:
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        for name in names_:
            await create_resource(session, ROOM, RoomCreate(name=name))
        await session.commit()


async def _proposals(session: AsyncSession, world: World) -> list[AiProposal]:
    with tenancy_disabled():
        return list(
            (
                await session.scalars(
                    select(AiProposal).where(AiProposal.event_id == world.event.id)
                )
            ).all()
        )


# ─────────────────────────── creating ───────────────────────────


async def test_a_create_is_proposed_and_nothing_is_written(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """The whole feature in one test: a card comes back, the database does not
    move (stories 1, 26)."""
    fake = scripted(plan(create("create_room", name="Big One", capacity=60)))

    events = sse((await ask(client, world, "add a room called Big One with capacity 60")).text)

    assert names(events) == ["planning", "model", "proposal"]
    actions = payload(events, "proposal")["actions"]
    assert len(actions) == 1
    assert actions[0]["verb"] == "create"
    assert actions[0]["values"] == {"name": "Big One", "capacity": 60}
    assert actions[0]["status"] == "proposed"
    assert len(fake.seen) == 1, "a create needs no second call"

    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        assert (await session.scalars(select(ROOM.model))).all() == []


async def test_three_rooms_are_three_actions_on_one_row(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Story 3 for the cards; story 35 for the bill. One question, one count
    against the daily cap, however many cards it draws."""
    scripted(
        plan(
            create("create_room", name="Big One"),
            create("create_room", name="Small One"),
            create("create_room", name="Studio"),
        )
    )

    events = sse((await ask(client, world, "add rooms Big One, Small One and Studio")).text)

    assert len(payload(events, "proposal")["actions"]) == 3
    rows = await _proposals(session, world)
    assert len(rows) == 1
    assert rows[0].kind is AiProposalKind.PROGRAM_CHANGE
    assert rows[0].status is AiProposalStatus.READY


async def test_an_action_the_catalog_does_not_have_is_dropped_not_attempted(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    """Story 33. The good action still lands — a plan with one invented entry is
    not a reason to answer nothing."""
    scripted(
        plan(
            {"name": "delete_room", "target": "Big One", "values": {}},
            create("create_room", name="Studio"),
        )
    )

    events = sse((await ask(client, world, "delete Big One and add Studio")).text)

    actions = payload(events, "proposal")["actions"]
    assert [action["name"] for action in actions] == ["create_room"]


async def test_values_that_do_not_fit_the_resource_drop_that_action(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    scripted(
        plan(
            create("create_room", name="Big One", capacity=-4),
            create("create_room", name="Studio"),
        )
    )

    events = sse((await ask(client, world, "add two rooms")).text)

    assert [a["name"] for a in payload(events, "proposal")["actions"]] == ["create_room"]
    assert payload(events, "proposal")["actions"][0]["values"] == {"name": "Studio"}


async def test_a_plan_with_nothing_left_after_dropping_is_an_error_not_an_empty_card(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    """An empty proposal card is a worse outcome than a sentence saying it could
    not be done — the card would look like something to press."""
    scripted(plan({"name": "delete_room", "target": "Big One", "values": {}}))

    events = sse((await ask(client, world, "delete Big One")).text)

    assert "proposal" not in names(events)
    assert names(events)[-1] in {"error", "refusal"}


# ─────────────────────────── the resolution ladder ───────────────────────────


async def test_an_exact_name_resolves_with_no_second_call(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """The common edit costs one call, same as a create (story 24)."""
    await _rooms(session, world, "Big One")
    fake = scripted(plan(edit("update_room", "Big One", capacity=80)))

    events = sse((await ask(client, world, "set Big One's capacity to 80")).text)

    action = payload(events, "proposal")["actions"][0]
    assert action["target"] == "Big One"
    assert action["before"] == {"capacity": None}
    assert len(fake.seen) == 1


async def test_an_inexact_name_is_resolved_by_the_second_call(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Stories 19 and 20: it works it out rather than bouncing the question back,
    and the card names what it worked out so a wrong pick is visible."""
    await _rooms(session, world, "Big One", "Studio")
    fake = scripted(plan(edit("update_room", "the big room", capacity=80)), resolved("Big One"))

    events = sse((await ask(client, world, "make the big room hold 80")).text)

    assert "resolving" in names(events)
    action = payload(events, "proposal")["actions"][0]
    assert action["target"] == "Big One"
    assert len(fake.seen) == 2

    # The candidate list is what went into the prompt, and it carries names only.
    asked = fake.seen[1]["user"]
    assert "Big One" in asked and "Studio" in asked
    assert str(world.event.id) not in asked


async def test_a_model_that_cannot_choose_asks_the_organiser(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Story 20. Being asked means something, because it only happens here."""
    await _rooms(session, world, "Studio", "Studio B")
    scripted(plan(edit("update_room", "the studio", capacity=80)), resolved(None))

    events = sse((await ask(client, world, "make the studio hold 80")).text)

    assert names(events)[-1] == "clarify"
    question = payload(events, "clarify")["question"]
    assert "Studio" in question and "Studio B" in question


async def test_a_match_that_is_not_on_the_list_is_treated_as_cannot_tell(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """A model answering with a room that does not exist must not create one, and
    must not be trusted to have meant the nearest thing."""
    await _rooms(session, world, "Big One", "Studio")
    scripted(plan(edit("update_room", "the big room", capacity=80)), resolved("Main Hall"))

    events = sse((await ask(client, world, "make the big room hold 80")).text)

    assert names(events)[-1] == "clarify"
    assert "proposal" not in names(events)


async def test_an_edit_with_nothing_to_resolve_against_asks_immediately(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    """No rooms at all: there is nothing for a second call to choose between, so
    it is not spent (story 24)."""
    fake = scripted(plan(edit("update_room", "Big One", capacity=80)))

    events = sse((await ask(client, world, "set Big One's capacity to 80")).text)

    assert names(events)[-1] == "clarify"
    assert len(fake.seen) == 1


async def test_the_planner_asking_for_a_missing_name_never_reaches_resolution(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    """Story 21: no amount of thinking invents a name nobody said, so a create
    with no name is a question on the first call."""
    fake = scripted(
        json.dumps(
            {
                "queries": [],
                "actions": [],
                "clarify": "What should the room be called?",
                "refusal": None,
            }
        )
    )

    events = sse((await ask(client, world, "add a room")).text)

    assert names(events)[-1] == "clarify"
    assert len(fake.seen) == 1


# ─────────────────────────── the rules that must not bend ───────────────────────────


async def test_a_plan_that_reads_and_writes_keeps_the_write(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    """Story 36. The organiser is about to be shown something to approve; running
    queries underneath it would make half the reply about something else."""
    scripted(
        json.dumps(
            {
                "queries": [{"name": "event_overview", "args": {}}],
                "actions": [create("create_room", name="Big One")],
                "clarify": None,
                "refusal": None,
            }
        )
    )

    events = sse((await ask(client, world, "how many rooms do I have, and add Studio")).text)

    assert "proposal" in names(events)
    assert "queries" not in names(events)
    assert "token" not in names(events)


async def test_a_write_question_spends_one_proposal_row(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    scripted(plan(create("create_room", name="Big One"), create("create_room", name="Studio")))

    await ask(client, world, "add Big One and Studio")

    assert len(await _proposals(session, world)) == 1


async def test_a_reviewer_cannot_propose_a_change(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    """Unchanged from the read assistant, and worth a test of its own now that
    the assistant can reach a write path at all (story 29)."""
    scripted(plan(create("create_room", name="Big One")))

    response = await client.post(
        f"/v1/events/{world.event.id}/ai/ask",
        json={"question": "add a room called Big One", "history": []},
        headers=world.reviewer,
    )

    assert response.status_code == 403
