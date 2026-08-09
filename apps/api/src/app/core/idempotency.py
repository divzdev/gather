"""Idempotency-Key replay for retryable mutations.

The brief requires it on send, send-decisions, publish, push, bulk-decision and
bulk-placement — the operations where a retried request must not send a second
batch of email or place a session twice.

Scope note: the stored key includes the method and path, so the same key cannot
replay one endpoint's response at another.
"""

from __future__ import annotations

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


def _cache_key(request: Request, key: str) -> str:
    fingerprint = hashlib.sha256(f"{key}:{request.method}:{request.url.path}".encode()).hexdigest()
    return f"idempotency:{fingerprint}"


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
            stored = json.loads(cached)
            return JSONResponse(
                status_code=stored["status"],
                content=stored["body"],
                headers={"Idempotent-Replay": "true"},
            )

        response = await call_next(request)

        # Only successful responses are replayable: a failure should be retryable
        # for real, not permanently frozen for 24 hours.
        if response.status_code >= 400:
            return response

        body = b"".join([chunk async for chunk in response.body_iterator])  # type: ignore[attr-defined]
        try:
            parsed = json.loads(body) if body else None
        except json.JSONDecodeError:
            parsed = None

        if parsed is not None:
            await redis.set(
                cache_key,
                json.dumps({"status": response.status_code, "body": parsed}),
                ex=REPLAY_TTL_SECONDS,
                nx=True,
            )

        return Response(
            content=body,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.media_type,
        )
