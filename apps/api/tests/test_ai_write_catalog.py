"""What the assistant may propose, and how it finds the row you meant.

Spec 0008, seam 1. Sibling of `test_ai_catalog.py`, and deliberately the same
shape: the model's output is untrusted input, an action it names that does not
exist is an ordinary Tuesday, and arguments that do not fit are rejected at the
boundary rather than carried inward.

The resolution ladder is the part worth reading. An edit names its target with a
string the organiser typed, and this is where that becomes a row — or becomes a
question. It never becomes a guess.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import create_resource
from app.core.tenancy import tenant_scope
from app.features.ai import write_catalog
from app.features.program.resources import EVENT_DAY, ROOM, TRACK
from app.features.program.schemas import EventDayCreate, RoomCreate
from test_ai_assistant import World, world  # noqa: F401

# ─────────────────────────── the contract with the model ───────────────────────────


def test_every_action_is_a_create_or_an_update_and_nothing_else() -> None:
    """The catalog *is* the guarantee. A delete cannot be reached by a hostile
    prompt if no entry can perform one — which is a stronger property than any
    confirmation dialog (story 18)."""
    verbs = {action.verb for action in write_catalog.ACTIONS.values()}

    assert verbs == {"create", "update"}
    assert len(write_catalog.ACTIONS) == 8


def test_the_advertised_catalog_names_no_column_that_is_not_writable() -> None:
    """What the model is shown comes from the resource's own schema, so the
    prompt cannot advertise a field the writer would then refuse."""
    described = {entry["name"]: entry for entry in write_catalog.describe()}

    assert set(described) == set(write_catalog.ACTIONS)
    assert set(described["create_room"]["values"]) == set(
        ROOM.create_schema.model_fields  # only what RoomCreate accepts
    )
    assert "id" not in described["create_room"]["values"]
    assert "org_id" not in described["create_room"]["values"]
    assert "event_id" not in described["create_room"]["values"]


def test_an_update_advertises_a_target_and_a_create_does_not() -> None:
    described = {entry["name"]: entry for entry in write_catalog.describe()}

    assert described["update_room"]["target"]
    assert "target" not in described["create_room"]


def test_an_action_the_catalog_does_not_have_is_refused_by_name() -> None:
    with pytest.raises(write_catalog.UnknownActionError):
        write_catalog.parse("delete_room", {"target": "Big One"})


def test_arguments_that_do_not_fit_the_resource_are_refused() -> None:
    """`RoomCreate` bounds capacity at 1..100_000 and forbids extra fields. The
    write catalog restates none of that — it validates against the real schema
    (story 34)."""
    with pytest.raises(write_catalog.BadArgsError):
        write_catalog.parse("create_room", {"values": {"name": "Big One", "capacity": -4}})

    with pytest.raises(write_catalog.BadArgsError):
        write_catalog.parse("create_room", {"values": {"name": "Big One", "colour": "red"}})

    with pytest.raises(write_catalog.BadArgsError):
        write_catalog.parse("create_room", {"values": {}})


def test_a_parsed_create_keeps_only_the_fields_that_were_given() -> None:
    """Story 10, at the boundary: the card shows what will be set, and defaults
    the model did not ask for are not smuggled in as if it had."""
    parsed = write_catalog.parse("create_room", {"values": {"name": "Big One", "capacity": 60}})

    assert parsed.values.model_dump(exclude_unset=True) == {"name": "Big One", "capacity": 60}


def test_an_update_with_no_target_is_refused_rather_than_applied_to_something() -> None:
    with pytest.raises(write_catalog.BadArgsError):
        write_catalog.parse("update_room", {"values": {"capacity": 80}})


# ─────────────────────────── finding the row you meant ───────────────────────────


async def _rooms(session: AsyncSession, world: World, *names: str) -> None:
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        for name in names:
            await create_resource(session, ROOM, RoomCreate(name=name))
        await session.flush()


async def test_a_name_that_matches_one_row_resolves_to_it(
    session: AsyncSession, world: World
) -> None:
    await _rooms(session, world, "Big One", "Studio")

    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        found = await write_catalog.resolve(session, ROOM, "Big One")

    assert found.target is not None
    assert found.target.label == "Big One"
    assert found.is_exact


async def test_matching_ignores_case_and_surrounding_space(
    session: AsyncSession, world: World
) -> None:
    """Organisers type what they see, capitalised how they feel."""
    await _rooms(session, world, "Big One")

    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        found = await write_catalog.resolve(session, ROOM, "  big one ")

    assert found.target is not None
    assert found.target.label == "Big One"


async def test_a_name_that_matches_nothing_returns_the_candidates_it_does_have(
    session: AsyncSession, world: World
) -> None:
    """Story 16: the refusal names what exists, so the typo is visible."""
    await _rooms(session, world, "Big One", "Studio")

    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        found = await write_catalog.resolve(session, ROOM, "Big Hall")

    assert found.target is None
    assert not found.is_exact
    assert sorted(candidate.label for candidate in found.candidates) == ["Big One", "Studio"]


async def test_an_inexact_name_does_not_resolve_itself(session: AsyncSession, world: World) -> None:
    """ "the big room" is for the resolution call to adjudicate, not for a
    substring match to decide. Substring matching is how "Studio" quietly wins
    over "Studio B"."""
    await _rooms(session, world, "Studio", "Studio B")

    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        found = await write_catalog.resolve(session, ROOM, "the studio room")

    assert found.target is None
    assert len(found.candidates) == 2


async def test_the_candidate_list_carries_names_and_never_ids(
    session: AsyncSession, world: World
) -> None:
    """Story 32. This is the list that goes into a prompt, so what it contains is
    what a leaked prompt log contains."""
    await _rooms(session, world, "Big One", "Studio")

    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        found = await write_catalog.resolve(session, ROOM, "Big Hall")

    offered = write_catalog.offer(found.candidates)

    assert offered == ["Big One", "Studio"]
    assert all(isinstance(name, str) for name in offered)


async def test_an_empty_resource_has_nothing_to_pick_from(
    session: AsyncSession, world: World
) -> None:
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        found = await write_catalog.resolve(session, TRACK, "Platform")

    assert found.target is None
    assert found.candidates == []


async def test_a_track_named_the_same_as_a_room_is_not_a_match(
    session: AsyncSession, world: World
) -> None:
    """Resolution is per resource. A room called Platform must not satisfy an
    edit aimed at a track."""
    await _rooms(session, world, "Platform")

    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        found = await write_catalog.resolve(session, TRACK, "Platform")

    assert found.target is None


async def test_a_day_is_resolved_by_its_date_not_its_label(
    session: AsyncSession, world: World
) -> None:
    """`label_column` is `day_date` for days: nobody refers to a conference day
    by its optional label.

    The first version of this created a *Track*, never called `resolve`, and
    asserted a constant copied out of `resources.py` — it would have passed with
    the whole resolver deleted. Caught in review; rewritten to resolve a real day.
    """
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        await create_resource(
            session, EVENT_DAY, EventDayCreate(day_date=date(2027, 5, 12), label="Opening day")
        )
        await session.flush()

        by_date = await write_catalog.resolve(session, EVENT_DAY, "2027-05-12")
        by_label = await write_catalog.resolve(session, EVENT_DAY, "Opening day")

    assert by_date.target is not None
    assert by_date.target.label == "2027-05-12"
    assert by_label.target is None, "a day answers to its date, not its label"
