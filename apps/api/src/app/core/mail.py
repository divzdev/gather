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

Reserved domains never reach SES at all — see `undeliverable_reason`. The check
lives inside `_send_via_ses` rather than at the call sites because that is the
one function every provider send passes through, and a guard a new caller can
forget to invoke is not a guard.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
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

#: Names reserved by RFC 2606 and RFC 6761 precisely so that they never receive
#: mail, plus mDNS `.local`. Every one of the ~80 seeded demo speakers has an
#: address at one of the first three.
RESERVED_DOMAINS = frozenset(
    {
        "example.com",
        "example.net",
        "example.org",
        "test",
        "example",
        "invalid",
        "localhost",
        "local",
    }
)
#: Derived, so a name added above is caught as a subdomain too and the two can
#: never disagree — `mail.example.com` is as undeliverable as `example.com`.
RESERVED_SUFFIXES = tuple(f".{name}" for name in sorted(RESERVED_DOMAINS))


class UndeliverableRecipientError(Exception):
    """An address no provider should ever be asked to deliver to.

    Raised instead of calling SES, so it lands in the outbox through the same
    `failed` path as a provider refusal and the organizer sees why.
    """


def undeliverable_reason(to_email: str) -> str | None:
    """Why this address must never reach SES, or None if it may.

    Reserved domains hard-bounce by design, and SES scores a hard bounce against
    the account, not the message. One "send decisions" on the seeded demo event
    is ~200 recipients at a guaranteed 100% bounce rate, which is four times the
    5% review threshold and twice the 10% sending pause. The AWS account is
    shared, so that suspension would not stop at this app.

    This is deliberately not a general address validator. It rejects the one
    class of address that is *known* undeliverable; anything else is the
    provider's call to make.
    """
    domain = to_email.rpartition("@")[2].strip().lower()
    if not domain:
        return f"{to_email!r} has no domain"
    if domain in RESERVED_DOMAINS or domain.endswith(RESERVED_SUFFIXES):
        return (
            f"{domain} is a reserved domain that cannot receive mail (RFC 2606). "
            "Seeded demo addresses are never delivered to; a hard bounce here "
            "would count against the sending account."
        )
    return None


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

    Blocking, so callers run it in a worker thread. Raises on refusal, and on a
    recipient we already know is undeliverable — the caller turns either into a
    `failed` outbox row rather than letting it escape.
    """
    settings = get_settings()
    if reason := undeliverable_reason(to_email):
        raise UndeliverableRecipientError(reason)
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


async def deliver_batch(session: AsyncSession, messages: Sequence[Message]) -> int:
    """Deliver rows already queued, and report how many reached `sent`.

    `queue` writes `MessageStatus.QUEUED` and nothing in the product ever read
    it back: `deliver` had exactly one call site, inside `send_now`, and the
    worker runs only the nightly overdue sweep. So send-decisions and resend —
    the two flows this product is *about* — recorded a row, returned a success
    count, and delivered nothing. The outbox said "queued", which reads as
    in-flight rather than never.

    Delivery is inline rather than deferred to the worker on purpose: the sweep
    interval is a day, and a decision notice that arrives tomorrow is its own
    kind of broken. With `MAIL_TRANSPORT=log` each send is a file write off the
    event loop, so a full programme is comfortably inside a request. Against a
    real SES account this wants moving behind the worker with a short interval —
    the shape to reach for is a drain of `QUEUED` rather than a second sender.
    """
    await session.flush()
    sent = 0
    for message in messages:
        await deliver(message)
        if message.status is MessageStatus.SENT:
            sent += 1
    await session.flush()
    return sent


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
