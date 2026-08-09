"""Password hashing, opaque tokens, and JWTs.

Nothing here is hand-rolled crypto: Argon2id comes from argon2-cffi, randomness
from `secrets`, and JWTs from PyJWT. Every token is stored hashed, never raw.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Final, Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

# RFC 9106 second-recommended profile: 64 MiB, 3 passes. Comfortably above the
# bcrypt cost-12 floor in .claude/rules/security.md.
_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)

JWT_ALGORITHM: Final = "HS256"
TOKEN_BYTES: Final = 32

TokenKind = Literal["access", "speaker"]


def hash_password(raw: str) -> str:
    return _hasher.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, raw)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(hashed: str) -> bool:
    """True when the stored hash predates the current cost parameters."""
    try:
        return _hasher.check_needs_rehash(hashed)
    except InvalidHashError:
        return True


def generate_token() -> str:
    """A high-entropy opaque token: magic links and refresh tokens."""
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    """Tokens are stored as SHA-256 digests.

    Plain SHA-256 is correct here and Argon2 would be wrong: these are 32 bytes
    from a CSPRNG, not human-chosen, so there is nothing to brute-force and the
    lookup must stay fast enough to run on every refresh.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_ip(ip: str) -> str:
    """IPs are recorded for rate limiting and audit, never in the clear."""
    settings = get_settings()
    return hashlib.sha256(f"{settings.secret_key}:{ip}".encode()).hexdigest()


def create_access_token(
    subject: uuid.UUID,
    *,
    kind: TokenKind = "access",
    expires_in: timedelta | None = None,
    claims: dict[str, Any] | None = None,
) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    ttl = expires_in or timedelta(minutes=settings.access_token_ttl_minutes)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "typ": kind,
        "iat": now,
        "exp": now + ttl,
        "jti": str(uuid.uuid4()),
        **(claims or {}),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """Raises jwt.PyJWTError on anything invalid — expired, tampered, wrong alg."""
    settings = get_settings()
    decoded: dict[str, Any] = jwt.decode(
        token,
        settings.secret_key,
        algorithms=[JWT_ALGORITHM],
        options={"require": ["exp", "iat", "sub", "typ"]},
    )
    return decoded
