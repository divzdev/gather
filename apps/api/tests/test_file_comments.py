"""Comments on a deliverable — the conversation both sides can read.

The two that matter: an organiser and a speaker see each other's messages, and
the thread survives the re-upload it asked for.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.models import Event, Speaker

# Reused rather than rebuilt: two accepted speakers, one upload task each.
from test_cfp_flow import cfp  # noqa: F401
from test_tasks_portal import _isolated_storage, _own_task_id, _token, onboarding  # noqa: F401

Onboarding = tuple[dict[str, str], Event, Speaker, Speaker, str]


async def _upload(client: AsyncClient, speaker: Speaker, event: Event, body: bytes) -> str:
    task_id = await _own_task_id(client, speaker, event)
    uploaded = await client.post(
        f"/v1/portal/tasks/{task_id}/files",
        headers=_token(speaker.id, event.id),
        files={"file": ("deck.pdf", body, "application/pdf")},
    )
    assert uploaded.status_code == 201, uploaded.text
    return str(uploaded.json()["files"][0]["id"])


async def test_organiser_and_speaker_read_the_same_thread(
    client: AsyncClient, onboarding: Onboarding
) -> None:
    headers, event, rosa, _tomas, _template = onboarding
    file_id = await _upload(client, rosa, event, b"%PDF-1.4 v1")

    asked = await client.post(
        f"/v1/events/{event.id}/files/{file_id}/comments",
        headers=headers,
        json={"body": "Slide 4 is unreadable on a projector — can you bump the font?"},
    )
    assert asked.status_code == 201, asked.text

    # The speaker sees it, and answers.
    theirs = await client.get(
        f"/v1/portal/files/{file_id}/comments", headers=_token(rosa.id, event.id)
    )
    assert [c["body"] for c in theirs.json()] == [asked.json()["body"]]
    assert theirs.json()[0]["author_kind"] == "staff"
    assert theirs.json()[0]["author_name"]

    replied = await client.post(
        f"/v1/portal/files/{file_id}/comments",
        headers=_token(rosa.id, event.id),
        json={"body": "Fixed, re-uploading now."},
    )
    assert replied.status_code == 201, replied.text
    assert replied.json()["author_kind"] == "speaker"
    assert replied.json()["author_name"] == "Rosa Lindqvist"

    both = await client.get(f"/v1/events/{event.id}/files/{file_id}/comments", headers=headers)
    assert [c["author_kind"] for c in both.json()] == ["staff", "speaker"]
    assert all(c["created_at"] for c in both.json())


async def test_the_thread_survives_the_re_upload_it_asked_for(
    client: AsyncClient, onboarding: Onboarding
) -> None:
    """A comment is nearly always a request to change the file. Keying the
    thread to the file row would delete it the moment the speaker complied."""
    headers, event, rosa, _tomas, _template = onboarding
    first = await _upload(client, rosa, event, b"%PDF-1.4 v1")
    await client.post(
        f"/v1/events/{event.id}/files/{first}/comments",
        headers=headers,
        json={"body": "Bump the font."},
    )

    second = await _upload(client, rosa, event, b"%PDF-1.4 v2")
    assert second != first

    carried = await client.get(f"/v1/events/{event.id}/files/{second}/comments", headers=headers)
    assert [c["body"] for c in carried.json()] == ["Bump the font."]
    # ...but which version was on screen when it was written is still recorded.
    assert carried.json()[0]["file_version"] == 1


async def test_a_speaker_cannot_touch_another_speakers_thread(
    client: AsyncClient, onboarding: Onboarding
) -> None:
    _headers, event, rosa, tomas, _template = onboarding
    file_id = await _upload(client, tomas, event, b"%PDF-1.4 tomas")
    intruder = _token(rosa.id, event.id)

    read = await client.get(f"/v1/portal/files/{file_id}/comments", headers=intruder)
    write = await client.post(
        f"/v1/portal/files/{file_id}/comments", headers=intruder, json={"body": "hello"}
    )

    # 404 rather than 403: Rosa has no business learning the file exists.
    assert read.status_code == 404
    assert write.status_code == 404


@pytest.mark.parametrize("body", ["", "   ", "\n\t "])
async def test_an_empty_comment_is_rejected(
    client: AsyncClient, onboarding: Onboarding, body: str
) -> None:
    headers, event, rosa, _tomas, _template = onboarding
    file_id = await _upload(client, rosa, event, b"%PDF-1.4 v1")

    blank = await client.post(
        f"/v1/events/{event.id}/files/{file_id}/comments", headers=headers, json={"body": body}
    )

    assert blank.status_code == 422, blank.text


async def test_the_portal_lists_every_thread_in_one_payload(
    client: AsyncClient, onboarding: Onboarding
) -> None:
    """The speaker is on a phone; feedback hidden inside a task is unread."""
    headers, event, rosa, _tomas, _template = onboarding
    file_id = await _upload(client, rosa, event, b"%PDF-1.4 v1")
    await client.post(
        f"/v1/events/{event.id}/files/{file_id}/comments",
        headers=headers,
        json={"body": "Bump the font."},
    )

    mine = await client.get("/v1/portal/file-comments", headers=_token(rosa.id, event.id))

    threads = mine.json()
    assert len(threads) == 1
    assert threads[0]["filename"] == "deck.pdf"
    assert threads[0]["task_name"] == "Slide deck"
    assert [c["body"] for c in threads[0]["comments"]] == ["Bump the font."]


async def test_the_organiser_sees_every_deliverable_not_just_one_speakers(
    client: AsyncClient, onboarding: Onboarding
) -> None:
    headers, event, rosa, tomas, _template = onboarding
    await _upload(client, rosa, event, b"%PDF-1.4 rosa")
    await _upload(client, tomas, event, b"%PDF-1.4 tomas")

    everything = await client.get(f"/v1/events/{event.id}/file-comments", headers=headers)

    names = sorted(t["speaker_name"] for t in everything.json())
    assert names == ["Rosa Lindqvist", "Tomas Eriksen"]

    # ...while the speaker's own view stays scoped to them.
    mine = await client.get("/v1/portal/file-comments", headers=_token(rosa.id, event.id))
    assert [t["speaker_name"] for t in mine.json()] == ["Rosa Lindqvist"]
