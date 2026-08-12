"""The one-way Accelevents push.

The three properties worth defending: a dry run and an execute produce the same
plan, a row that cannot go is blocked with a reason rather than dropped, and a
second push updates instead of duplicating.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import crypto
from app.core.tenancy import tenancy_disabled
from app.features.integrations import adapter
from app.models import (
    Event,
    EventSpeaker,
    Form,
    Room,
    Session,
    SessionStatus,
    Speaker,
    SpeakerStatus,
)

# The event-with-an-open-CFP fixture, reused rather than rebuilt.
from test_cfp_flow import cfp  # noqa: F401


def test_a_sealed_credential_comes_back_intact() -> None:
    assert crypto.unseal(crypto.seal("ae-live-key")) == "ae-live-key"


def test_an_unreadable_credential_is_none_rather_than_a_crash() -> None:
    assert crypto.unseal(b"not a fernet token") is None


def test_remote_ids_are_stable_across_calls() -> None:
    once = adapter.remote_id("speaker", "abc")
    assert once == adapter.remote_id("speaker", "abc")
    assert once != adapter.remote_id("session", "abc")


async def _programme(session: AsyncSession, event: Event) -> None:
    """One pushable speaker, one blocked speaker, one scheduled session and one
    unscheduled one — every branch of the plan in a single event."""
    with tenancy_disabled():
        room = Room(org_id=event.org_id, event_id=event.id, name="Main Stage", capacity=500)
        session.add(room)
        for name, email in [("Priya Raman", "priya@example.com"), ("No Email", "")]:
            speaker = Speaker(org_id=event.org_id, name=name, email=email)
            session.add(speaker)
            await session.flush()
            session.add(
                EventSpeaker(
                    org_id=event.org_id,
                    event_id=event.id,
                    speaker_id=speaker.id,
                    status=SpeakerStatus.ACCEPTED,
                )
            )
        await session.flush()
        session.add(
            Session(
                org_id=event.org_id,
                event_id=event.id,
                title="Taming 40-Minute CI",
                slug="taming-ci",
                duration_minutes=30,
                status=SessionStatus.SCHEDULED,
                room_id=room.id,
                starts_at=datetime.now(UTC) + timedelta(days=200),
            )
        )
        session.add(
            Session(
                org_id=event.org_id,
                event_id=event.id,
                title="Not placed yet",
                slug="not-placed",
                duration_minutes=30,
                status=SessionStatus.UNSCHEDULED,
            )
        )
        await session.commit()


async def _configure(client: AsyncClient, headers: dict[str, str], event: Event) -> None:
    response = await client.put(
        f"/v1/events/{event.id}/integrations/accelevents",
        headers=headers,
        json={"api_key": "ae-live-key", "remote_event_id": "remote-123"},
    )
    assert response.status_code == 200, response.text


async def test_the_api_never_returns_the_credential(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _ = cfp
    await _configure(client, headers, event)

    for response in [
        await client.get(f"/v1/events/{event.id}/integrations/accelevents", headers=headers),
        await client.post(f"/v1/events/{event.id}/integrations/accelevents/test", headers=headers),
    ]:
        assert response.status_code == 200, response.text
        assert "ae-live-key" not in response.text
        assert response.json()["has_credentials"] is True


async def test_testing_the_connection_names_the_remote_event(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _ = cfp
    await _configure(client, headers, event)

    result = (
        await client.post(f"/v1/events/{event.id}/integrations/accelevents/test", headers=headers)
    ).json()
    # An operator confirms the target by its name, not by a green tick.
    assert "remote_event_name" in result["last_test_result"]
    assert result["last_tested_at"] is not None


async def test_a_row_that_cannot_go_is_blocked_with_a_reason(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _ = cfp
    await _programme(session, event)
    await _configure(client, headers, event)

    plan = (
        await client.post(f"/v1/events/{event.id}/integrations/accelevents/push", headers=headers)
    ).json()
    blocked = [row for row in plan["rows"]["items"] if row["action"] == "blocked"]

    assert plan["summary"]["blocked"] == len(blocked) >= 2
    assert all(row["reason"] for row in blocked), "a blocked row must say why"
    assert {"No Email", "Not placed yet"} <= {row["label"] for row in blocked}


async def test_a_dry_run_and_an_execute_plan_the_same_work(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _ = cfp
    await _programme(session, event)
    await _configure(client, headers, event)
    url = f"/v1/events/{event.id}/integrations/accelevents/push"

    rehearsal = (await client.post(url, headers=headers)).json()
    real = (await client.post(f"{url}?dry_run=false", headers=headers)).json()

    assert rehearsal["kind"] == "dry_run"
    assert real["kind"] == "execute"
    assert rehearsal["summary"] == real["summary"]
    assert rehearsal["rows"] == real["rows"]


async def test_a_second_push_updates_instead_of_duplicating(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _ = cfp
    await _programme(session, event)
    await _configure(client, headers, event)
    url = f"/v1/events/{event.id}/integrations/accelevents/push?dry_run=false"

    first = (await client.post(url, headers=headers)).json()["summary"]
    second = (await client.post(url, headers=headers)).json()["summary"]

    assert first["create"] > 0 and first["update"] == 0
    assert second["create"] == 0
    assert second["update"] == first["create"]


async def test_executing_without_a_credential_is_refused(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _ = cfp
    await client.put(
        f"/v1/events/{event.id}/integrations/accelevents",
        headers=headers,
        json={"remote_event_id": "remote-123"},
    )

    refused = await client.post(
        f"/v1/events/{event.id}/integrations/accelevents/push?dry_run=false", headers=headers
    )
    assert refused.status_code == 409, refused.text


async def test_saving_the_remote_id_does_not_wipe_the_key(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _ = cfp
    await _configure(client, headers, event)

    again = await client.put(
        f"/v1/events/{event.id}/integrations/accelevents",
        headers=headers,
        json={"remote_event_id": "remote-456"},
    )
    assert again.json()["has_credentials"] is True
    assert again.json()["remote_event_id"] == "remote-456"


async def test_pushes_are_listed_newest_first(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _ = cfp
    await _programme(session, event)
    await _configure(client, headers, event)
    url = f"/v1/events/{event.id}/integrations/accelevents/push"
    await client.post(url, headers=headers)
    await client.post(f"{url}?dry_run=false", headers=headers)

    history = (
        await client.get(f"/v1/events/{event.id}/integrations/accelevents/pushes", headers=headers)
    ).json()
    assert len(history) == 2
    assert history[0]["kind"] == "execute"
