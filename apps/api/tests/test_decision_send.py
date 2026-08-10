"""Deciding and sending are separate acts, and the send is guarded."""

from __future__ import annotations

from httpx import AsyncClient

from app.models import Event, Form
from test_cfp_flow import cfp  # noqa: F401


async def _submit(client: AsyncClient, event: Event, form: Form, title: str, email: str) -> str:
    response = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": title,
            "answers": {"abstract": "A" * 40, "format": "talk"},
            "speaker_email": email,
            "speaker_name": "Ada Okoye",
        },
    )
    assert response.status_code == 201
    return str(response.json()["id"])


async def test_deciding_queues_and_sends_nothing(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, form = cfp
    submission_id = await _submit(client, event, form, "Taming CI", "ada@example.com")

    await client.post(
        f"/v1/events/{event.id}/submissions/{submission_id}/decision",
        json={"outcome": "accepted"},
        headers=headers,
    )

    preview = await client.get(
        f"/v1/events/{event.id}/messages/decision-recipients", headers=headers
    )

    assert preview.status_code == 200
    body = preview.json()
    assert body["total"] == 1
    assert body["by_outcome"] == {"accepted": 1}
    assert body["recipients"][0]["email"] == "ada@example.com"


async def test_a_stale_count_is_refused(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The accident this exists to prevent: the screen was opened when one
    decision was pending, someone else decided another, and the operator's
    'send to 1' would have emailed 2."""
    headers, event, form = cfp
    first = await _submit(client, event, form, "Taming CI", "ada@example.com")
    second = await _submit(client, event, form, "Agents That Ship", "marcus@example.com")
    for submission_id in (first, second):
        await client.post(
            f"/v1/events/{event.id}/submissions/{submission_id}/decision",
            json={"outcome": "accepted"},
            headers=headers,
        )

    response = await client.post(
        f"/v1/events/{event.id}/messages/send-decisions",
        json={"confirm_recipient_count": 1},
        headers=headers,
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "RECIPIENT_COUNT_MISMATCH"

    preview = await client.get(
        f"/v1/events/{event.id}/messages/decision-recipients", headers=headers
    )
    assert preview.json()["total"] == 2


async def test_sending_marks_them_sent_so_they_cannot_go_twice(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, form = cfp
    submission_id = await _submit(client, event, form, "Taming CI", "ada@example.com")
    await client.post(
        f"/v1/events/{event.id}/submissions/{submission_id}/decision",
        json={"outcome": "accepted"},
        headers=headers,
    )

    sent = await client.post(
        f"/v1/events/{event.id}/messages/send-decisions",
        json={"confirm_recipient_count": 1},
        headers=headers,
    )

    assert sent.status_code == 200
    assert sent.json()["sent"] == 1

    again = await client.get(f"/v1/events/{event.id}/messages/decision-recipients", headers=headers)
    assert again.json()["total"] == 0
