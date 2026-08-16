"""Where an organisation may point the server, when it points it at a local model.

Every other provider's base URL is hardcoded in `PROVIDERS` for one reason: a
URL supplied by an organisation is an SSRF primitive. The server fetches
whatever it is told to — including `169.254.169.254`, which on EC2 hands out
credentials — and our own error surface obligingly reports what came back.

The local-model provider has to accept a URL, because only the operator knows
where their Ollama is. So it accepts a restricted one. The restriction is on the
**resolved address**, never on the spelling: a hostname is exactly as dangerous
as the address it resolves to, and `nas.internal` can resolve anywhere.

Checked twice on purpose — once when the configuration is saved, once each time
it is used — because a name that resolved privately at save time can resolve
publicly later. That is DNS rebinding, and a single check at save is precisely
the shape it defeats.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit

__all__ = ["LocalUrlError", "resolve_local_base_url"]

_ALLOWED_SCHEMES = frozenset({"http", "https"})


class LocalUrlError(ValueError):
    """The address is not one this server will fetch. The message names it."""


def _addresses(host: str) -> list[str]:
    """Every address the host resolves to. Seam for the rebinding tests."""
    try:
        found = socket.getaddrinfo(host, None)
    except OSError as error:
        raise LocalUrlError(f"could not resolve {host!r}: {error.strerror or error}") from error
    # sockaddr[0] is the address for both AF_INET and AF_INET6; the tuple is
    # typed loosely because the two families carry different shapes.
    return [str(info[4][0]) for info in found]


def _is_local(address: str) -> bool:
    parsed = ipaddress.ip_address(address)
    # `is_private` covers loopback, RFC1918 and unique-local, but it also covers
    # link-local — and 169.254.169.254 is link-local, which is the single
    # address this whole module exists to refuse. So link-local is excluded
    # explicitly rather than inherited.
    return parsed.is_private and not parsed.is_link_local


def resolve_local_base_url(candidate: str) -> str:
    """Return the normalised base URL, or raise with the reason it was refused.

    Normalised means scheme and host preserved, trailing slash removed, so two
    spellings of the same server compare equal.
    """
    raw = (candidate or "").strip()
    if raw == "":
        raise LocalUrlError("Enter the address of your local model server.")

    parts = urlsplit(raw)
    if parts.scheme not in _ALLOWED_SCHEMES:
        raise LocalUrlError(
            f"{parts.scheme or 'that'!r} is not an address this server can fetch — "
            "use http:// or https://."
        )
    host = parts.hostname
    if not host:
        raise LocalUrlError(f"{raw!r} has no host in it.")

    resolved = _addresses(host)
    if not resolved:
        raise LocalUrlError(f"{host!r} did not resolve to any address.")

    # Every answer has to be local. One public address among several is enough
    # to refuse, because nothing here chooses which one the HTTP client uses.
    for address in resolved:
        try:
            local = _is_local(address)
        except ValueError as error:  # pragma: no cover - getaddrinfo returns IPs
            raise LocalUrlError(f"{address!r} is not an address: {error}") from error
        if not local:
            raise LocalUrlError(
                f"{host} resolves to {address}, which is not on a private network. "
                "A local model server has to be reachable at a loopback or private "
                "address — this server will not fetch a public one."
            )

    return raw.rstrip("/")
