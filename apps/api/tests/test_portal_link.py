"""Durable portal links: reusable on purpose, revoked by rotation.

The magic-link flow is single-use and asserted elsewhere. These tests pin the
properties that make the durable link different — it works twice, it dies when
a newer one is minted, and it never says why it stopped working.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models import Event, Form

# The event-with-an-open-CFP fixture, reused rather than rebuilt.
from test_cfp_flow import cfp  # noqa: F401
from test_tasks_portal import _add_speaker

SPEAKER_TTL = timedelta(days=7)


def _session_headers(speaker_id: uuid.UUID, event_id: uuid.UUID) -> dict[str, str]:
    raw = create_access_token(
        speaker_id,
        kind="speaker",
        expires_in=SPEAKER_TTL,
        claims={"event_id": str(event_id)},
    )
    return {"Authorization": f"Bearer {raw}"}


async def _mint(client: AsyncClient, speaker_id: uuid.UUID, event_id: uuid.UUID) -> str:
    response = await client.post("/v1/portal/link", headers=_session_headers(speaker_id, event_id))
    assert response.status_code == 200, response.text
    token: str = response.json()["token"]
    assert token
    return token


async def test_link_signs_its_speaker_in_and_is_reusable(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _headers, event, _form = cfp
    rosa = await _add_speaker(session, event, "Rosa Lindqvist", "rosa@northbound.example")
    token = await _mint(client, rosa.id, event.id)

    for visit in (1, 2):
        consumed = await client.post("/v1/auth/portal-link/consume", json={"token": token})
        assert consumed.status_code == 200, f"visit {visit}: {consumed.text}"
        body = consumed.json()
        assert body["kind"] == "speaker"

        home = await client.get(
            "/v1/portal/home", headers={"Authorization": f"Bearer {body['access_token']}"}
        )
        assert home.status_code == 200, f"visit {visit}: {home.text}"
        assert home.json()["speaker"]["email"] == "rosa@northbound.example"


async def test_rotation_revokes_the_previous_link(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _headers, event, _form = cfp
    tomas = await _add_speaker(session, event, "Tomas Eriksen", "tomas@harbourlabs.example")
    first = await _mint(client, tomas.id, event.id)
    second = await _mint(client, tomas.id, event.id)

    stale = await client.post("/v1/auth/portal-link/consume", json={"token": first})
    assert stale.status_code == 400, "a rotated link kept working"
    fresh = await client.post("/v1/auth/portal-link/consume", json={"token": second})
    assert fresh.status_code == 200, fresh.text


async def test_a_guessed_token_is_indistinguishable_from_a_rotated_one(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _headers, event, _form = cfp
    speaker = await _add_speaker(session, event, "Priya Osei", "priya@calder.example")
    first = await _mint(client, speaker.id, event.id)
    await _mint(client, speaker.id, event.id)

    rotated = await client.post("/v1/auth/portal-link/consume", json={"token": first})
    guessed = await client.post("/v1/auth/portal-link/consume", json={"token": "a" * 43})
    assert rotated.status_code == guessed.status_code == 400
    assert rotated.json()["error"]["code"] == guessed.json()["error"]["code"]


async def test_the_link_only_ever_buys_a_portal_session(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """A durable link must never escalate: the session it mints is speaker-kind
    and the console refuses it, exactly like any other speaker token."""
    _headers, event, _form = cfp
    speaker = await _add_speaker(session, event, "Ines Aalto", "ines@ferrous.example")
    token = await _mint(client, speaker.id, event.id)

    consumed = await client.post("/v1/auth/portal-link/consume", json={"token": token})
    bearer = {"Authorization": f"Bearer {consumed.json()['access_token']}"}
    console = await client.get("/v1/events", headers=bearer)
    assert console.status_code == 401, "a portal link produced a console-capable session"
