"""The one way mail leaves this system.

Feature code never touches a provider SDK. Every send records a `Message` row
first — the outbox is the record, delivery is an attempt against it — so a
failure is visible and resendable rather than lost.

`MAIL_TRANSPORT=log` writes rendered HTML to `.mail/` and sends nothing, which is
what makes the project runnable with no credentials. `ses` hands the message to
Amazon SES, resolving credentials from the environment — on the deployed box that
is the instance role, so there is no access key anywhere.

Note that SES in the sandbox delivers ONLY to verified addresses and silently
drops nothing: a refusal comes back as an error and lands in the outbox as a
`failed` row with the reason, which is the only honest way to show it.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

import anyio.to_thread
import boto3
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Message, MessagePurpose, MessageStatus

MAIL_DIR = Path(".mail")


def _write_to_disk(to_email: str, subject: str, body: str, ref: str) -> None:
    MAIL_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    path = MAIL_DIR / f"{stamp}-{to_email}-{ref}.html"
    path.write_text(
        f"<!-- to: {to_email} -->\n<h1>{subject}</h1>\n{body}\n",
        encoding="utf-8",
    )


@lru_cache(maxsize=1)
def _ses_client() -> Any:
    """One client per process.

    boto3 clients are thread-safe and building one costs a credential resolution
    plus a TLS handshake, which is not something to pay per recipient when a
    decision send is 200 messages in a loop.

    Credentials are never configured explicitly: on the box this resolves to the
    instance role, which is scoped to `ses:SendEmail` on this one identity.
    """
    return boto3.client("sesv2", region_name=get_settings().aws_region)


def _send_via_ses(to_email: str, subject: str, body: str) -> str:
    """Hand one message to SES and return its provider id.

    Blocking, so callers run it in a worker thread. Raises on refusal — the
    caller turns that into a `failed` outbox row rather than letting it escape.
    """
    settings = get_settings()
    response = _ses_client().send_email(
        FromEmailAddress=settings.mail_from,
        Destination={"ToAddresses": [to_email]},
        Content={
            "Simple": {
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {"Html": {"Data": body, "Charset": "UTF-8"}},
            }
        },
    )
    return str(response["MessageId"])


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
            await anyio.to_thread.run_sync(
                _write_to_disk,
                message.to_email,
                message.subject,
                message.body_rendered,
                str(message.id),
            )
        else:  # pragma: no cover - exercised only against real SES
            # Recorded even on the failure path below, because SES accepting a
            # message and then bouncing it is a support conversation that starts
            # with "what was the message id".
            message.ses_message_id = await anyio.to_thread.run_sync(
                _send_via_ses, message.to_email, message.subject, message.body_rendered
            )
        message.status = MessageStatus.SENT
        message.sent_at = datetime.now(UTC)
    except Exception as exc:  # noqa: BLE001 - the outbox records failures, never raises
        message.status = MessageStatus.FAILED
        message.error_detail = f"{type(exc).__name__}: {exc}"


async def send_account_mail(*, to_email: str, subject: str, body: str) -> None:
    """Mail about an account rather than about a conference. No outbox row.

    The outbox is an event's correspondence with its speakers, and an organizer
    opens it to answer "what did we send them". A sign-in link for the organizer
    themselves is not that: it belongs to no event, so it has no `event_id` to be
    scoped by, and putting it in the list would show one person's login mail to
    every colleague with access to the event.

    Never raises. A signup whose confirmation mail failed is still a signup, and
    the link is re-requestable from the sign-in screen.
    """
    settings = get_settings()
    reference = uuid.uuid4().hex[:8]
    try:
        if settings.mail_transport == "log":
            await anyio.to_thread.run_sync(_write_to_disk, to_email, subject, body, reference)
        else:  # pragma: no cover - exercised only against real SES
            await anyio.to_thread.run_sync(_send_via_ses, to_email, subject, body)
    except Exception:  # noqa: BLE001 - see docstring; the caller has no recovery
        return


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
