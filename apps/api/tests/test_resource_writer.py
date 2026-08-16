"""The shared writer behind program setup — spec 0008, seam 1 (the write half).

Rooms, tracks, formats and days are created two ways now: an organiser typing on
a setup screen, and an organiser accepting a proposal in the assistant drawer.
**Both call the functions under test here**, which is the entire safety argument
of spec 0008 — an AI apply-path that built the row itself would be a second
implementation of create, passing its own tests on the day it was written and
drifting the first time somebody added a hook to the real one.

So what is asserted below is not "create works". It is that the *rules* live in
the writer rather than in the route: the `on_create` hook runs, a duplicate
becomes the resource's own sentence, and unset fields keep their defaults.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import create_resource, previous_values, update_resource
from app.core.errors import ApiError, ConflictError
from app.core.tenancy import tenant_scope
from app.features.program.resources import EVENT_DAY, ROOM, TRACK
from app.features.program.schemas import (
    EventDayCreate,
    RoomCreate,
    RoomUpdate,
    Strict,
    TrackCreate,
)
from app.models import Room
from test_ai_assistant import World, world  # noqa: F401


class _SortsHigh(Strict):
    """A create schema whose default deliberately differs from the column's.

    Every real resource happens to give its schema and its column the same
    default, so no test over `RoomCreate` can tell `exclude_unset` from its
    absence — the first version of the test below asserted three fields and
    passed with the flag deleted. Review caught it. This schema exists so the
    writer's contract is tested rather than a coincidence.
    """

    name: str
    sort_order: int = 99


async def test_a_created_row_takes_the_columns_default_not_the_schemas(
    session: AsyncSession, world: World
) -> None:
    """A field nobody supplied is left to the database.

    Story 10. The failure this guards is specific to the AI path — a model
    filling in every field of a schema it was shown — but the rule belongs to
    the writer, because the writer is what both callers reach.
    """
    spec = replace(ROOM, create_schema=_SortsHigh)

    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        room = await create_resource(session, spec, _SortsHigh(name="Big One"))
        await session.flush()

    assert isinstance(room, Room)
    assert room.name == "Big One"
    # 0 is the column's default; 99 is the schema's, and would mean the writer
    # sent a value the caller never asked for.
    assert room.sort_order == 0


async def test_a_field_that_was_supplied_is_kept_even_when_it_equals_the_default(
    session: AsyncSession, world: World
) -> None:
    """The other half: `exclude_unset` must not drop a value somebody chose."""
    spec = replace(ROOM, create_schema=_SortsHigh)

    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        room = await create_resource(session, spec, _SortsHigh(name="Studio", sort_order=99))
        await session.flush()

    assert room.sort_order == 99


async def test_a_duplicate_name_raises_the_resources_own_sentence(
    session: AsyncSession, world: World
) -> None:
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        await create_resource(session, ROOM, RoomCreate(name="Big One"))

        with pytest.raises(ConflictError) as clash:
            await create_resource(session, ROOM, RoomCreate(name="Big One"))

    assert clash.value.message == ROOM.duplicate
    assert "room" in clash.value.message.lower()


async def test_the_on_create_hook_runs_in_the_writer(session: AsyncSession, world: World) -> None:
    """A day outside the event is refused wherever it is created from.

    This is the test that would fail if the AI path built rows itself: the
    date-window rule is an `on_create` hook, invisible to anyone reading only
    the model.
    """
    with (
        tenant_scope(org_id=world.org_id, event_id=world.event.id),
        pytest.raises(ApiError) as refusal,
    ):
        await create_resource(session, EVENT_DAY, EventDayCreate(day_date=date(2099, 1, 1)))

    assert refusal.value.field == "day_date"
    assert "outside the event" in refusal.value.message


async def test_a_created_track_gets_its_hue_from_the_hook(
    session: AsyncSession, world: World
) -> None:
    """Story 7: a track added through the writer is a normal track."""
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        track = await create_resource(session, TRACK, TrackCreate(name="Platform"))

    assert 1 <= track.hue_index <= 8


async def test_an_update_changes_only_what_it_was_given(
    session: AsyncSession, world: World
) -> None:
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        room = await create_resource(
            session, ROOM, RoomCreate(name="Big One", capacity=60, av_notes="projector")
        )

        changed = await update_resource(session, ROOM, room, RoomUpdate(capacity=80))

    assert changed.capacity == 80
    assert changed.name == "Big One"
    assert changed.av_notes == "projector"


async def test_an_update_reports_what_the_fields_held_before(
    session: AsyncSession, world: World
) -> None:
    """The card shows `capacity 60 → 80`, and story 13 says the left-hand side is
    read from the database rather than assumed. The writer is where it is read,
    so it is returned rather than re-fetched by the caller."""
    with tenant_scope(org_id=world.org_id, event_id=world.event.id):
        room = await create_resource(session, ROOM, RoomCreate(name="Big One", capacity=60))

        before = previous_values(room, RoomUpdate(capacity=80))

    assert before == {"capacity": 60}
