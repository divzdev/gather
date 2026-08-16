"""Where the server is allowed to be pointed (spec 0006, seam 2).

The nine paid providers have their base URLs hardcoded because an org-supplied
URL is an SSRF primitive: the server fetches whatever it is told to, including
cloud metadata endpoints, and hands the response back through our own error
surface. The local-model provider has to accept a URL — that is the whole point
of it — so it accepts a *restricted* one, and the restriction gets its own tests
rather than being exercised incidentally somewhere else.
"""

from __future__ import annotations

import pytest

from app.features.ai.local_url import LocalUrlError, resolve_local_base_url

ALLOWED = [
    "http://localhost:11434",
    "http://127.0.0.1:11434",
    "http://127.1.2.3:11434",
    "https://localhost:11434",
    "http://10.0.0.7:11434",
    "http://172.16.4.5:11434",
    "http://172.31.255.255:11434",
    "http://192.168.1.20:11434",
    "http://[::1]:11434",
]

REFUSED = [
    # The attack this exists to stop: EC2/GCP instance metadata.
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/",
    # Ordinary public hosts.
    "http://93.184.216.34:11434",
    "https://example.com",
    # 172.32 is outside 172.16/12 — the boundary people get wrong.
    "http://172.32.0.1:11434",
    # Not a fetchable http(s) target.
    "file:///etc/passwd",
    "gopher://127.0.0.1:11434",
    "ftp://127.0.0.1",
    # No host at all.
    "http://",
    "not a url",
]


@pytest.mark.parametrize("candidate", ALLOWED)
def test_a_private_or_loopback_address_is_allowed(candidate: str) -> None:
    assert resolve_local_base_url(candidate).startswith(("http://", "https://"))


@pytest.mark.parametrize("candidate", REFUSED)
def test_anything_reachable_from_the_internet_is_refused(candidate: str) -> None:
    with pytest.raises(LocalUrlError):
        resolve_local_base_url(candidate)


def test_the_refusal_says_which_address_it_objected_to() -> None:
    """The admin has to be able to tell a typo from a policy refusal."""
    with pytest.raises(LocalUrlError) as raised:
        resolve_local_base_url("http://93.184.216.34:11434")

    assert "93.184.216.34" in str(raised.value)


def test_a_name_that_resolves_publicly_is_refused_however_it_is_spelled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The check is on the resolved address, not on the spelling.

    `nas.example.com` may be a perfectly ordinary hostname; if it resolves to a
    public address the server must not fetch it, and no amount of it *looking*
    local changes that.
    """
    import app.features.ai.local_url as module

    monkeypatch.setattr(module, "_addresses", lambda host: ["93.184.216.34"])

    with pytest.raises(LocalUrlError):
        resolve_local_base_url("http://nas.example.com:11434")


def test_a_host_that_resolves_to_both_private_and_public_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DNS rebinding: one private answer is not enough if a public one is also
    on offer, because we do not control which the HTTP client picks."""
    import app.features.ai.local_url as module

    monkeypatch.setattr(module, "_addresses", lambda host: ["127.0.0.1", "93.184.216.34"])

    with pytest.raises(LocalUrlError):
        resolve_local_base_url("http://rebind.test:11434")


def test_a_trailing_slash_does_not_change_the_verdict() -> None:
    assert resolve_local_base_url("http://localhost:11434/") == resolve_local_base_url(
        "http://localhost:11434"
    )
