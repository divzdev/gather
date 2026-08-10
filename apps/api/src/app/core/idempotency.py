"""Idempotency-Key replay for retryable mutations.

The brief requires it on send, send-decisions, publish, push, bulk-decision and
bulk-placement — the operations where a retried request must not send a second
batch of email or place a session twice.

Scope note: the stored key includes the method and path, so the same key cannot
replay one endpoint's response at another.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Awaitable, Callable

from redis.asyncio import Redis
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

REPLAY_TTL_SECONDS = 24 * 60 * 60
IDEMPOTENT_METHODS = frozenset({"POST", "PATCH", "PUT", "DELETE"})
HEADER = "Idempotency-Key"

#: Marks a key whose request is running right now. Short-lived so a process that
#: dies mid-request cannot block the same key for a day.
IN_FLIGHT = "in-flight"
IN_FLIGHT_TTL_SECONDS = 60
_WAIT_ATTEMPTS = 60
_WAIT_INTERVAL_SECONDS = 0.1


def _cache_key(request: Request, key: str) -> str:
    fingerprint = hashlib.sha256(f"{key}:{request.method}:{request.url.path}".encode()).hexdigest()
    return f"idempotency:{fingerprint}"


def _replay_or_wait(cached: str | bytes) -> JSONResponse | None:
    """A stored response replays; the in-flight marker does not."""
    text = cached.decode() if isinstance(cached, bytes) else cached
    if text == IN_FLIGHT:
        return None
    stored = json.loads(text)
    return JSONResponse(
        status_code=stored["status"],
        content=stored["body"],
        headers={"Idempotent-Replay": "true"},
    )


async def _await_winner(redis: Redis, cache_key: str) -> Response:
    """Wait for the request already holding this key, then replay its answer.

    Waiting rather than refusing: the caller sent the same key on purpose, and
    the honest answer to "did my request go through" is the winner's response,
    not an error about concurrency they did not ask about.
    """
    for _ in range(_WAIT_ATTEMPTS):
        await asyncio.sleep(_WAIT_INTERVAL_SECONDS)
        cached = await redis.get(cache_key)
        if cached is None:
            break
        replay = _replay_or_wait(cached)
        if replay is not None:
            return replay

    return JSONResponse(
        status_code=409,
        content={
            "error": {
                "code": "IDEMPOTENT_REQUEST_IN_FLIGHT",
                "message": "An identical request is still running. Retry with the same key.",
            }
        },
    )


class IdempotencyMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        key = request.headers.get(HEADER)
        if key is None or request.method not in IDEMPOTENT_METHODS:
            return await call_next(request)

        redis: Redis | None = getattr(request.app.state, "redis", None)
        if redis is None:
            return await call_next(request)

        cache_key = _cache_key(request, key)
        cached = await redis.get(cache_key)
        if cached is not None:
            return _replay_or_wait(cached) or await _await_winner(redis, cache_key)

        # Reserve the key before doing the work, not after. Caching only the
        # finished response left the window that matters wide open: two truly
        # concurrent requests — a double-click, a retry that beat the first —
        # both missed the cache and both ran, which is how one proposal became
        # two.
        reserved = await redis.set(cache_key, IN_FLIGHT, ex=IN_FLIGHT_TTL_SECONDS, nx=True)
        if not reserved:
            return await _await_winner(redis, cache_key)

        try:
            response = await call_next(request)
        except Exception:
            await redis.delete(cache_key)
            raise

        # Only successful responses are replayable: a failure should be retryable
        # for real, not permanently frozen for 24 hours.
        if response.status_code >= 400:
            await redis.delete(cache_key)
            return response

        body = b"".join([chunk async for chunk in response.body_iterator])  # type: ignore[attr-defined]
        try:
            parsed = json.loads(body) if body else None
        except json.JSONDecodeError:
            parsed = None

        if parsed is None:
            # Nothing to replay, so do not leave the reservation standing and
            # lock the caller out of retrying for a day.
            await redis.delete(cache_key)
        else:
            # No nx here: this deliberately overwrites our own reservation.
            await redis.set(
                cache_key,
                json.dumps({"status": response.status_code, "body": parsed}),
                ex=REPLAY_TTL_SECONDS,
            )

        return Response(
            content=body,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.media_type,
        )
