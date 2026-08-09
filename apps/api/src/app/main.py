from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import engine
from app.core.errors import ApiError, api_error_handler, validation_error_handler
from app.core.idempotency import IdempotencyMiddleware
from app.features.auth.router import router as auth_router
from app.features.forms.router import router as forms_router
from app.features.program.router import ROUTERS as PROGRAM_ROUTERS
from app.features.publishing.public_router import router as public_surfaces_router
from app.features.publishing.router import approval_router
from app.features.publishing.router import router as publishing_router
from app.features.review.reviewer_router import router as reviewer_router
from app.features.review.router import router as review_admin_router
from app.features.submissions.public_router import router as public_router
from app.features.submissions.router import router as submissions_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    # Fails loud at boot rather than shipping a development secret to production.
    settings.require_production_secrets()
    app.state.redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    try:
        yield
    finally:
        await app.state.redis.aclose()
        await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Gather API",
        description="Speaker and session management for conferences",
        version="0.1.0",
        openapi_url="/v1/openapi.json",
        docs_url="/v1/docs",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_middleware(IdempotencyMiddleware)
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.include_router(auth_router)
    for program_router in PROGRAM_ROUTERS:
        app.include_router(program_router)
    app.include_router(forms_router)
    app.include_router(submissions_router)
    app.include_router(review_admin_router)
    app.include_router(reviewer_router)
    app.include_router(publishing_router)
    app.include_router(approval_router)
    app.include_router(public_router)
    app.include_router(public_surfaces_router)

    @app.get("/v1/health", tags=["ops"])
    async def health() -> dict[str, str]:
        """Liveness. Touches nothing — answers while dependencies are down."""
        return {"status": "ok", "env": settings.env}

    @app.get("/v1/ready", tags=["ops"])
    async def ready(request: Request) -> JSONResponse:
        """Readiness. 503 until every dependency answers, so a deploy waits."""
        checks: dict[str, str] = {}

        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            checks["database"] = "ok"
        except Exception as exc:  # noqa: BLE001 - a probe reports failures, never raises
            checks["database"] = f"error: {type(exc).__name__}"

        try:
            await request.app.state.redis.ping()
            checks["redis"] = "ok"
        except Exception as exc:  # noqa: BLE001
            checks["redis"] = f"error: {type(exc).__name__}"

        healthy = all(value == "ok" for value in checks.values())
        return JSONResponse(
            status_code=200 if healthy else 503,
            content={"status": "ready" if healthy else "degraded", "checks": checks},
        )

    return app


app = create_app()
