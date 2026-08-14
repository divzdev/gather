"""Reserved-domain recipients must never reach SES.

The failure this guards against is not a lost email. It is one "send decisions"
on the seeded demo event putting ~200 guaranteed hard bounces through a shared
AWS account, which is how an SES identity gets paused for everyone using it.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core import mail
from app.models import Message, MessageStatus


@pytest.mark.parametrize(
    "address",
    [
        "ada@example.com",
        "ada@example.net",
        "ada@example.org",
        "ada@EXAMPLE.COM",
        "ada@mail.example.com",
        "ada@anything.test",
        "ada@anything.invalid",
        "ada@localhost",
        "ada@printer.local",
        "  ada@example.com  ",
        # A trailing dot is a legal fully-qualified name and resolves the same.
        "ada@example.com.",
        "ada@mail.example.com.",
        # UTS-46 folds every one of these to "." before a lookup, so each spells
        # example.com to a resolver. The CRM's CSV import stores addresses with
        # no EmailStr normalisation, so they reach here exactly as typed.
        "ada@example\u3002com",  # IDEOGRAPHIC FULL STOP
        "ada@example\uff0ecom",  # FULLWIDTH FULL STOP
        "ada@example\uff61com",  # HALFWIDTH IDEOGRAPHIC
    ],
)
def test_reserved_addresses_are_refused(address: str) -> None:
    assert mail.undeliverable_reason(address) is not None


@pytest.mark.parametrize(
    "address",
    [
        "ada@wejustlearn.com",
        "ada@gmail.com",
        "ada@sub.university.ac.uk",
        "ada+cfp@wejustlearn.com",
        # Not our call to make: a domain that merely looks unlikely is the
        # provider's problem, and over-refusing silently drops real speakers.
        "ada@exampleconf.com",
        "ada@examples.com",
    ],
)
def test_real_addresses_are_allowed(address: str) -> None:
    assert mail.undeliverable_reason(address) is None


def test_the_guard_fires_before_any_ses_client_is_built(monkeypatch: pytest.MonkeyPatch) -> None:
    """The point of the guard is that boto3 is never reached, not that it errors."""

    def explode() -> None:
        raise AssertionError("built an SES client for a reserved-domain recipient")

    monkeypatch.setattr(mail, "_ses_client", explode)

    with pytest.raises(mail.UndeliverableRecipientError, match="RFC 2606"):
        mail._send_via_ses("ada@example.com", "Your talk was accepted", "<p>hi</p>")


async def test_a_refusal_reaches_the_organizer_as_a_failed_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The guard is only useful if the refusal is visible in the outbox.

    Asserting the raise in isolation proves SES was spared, not that anyone finds
    out. This walks `deliver` on the SES transport and reads the row an organizer
    would actually open.
    """
    monkeypatch.setattr(
        mail,
        "get_settings",
        lambda: SimpleNamespace(
            mail_transport="ses", aws_region="us-east-1", mail_from="events@wejustlearn.com"
        ),
    )
    message = Message(
        to_email="ada@example.com",
        subject="Your talk was accepted",
        body_rendered="<p>Congratulations.</p>",
        status=MessageStatus.QUEUED,
    )

    await mail.deliver(message)

    assert message.status is MessageStatus.FAILED
    assert message.sent_at is None
    assert "RFC 2606" in (message.error_detail or "")


def test_every_seeded_speaker_domain_is_refused() -> None:
    """The seed's own domains, asserted here so changing it re-opens this hole loudly."""
    for domain in ("example.com", "example.org", "example.net"):
        assert mail.undeliverable_reason(f"speaker@{domain}") is not None
