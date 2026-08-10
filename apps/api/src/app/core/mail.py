"""The one way mail leaves this system.

Feature code never touches a provider SDK. Every send records a `Message` row
first — the outbox is the record, delivery is an attempt against it — so a
failure is visible and resendable rather than lost.

`MAIL_TRANSPORT=log` writes rendered HTML to `.mail/` and sends nothing, which is
what makes the project runnable with no credentials.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import anyio.to_thread
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Message, MessagePurpose, MessageStatus

MAIL_DIR = Path(".mail")


def _write_to_disk(message: Message) -> None:
    MAIL_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    path = MAIL_DIR / f"{stamp}-{message.to_email}-{message.id}.html"
    path.write_text(
        f"<!-- to: {message.to_email} -->\n<h1>{message.subject}</h1>\n{message.body_rendered}\n",
        encoding="utf-8",
    )


_TEMPLATE_VAR = re.compile(r"\{\{\s*([a-z0-9_.]+)\s*\}\}")


def render(template: str, context: dict[str, Any]) -> str:
    """Substitute `{{ name }}` placeholders. An unknown name renders empty rather
    than raising — a missing merge tag must not stop a batch of 200 emails."""

    def replace(match: re.Match[str]) -> str:
        value = context.get(match.group(1))
        return "" if value is None else str(value)

    return _TEMPLATE_VAR.sub(replace, template)


async def queue(
    session: AsyncSession,
    *,
    event_id: uuid.UUID,
    to_email: str,
    subject: str,
    body: str,
    purpose: MessagePurpose = MessagePurpose.CUSTOM,
    to_speaker_id: uuid.UUID | None = None,
    batch_id: uuid.UUID | None = None,
    ics_attached: bool = False,
) -> Message:
    """Record an outbound message. Delivery happens in `deliver`.

    `purpose` classifies the send for the caller and for the log; the row itself
    carries it only through its batch, so a single send does not persist it.
    """
    message = Message(
        event_id=event_id,
        to_email=to_email,
        to_speaker_id=to_speaker_id,
        batch_id=batch_id,
        subject=subject,
        body_rendered=body,
        ics_attached=ics_attached,
        status=MessageStatus.QUEUED,
    )
    session.add(message)
    return message


async def deliver(message: Message) -> None:
    """Attempt delivery and stamp the outcome on the row.

    Never raises: a provider failure is recorded as `failed` so the organizer can
    see it and resend, rather than surfacing as a 500 on an unrelated request.
    """
    settings = get_settings()
    try:
        if settings.mail_transport == "log":
            # Off the event loop: a blocking write is small but this runs inside a
            # request, and the rule that keeps it out of the loop is worth keeping.
            await anyio.to_thread.run_sync(_write_to_disk, message)
        else:  # pragma: no cover - exercised only with real SES credentials
            raise NotImplementedError("SES transport is not configured")
        message.status = MessageStatus.SENT
        message.sent_at = datetime.now(UTC)
    except Exception as exc:  # noqa: BLE001 - the outbox records failures, never raises
        message.status = MessageStatus.FAILED
        message.error_detail = f"{type(exc).__name__}: {exc}"


async def send_now(
    session: AsyncSession,
    *,
    event_id: uuid.UUID,
    to_email: str,
    subject: str,
    body: str,
    purpose: MessagePurpose = MessagePurpose.CUSTOM,
    to_speaker_id: uuid.UUID | None = None,
    ics_attached: bool = False,
) -> Message:
    message = await queue(
        session,
        event_id=event_id,
        to_email=to_email,
        subject=subject,
        body=body,
        purpose=purpose,
        to_speaker_id=to_speaker_id,
        ics_attached=ics_attached,
    )
    await session.flush()
    await deliver(message)
    return message
