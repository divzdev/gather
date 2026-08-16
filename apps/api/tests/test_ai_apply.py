"""Pressing Create — spec 0008, seam 3.

The moment a proposal stops being a row and becomes a room. Everything here is
about that transition being **as ordinary as typing it on the setup screen**: the
same writer, the same validation, the same duplicate sentence, under the pressing
human's identity and tenancy.

The proposal is treated as untrusted input on the way back in, which is not
paranoia about the model — the row has been sitting in a database since it was
written, and nothing about "we generated it" makes it safe to replay unchecked.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import create_resource
from app.core.tenancy import tenancy_disabled, tenant_scope
from app.features.program.resources import ROOM
from app.features.program.schemas import RoomCreate
from app.models import AiProposal, AiProposalStatus, Room
from test_ai_assistant import (  # noqa: F401
    World,
    ask,
    no_model_configured,
    scripted,
    sessions_hit_the_test_database,
    sse,
    world,
)
from test_ai_assistant_writes import create, edit, plan, resolved


async def _propose(client: AsyncClient, world: World, question: str) -> str:
    """Ask, and hand back the proposal id the drawer would have."""
    body = sse((await ask(client, world, question)).text)
    for name, data in body:
        if name == "proposal":
            return str(data["proposal_id"])
    raise AssertionError(f"no proposal in {[name for name, _ in body]}")


async def _apply(
    client: AsyncClient,
    world: World,
    proposal_id: str,
    indexes: list[int],
    headers: dict[str, str] | None = None,
) -> Any:
    return await client.post(
        f"/v1/events/{world.event.id}/ai/proposals/{proposal_id}/apply",
        json={"indexes": indexes},
        headers=headers or world.admin,
    )


async def _rooms(session: AsyncSession, world: World) -> list[Room]:
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        return list((await session.scalars(select(Room).order_by(Room.name))).all())


# ─────────────────────────── it writes the row ───────────────────────────


async def test_applying_creates_the_row_the_card_described(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    scripted(plan(create("create_room", name="Big One", capacity=60)))
    proposal_id = await _propose(client, world, "add a room called Big One, capacity 60")

    response = await _apply(client, world, proposal_id, [0])

    assert response.status_code == 200
    assert [result["status"] for result in response.json()["results"]] == ["applied"]
    rooms = await _rooms(session, world)
    assert [(room.name, room.capacity) for room in rooms] == [("Big One", 60)]


async def test_an_applied_create_reports_the_row_it_made(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    """Story 24: "Created · Big One" is distinguishable from a failure at a glance."""
    scripted(plan(create("create_room", name="Big One")))
    proposal_id = await _propose(client, world, "add Big One")

    result = (await _apply(client, world, proposal_id, [0])).json()["results"][0]

    assert result["label"] == "Big One"
    assert uuid.UUID(result["id"])


async def test_applying_an_update_changes_only_that_field(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        await create_resource(
            session, ROOM, RoomCreate(name="Big One", capacity=60, av_notes="projector")
        )
        await session.commit()
    scripted(plan(edit("update_room", "Big One", capacity=80)))
    proposal_id = await _propose(client, world, "set Big One's capacity to 80")

    await _apply(client, world, proposal_id, [0])

    room = (await _rooms(session, world))[0]
    assert (room.capacity, room.av_notes) == (80, "projector")


async def test_a_created_track_is_a_normal_track(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Story 7 end to end: the hook that assigns a hue is the writer's, so it
    runs here too."""
    from app.models import Track

    scripted(plan(create("create_track", name="Platform")))
    proposal_id = await _propose(client, world, "add a track called Platform")

    await _apply(client, world, proposal_id, [0])

    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        track = (await session.scalars(select(Track))).one()
    assert 1 <= track.hue_index <= 8


# ─────────────────────────── partial, and idempotent ───────────────────────────


