"""Envelope encryption for the few secrets this app stores at rest.

Only integration credentials go through here. Passwords are hashed, not
encrypted, and tokens are hashed too — encryption is for the one case where the
plaintext has to come back out, because a third-party API needs it.

The key is derived from `secret_key` rather than configured separately, so
there is one secret to rotate and no way to run with encryption "on" but
unkeyed. `require_production_secrets()` already refuses to boot production on
the development default, which is what makes that safe.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


def _key() -> bytes:
    """A Fernet key from the app secret. SHA-256 gives exactly the 32 bytes
    Fernet wants; the label keeps this key distinct from any other use of
    `secret_key`, so reusing it elsewhere cannot weaken this one."""
    digest = hashlib.sha256(f"integration-credentials:{get_settings().secret_key}".encode())
    return base64.urlsafe_b64encode(digest.digest())


def seal(plaintext: str) -> bytes:
    return Fernet(_key()).encrypt(plaintext.encode())


def unseal(sealed: bytes | None) -> str | None:
    """None for anything that will not open — a rotated key leaves rows that
    can no longer be read, and that is a reconfigure, not a crash."""
    if sealed is None:
        return None
    try:
        return Fernet(_key()).decrypt(sealed).decode()
    except InvalidToken:
        return None
