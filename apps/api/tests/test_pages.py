"""Portal resource pages: what gets stored, and who gets to read it.

The sanitiser tests are the point of the file. An organiser pastes HTML from
somewhere else and every speaker renders it, so each case here is a way in that
has to be shut on write.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.core.tenancy import tenancy_disabled
from app.features.pages import service
from app.models import Event, EventSpeaker, Form, Speaker, SpeakerStatus

# The event-with-an-open-CFP fixture, reused rather than rebuilt.
from test_cfp_flow import cfp  # noqa: F401


async def _speaker_headers(session: AsyncSession, event: Event) -> dict[str, str]:
    with tenancy_disabled():
        speaker = Speaker(org_id=event.org_id, name="Priya Raman", email=f"{uuid.uuid4().hex}@x.io")
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
        await session.commit()
    raw = create_access_token(
        speaker.id,
        kind="speaker",
        expires_in=timedelta(days=7),
        claims={"event_id": str(event.id)},
    )
    return {"Authorization": f"Bearer {raw}"}


@pytest.mark.parametrize(
    ("raw", "gone"),
    [
        ("<script>steal()</script><p>hi</p>", "steal"),
        ('<p onclick="steal()">hi</p>', "onclick"),
        ('<a href="javascript:steal()">go</a>', "javascript:"),
        ('<img src="data:text/html;base64,PHN2Zz4=">', "data:"),
        ('<iframe src="http://insecure.example/x"></iframe>', "http://insecure"),
    ],
)
def test_the_sanitiser_drops_every_way_in(raw: str, gone: str) -> None:
    assert gone not in service.sanitize_html(raw)


def test_the_sanitiser_keeps_a_real_embed() -> None:
    cleaned = service.sanitize_html(
        '<iframe src="https://www.youtube.com/embed/abc" title="Walkthrough"></iframe>'
    )
    assert "https://www.youtube.com/embed/abc" in cleaned
    assert "<iframe" in cleaned


def test_an_anchor_cannot_hand_over_its_opener() -> None:
    cleaned = service.sanitize_html('<a href="https://example.com" target="_blank">docs</a>')
    assert "noopener" in cleaned


def test_a_title_with_no_latin_characters_still_makes_a_slug() -> None:
    assert service.slugify("日本語") == "page"
    assert service.slugify("Day-of Logistics!") == "day-of-logistics"


async def test_html_is_sanitised_on_write_not_on_render(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _ = cfp
    created = await client.post(
        f"/v1/events/{event.id}/pages",
        headers=headers,
        json={
            "title": "Day-of logistics",
            "blocks": [
                {"type": "embed", "html": "<p onclick='x()'>Doors at 8<script>y()</script></p>"}
            ],
            "visibility": "speakers_only",
        },
    )
    assert created.status_code == 201, created.text

    stored = created.json()["blocks"][0]["html"]
    assert "onclick" not in stored
    assert "<script>" not in stored
    assert "Doors at 8" in stored


async def test_a_draft_page_never_reaches_the_portal(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _ = cfp
    for title, visibility in [("Published notes", "speakers_only"), ("Half-written", "draft")]:
        response = await client.post(
            f"/v1/events/{event.id}/pages",
            headers=headers,
            json={"title": title, "blocks": [], "visibility": visibility},
        )
        assert response.status_code == 201, response.text

    portal = await _speaker_headers(session, event)
    titles = [
        page["title"] for page in (await client.get("/v1/portal/pages", headers=portal)).json()
    ]
    assert "Published notes" in titles
    assert "Half-written" not in titles


async def test_pinned_pages_come_first(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _ = cfp
    for title, pinned, order in [("Style guide", False, 1), ("Read me first", True, 9)]:
        await client.post(
            f"/v1/events/{event.id}/pages",
            headers=headers,
            json={
                "title": title,
                "blocks": [],
                "visibility": "speakers_only",
                "is_pinned_in_portal": pinned,
                "sort_order": order,
            },
        )

    portal = await _speaker_headers(session, event)
    pages = (await client.get("/v1/portal/pages", headers=portal)).json()
    assert pages[0]["title"] == "Read me first"


async def test_a_second_page_cannot_take_a_taken_slug(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _ = cfp
    body = {"title": "Run of show", "blocks": []}
    first = await client.post(f"/v1/events/{event.id}/pages", headers=headers, json=body)
    assert first.status_code == 201
    again = await client.post(f"/v1/events/{event.id}/pages", headers=headers, json=body)
    assert again.status_code == 409


async def test_pages_reject_unknown_fields(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _ = cfp
    response = await client.post(
        f"/v1/events/{event.id}/pages",
        headers=headers,
        json={"title": "x", "blocks": [], "surprise": True},
    )
    assert response.status_code == 422
