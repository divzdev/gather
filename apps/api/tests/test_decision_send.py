"""Deciding and sending are separate acts, and the send is guarded."""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import tenancy
from app.models import Event, Form, Message, MessageStatus
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


async def test_only_a_failed_message_can_be_resent(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """A delivered message is not resendable; a failed one is, as a new row.

    Local mail writes to disk and never fails, so the failure is set here rather
    than waited for — this is the one state the E2E suite cannot reach.
    """
    headers, event, form = cfp
    submission_id = await _submit(client, event, form, "Retrying", "grace@example.com")
    await client.post(
        f"/v1/events/{event.id}/submissions/{submission_id}/decision",
        json={"outcome": "rejected"},
        headers=headers,
    )
    await client.post(
        f"/v1/events/{event.id}/messages/send-decisions",
        json={"confirm_recipient_count": 1},
        headers=headers,
    )

    outbox = await client.get(f"/v1/events/{event.id}/messages/outbox", headers=headers)
    # Two rows: the submission confirmation and the decision. The decision is the
    # newest, and the outbox is ordered newest first.
    rows = outbox.json()["data"]
    before = len(rows)
    message_id = rows[0]["id"]

    refused = await client.post(
        f"/v1/events/{event.id}/messages/outbox/{message_id}/resend", headers=headers
    )
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "MESSAGE_NOT_RESENDABLE"

    with tenancy.tenant_scope(org_id=event.org_id, event_id=event.id):
        message = await session.get(Message, uuid.UUID(message_id))
        assert message is not None
        message.status = MessageStatus.BOUNCED
        message.error_detail = "550 mailbox unavailable"
        # Committed, not flushed: the API call below runs in its own session and
        # would not see an uncommitted change.
        await session.commit()

    retried = await client.post(
        f"/v1/events/{event.id}/messages/outbox/{message_id}/resend", headers=headers
    )
    assert retried.status_code == 200
    assert retried.json()["id"] != message_id

    after = await client.get(f"/v1/events/{event.id}/messages/outbox", headers=headers)
    rows = after.json()["data"]
    assert len(rows) == before + 1
    # The bounce is still on the record: an organiser explaining a missed
    # acceptance needs the history, not a row that has quietly turned green.
    original = next(row for row in rows if row["id"] == message_id)
    assert original["status"] == "bounced"
    assert original["error_detail"] == "550 mailbox unavailable"
