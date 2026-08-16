"""Fixed-window rate limiting backed by Redis.

Deliberately simple: one INCR plus an EXPIRE on first hit. A sliding window would
be more precise at the boundary, but these limits exist to stop credential
stuffing and mail bombing, not to meter an API — precision buys nothing here.
"""

from __future__ import annotations

from dataclasses import dataclass

from redis.asyncio import Redis

from app.core.config import get_settings
from app.core.errors import RateLimitedError


@dataclass(frozen=True, slots=True)
class Limit:
    attempts: int
    window_seconds: int


# engineering-brief §4.8
LOGIN = Limit(attempts=10, window_seconds=15 * 60)
MAGIC_LINK = Limit(attempts=3, window_seconds=15 * 60)
#: Consuming a durable portal link. Looser than issuing mail (nothing is sent),
#: tight enough that guessing 32-byte tokens through it stays absurd.
PORTAL_LINK = Limit(attempts=20, window_seconds=15 * 60)
# Signup writes an org, a user and an event; a loose limit here is a spam vector.
REGISTER = Limit(attempts=5, window_seconds=60 * 60)
#: The OAuth round trip is cheap for us and expensive for a scraper; this exists
#: to stop the callback being hammered with guessed `state` values.
OAUTH = Limit(attempts=20, window_seconds=15 * 60)
#: Per submitting address. A person with six talks to propose in one hour is
#: unusual; a person with six talks is not, so this is a spam ceiling and not
#: the product rule — `submission_limit_per_speaker` is that, and it is the one
#: an organiser sets.
PUBLIC_SUBMISSION = Limit(attempts=5, window_seconds=60 * 60)
#: Per IP, and deliberately an order of magnitude looser, because an IP is not a
#: person. This used to be the *only* submission limit at five an hour, which
#: meant one office, one university lab, one co-working space or one mobile
#: carrier behind CGNAT shared a budget of five — and it bit hardest in the hours
#: before a deadline, when a company pushes four speakers through at once and the
#: fifth is told "Too many attempts" holding a finished abstract. A network is
#: throttled here only when the traffic stops looking like people.
PUBLIC_SUBMISSION_PER_IP = Limit(attempts=60, window_seconds=60 * 60)
PUBLIC_DRAFT_SAVE = Limit(attempts=60, window_seconds=60 * 60)
AI = Limit(attempts=20, window_seconds=60 * 60)


async def enforce(redis: Redis, limit: Limit, *, bucket: str, identifier: str) -> None:
    """Count one attempt against `bucket:identifier`, raising once over the limit."""
    key = f"{get_settings().rate_limit_prefix}:{bucket}:{identifier}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, limit.window_seconds)
    if count > limit.attempts:
        retry_after = await redis.ttl(key)
        raise RateLimitedError(
            "Too many attempts. Try again shortly.",
            details={"retry_after_seconds": max(retry_after, 1)},
        )
