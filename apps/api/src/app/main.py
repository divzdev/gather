from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import engine
from app.core.errors import ApiError, api_error_handler, validation_error_handler
from app.core.idempotency import IdempotencyMiddleware
from app.features.auth.router import router as auth_router
from app.features.crm.router import router as crm_router
from app.features.events.router import router as events_router
from app.features.files.router import portal_router as file_comments_portal_router
from app.features.files.router import staff_router as file_comments_router
from app.features.forms.router import router as forms_router
from app.features.integrations.router import router as integrations_router
from app.features.messaging.router import router as messaging_router
from app.features.pages.router import router as pages_router
from app.features.portal.router import router as portal_router
from app.features.program.router import ROUTERS as PROGRAM_ROUTERS
from app.features.publishing.public_router import router as public_surfaces_router
from app.features.publishing.router import approval_router
from app.features.publishing.router import router as publishing_router
from app.features.publishing.saved_embeds import router as saved_embeds_router
from app.features.publishing.session_bulk import router as session_bulk_router
from app.features.publishing.session_crud import router as session_crud_router
from app.features.review.reviewer_router import router as reviewer_router
from app.features.review.router import router as review_admin_router
from app.features.scheduling.router import router as scheduling_router
from app.features.speakers.router import router as speakers_router
from app.features.submissions.public_router import router as public_router
from app.features.submissions.router import router as submissions_router
from app.features.tasks.router import router as tasks_router


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
        # Served by hand below, so the page can point at the spec relatively.
        docs_url=None,
        root_path=settings.api_root_path,
        lifespan=lifespan,
    )

    # The API is reached three ways — directly on :8051, through the web app's
    # /api/v1 rewrite in dev, and through Caddy's /api prefix in production —
    # and only the last of those tells the app what prefix was stripped. An
    # absolute spec URL is therefore wrong in at least one of them: FastAPI's
    # own docs page asked for /v1/openapi.json, which behind either proxy is
    # the Next app's root, and 404s. A relative URL resolves against whatever
    # the browser actually used, so all three work with nothing configured.
    @app.get("/v1/docs", include_in_schema=False)
    async def swagger_ui() -> HTMLResponse:
        return get_swagger_ui_html(
            openapi_url="openapi.json",
            title="Gather API",
            swagger_ui_parameters={"tryItOutEnabled": True},
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
    app.include_router(crm_router)
    app.include_router(events_router)
    app.include_router(file_comments_router)
    app.include_router(file_comments_portal_router)
    app.include_router(forms_router)
    app.include_router(messaging_router)
    app.include_router(speakers_router)
    app.include_router(scheduling_router)
    app.include_router(tasks_router)
    app.include_router(portal_router)
    app.include_router(submissions_router)
    app.include_router(review_admin_router)
    app.include_router(reviewer_router)
    app.include_router(integrations_router)
    app.include_router(pages_router)
    app.include_router(publishing_router)
    app.include_router(saved_embeds_router)
    app.include_router(session_crud_router)
    app.include_router(session_bulk_router)
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
