from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Cookie, Request, Response, status
from redis.asyncio import Redis

from app.core import rate_limit
from app.core.config import get_settings
from app.core.deps import CurrentUser, DbSession
from app.core.errors import AuthenticationError
from app.features.auth import service
from app.features.auth.schemas import (
    LoginRequest,
    MagicLinkConsumeRequest,
    MagicLinkRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter(prefix="/v1/auth", tags=["auth"])

REFRESH_COOKIE = "gather_refresh"


def _redis(request: Request) -> Redis:
    redis: Redis = request.app.state.redis
    return redis


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _set_refresh_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=settings.refresh_token_ttl_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path="/v1/auth",
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest, request: Request, response: Response, session: DbSession
) -> TokenResponse:
    ip = _client_ip(request)
    await rate_limit.enforce(
        _redis(request), rate_limit.LOGIN, bucket="login", identifier=ip or "unknown"
    )
    issued = await service.authenticate(
        session,
        email=body.email,
        password=body.password,
        user_agent=request.headers.get("user-agent"),
        ip=ip,
    )
    _set_refresh_cookie(response, issued.refresh_token)
    return TokenResponse(access_token=issued.access_token, expires_in=issued.expires_in)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    request: Request,
    response: Response,
    session: DbSession,
    gather_refresh: Annotated[str | None, Cookie()] = None,
) -> TokenResponse:
    if gather_refresh is None:
        raise AuthenticationError("Sign in to continue.")
    issued = await service.refresh(
        session,
        refresh_token=gather_refresh,
        user_agent=request.headers.get("user-agent"),
        ip=_client_ip(request),
    )
    _set_refresh_cookie(response, issued.refresh_token)
    return TokenResponse(access_token=issued.access_token, expires_in=issued.expires_in)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    session: DbSession,
    gather_refresh: Annotated[str | None, Cookie()] = None,
) -> None:
    if gather_refresh is not None:
        await service.revoke(session, refresh_token=gather_refresh)
    response.delete_cookie(REFRESH_COOKIE, path="/v1/auth")


@router.post("/magic-link", status_code=status.HTTP_204_NO_CONTENT)
async def request_magic_link(body: MagicLinkRequest, request: Request, session: DbSession) -> None:
    """Always 204, whether or not the address exists.

    Any other behaviour turns this into a speaker-enumeration oracle.
    """
    await rate_limit.enforce(
        _redis(request), rate_limit.MAGIC_LINK, bucket="magic-link", identifier=body.email
    )
    token = await service.issue_magic_link(
        session, email=body.email, event_id=body.event_id, ip=_client_ip(request)
    )
    # TODO(mail): hand `token` to the mail gateway. Until that lands, MAIL_TRANSPORT=log
    # is the only consumer and the token is written to .mail/ by the renderer.
    _ = token


@router.post("/magic-link/consume", response_model=TokenResponse)
async def consume_magic_link(body: MagicLinkConsumeRequest, session: DbSession) -> TokenResponse:
    settings = get_settings()
    access_token = await service.consume_magic_link(session, token=body.token)
    return TokenResponse(
        access_token=access_token,
        expires_in=settings.speaker_session_ttl_days * 24 * 60 * 60,
    )


@router.get("/me", response_model=UserResponse)
async def me(user: CurrentUser) -> UserResponse:
    return UserResponse.model_validate(user)
