"""Fixed-window rate limiting backed by Redis.

Deliberately simple: one INCR plus an EXPIRE on first hit. A sliding window would
be more precise at the boundary, but these limits exist to stop credential
stuffing and mail bombing, not to meter an API — precision buys nothing here.
"""

from __future__ import annotations

from dataclasses import dataclass

from redis.asyncio import Redis

from app.core.errors import RateLimitedError


@dataclass(frozen=True, slots=True)
class Limit:
    attempts: int
    window_seconds: int


# engineering-brief §4.8
LOGIN = Limit(attempts=10, window_seconds=15 * 60)
MAGIC_LINK = Limit(attempts=3, window_seconds=15 * 60)
# Signup writes an org, a user and an event; a loose limit here is a spam vector.
REGISTER = Limit(attempts=5, window_seconds=60 * 60)
PUBLIC_SUBMISSION = Limit(attempts=5, window_seconds=60 * 60)
PUBLIC_DRAFT_SAVE = Limit(attempts=60, window_seconds=60 * 60)
AI = Limit(attempts=20, window_seconds=60 * 60)
PUBLIC_READ = Limit(attempts=300, window_seconds=60)


async def enforce(redis: Redis, limit: Limit, *, bucket: str, identifier: str) -> None:
    """Count one attempt against `bucket:identifier`, raising once over the limit."""
    key = f"ratelimit:{bucket}:{identifier}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, limit.window_seconds)
    if count > limit.attempts:
        retry_after = await redis.ttl(key)
        raise RateLimitedError(
            "Too many attempts. Try again shortly.",
            details={"retry_after_seconds": max(retry_after, 1)},
        )