async def test_one_failing_action_does_not_take_the_others_with_it(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Story 6. The duplicate is the realistic failure — an organiser adding a
    room they already have, in a batch of three."""
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        await create_resource(session, ROOM, RoomCreate(name="Studio"))
        await session.commit()
    scripted(
        plan(
            create("create_room", name="Big One"),
            create("create_room", name="Studio"),
            create("create_room", name="Small One"),
        )
    )
    proposal_id = await _propose(client, world, "add Big One, Studio and Small One")

    results = (await _apply(client, world, proposal_id, [0, 1, 2])).json()["results"]

    assert [r["status"] for r in results] == ["applied", "failed", "applied"]
    assert "already has a room with that name" in results[1]["error"]
    assert sorted(room.name for room in await _rooms(session, world)) == [
        "Big One",
        "Small One",
        "Studio",
    ]


async def test_applying_the_same_action_twice_makes_one_row(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Story 25: a double-click, or a retried request on a flaky connection."""
    scripted(plan(create("create_room", name="Big One")))
    proposal_id = await _propose(client, world, "add Big One")

    first = (await _apply(client, world, proposal_id, [0])).json()["results"][0]
    second = (await _apply(client, world, proposal_id, [0])).json()["results"][0]

    assert first["id"] == second["id"]
    assert second["status"] == "applied"
    assert len(await _rooms(session, world)) == 1


async def test_applying_one_of_three_leaves_the_others_proposed(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Story 5, and the reason per-action state lives inside one row."""
    scripted(
        plan(
            create("create_room", name="Big One"),
            create("create_room", name="Studio"),
            create("create_room", name="Small One"),
        )
    )
    proposal_id = await _propose(client, world, "add three rooms")

    await _apply(client, world, proposal_id, [1])

    assert [room.name for room in await _rooms(session, world)] == ["Studio"]
    with tenancy_disabled():
        row = (
            await session.scalars(select(AiProposal).where(AiProposal.id == uuid.UUID(proposal_id)))
        ).one()
        await session.refresh(row)
    statuses = [action["status"] for action in row.output["actions"]]
    assert statuses == ["proposed", "applied", "proposed"]
    assert row.status is AiProposalStatus.PARTIALLY_ACCEPTED


async def test_applying_everything_resolves_the_proposal(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    scripted(plan(create("create_room", name="Big One")))
    proposal_id = await _propose(client, world, "add Big One")

    await _apply(client, world, proposal_id, [0])

    with tenancy_disabled():
        row = (
            await session.scalars(select(AiProposal).where(AiProposal.id == uuid.UUID(proposal_id)))
        ).one()
        await session.refresh(row)
    assert row.status is AiProposalStatus.ACCEPTED
    assert row.resolved_at is not None


# ─────────────────────── the proposal is untrusted on the way in ───────────────────────


async def test_an_index_that_is_not_in_the_proposal_is_refused(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    scripted(plan(create("create_room", name="Big One")))
    proposal_id = await _propose(client, world, "add Big One")

    response = await _apply(client, world, proposal_id, [7])

    assert response.status_code == 422


async def test_a_stored_action_is_revalidated_rather_than_replayed(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """The row has been sitting in a database. Nothing about having generated it
    makes it safe to hand to the writer unchecked (story 34)."""
    scripted(plan(create("create_room", name="Big One")))
    proposal_id = await _propose(client, world, "add Big One")

    with tenancy_disabled():
        row = (
            await session.scalars(select(AiProposal).where(AiProposal.id == uuid.UUID(proposal_id)))
        ).one()
        tampered = json.loads(json.dumps(row.output))
        tampered["actions"][0]["values"] = {"name": "Big One", "capacity": -5}
        row.output = tampered
        await session.commit()

    results = (await _apply(client, world, proposal_id, [0])).json()["results"]

    assert results[0]["status"] == "failed"
    assert await _rooms(session, world) == []


async def test_an_action_naming_a_row_that_has_since_been_renamed_fails_readably(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Resolution happens again at apply time, so a proposal for a row that has
    moved fails rather than landing on whatever now has that name."""
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        room = await create_resource(session, ROOM, RoomCreate(name="Big One", capacity=60))
        await session.commit()
    scripted(plan(edit("update_room", "Big One", capacity=80)))
    proposal_id = await _propose(client, world, "set Big One's capacity to 80")

    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        room.name = "Main Hall"
        await session.commit()

    results = (await _apply(client, world, proposal_id, [0])).json()["results"]

    assert results[0]["status"] == "failed"
    assert "Big One" in results[0]["error"]


# ─────────────────────────── who may press it ───────────────────────────


async def test_a_reviewer_cannot_apply_a_proposal(
    client: AsyncClient, world: World, scripted: Any
) -> None:
    scripted(plan(create("create_room", name="Big One")))
    proposal_id = await _propose(client, world, "add Big One")

    response = await _apply(client, world, proposal_id, [0], headers=world.reviewer)

    assert response.status_code == 403


async def test_a_proposal_from_another_event_is_not_appliable(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Story 31, proven rather than assumed from the route's shape."""
    from datetime import datetime

    from app.models import Event, EventStatus, Organization

    scripted(plan(create("create_room", name="Big One")))
    proposal_id = await _propose(client, world, "add Big One")

    with tenancy_disabled():
        stranger_org = Organization(name="Other", slug=f"other-{uuid.uuid4().hex[:8]}")
        session.add(stranger_org)
        await session.flush()
        stranger_event = Event(
            org_id=stranger_org.id,
            name="Other Conf",
            slug=f"other-{uuid.uuid4().hex[:8]}",
            timezone="UTC",
            starts_on=datetime(2027, 9, 1).date(),
            ends_on=datetime(2027, 9, 2).date(),
            status=EventStatus.IN_REVIEW,
        )
        session.add(stranger_event)
        await session.commit()

    response = await client.post(
        f"/v1/events/{stranger_event.id}/ai/proposals/{proposal_id}/apply",
        json={"indexes": [0]},
        headers=world.admin,
    )

    assert response.status_code in (403, 404)


async def test_discarding_leaves_nothing_behind(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Story 27, through the endpoint that already existed for score proposals."""
    scripted(plan(create("create_room", name="Big One")))
    proposal_id = await _propose(client, world, "add Big One")

    response = await client.post(
        f"/v1/events/{world.event.id}/ai/proposals/{proposal_id}/discard",
        headers=world.admin,
    )

    assert response.status_code == 200
    assert await _rooms(session, world) == []


@pytest.mark.parametrize("indexes", [[], [0, 0]])
async def test_a_nonsense_index_list_is_refused(
    client: AsyncClient, world: World, scripted: Any, indexes: list[int]
) -> None:
    """Empty applies nothing and is a client bug; a repeated index would apply
    twice on a route whose whole promise is that it does not."""
    scripted(plan(create("create_room", name="Big One")))
    proposal_id = await _propose(client, world, "add Big One")

    assert (await _apply(client, world, proposal_id, indexes)).status_code == 422


async def test_the_resolution_call_is_not_repeated_at_apply_time(
    client: AsyncClient, session: AsyncSession, world: World, scripted: Any
) -> None:
    """Applying reaches no model at all. The card was approved on what it said,
    and a second opinion at press time could differ from it."""
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        await create_resource(session, ROOM, RoomCreate(name="Big One"))
        await create_resource(session, ROOM, RoomCreate(name="Studio"))
        await session.commit()
    fake = scripted(plan(edit("update_room", "the big room", capacity=80)), resolved("Big One"))
    proposal_id = await _propose(client, world, "make the big room hold 80")
    assert len(fake.seen) == 2

    await _apply(client, world, proposal_id, [0])

    assert len(fake.seen) == 2, "applying spoke to no model"
