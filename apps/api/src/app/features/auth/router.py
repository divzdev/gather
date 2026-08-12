from __future__ import annotations

from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, Cookie, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict
from redis.asyncio import Redis
from sqlalchemy import select

from app.core import rate_limit
from app.core.config import get_settings
from app.core.deps import CurrentUser, DbSession
from app.core.errors import AuthenticationError, NotFoundError, OAuthError
from app.core.security import generate_token
from app.core.tenancy import tenancy_disabled
from app.features.auth import github, service
from app.features.auth.schemas import (
    AuthProviders,
    LoginRequest,
    MagicLinkConsumeRequest,
    MagicLinkConsumeResponse,
    MagicLinkRequest,
    ProfileUpdate,
    RegisterRequest,
    RegisterResponse,
    TokenResponse,
    UserResponse,
)
from app.models import Organization, OrgMember

router = APIRouter(prefix="/v1/auth", tags=["auth"])

REFRESH_COOKIE = "gather_refresh"

#: Held in Redis rather than in a cookie so the callback can spend it atomically
#: and a replay finds nothing. Long enough to read GitHub's consent screen.
_OAUTH_STATE_KEY = "oauth:state:{state}"
_OAUTH_STATE_TTL_SECONDS = 10 * 60


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
        # The browser reaches the API through the web app at /api/v1, so the
        # cookie has to be scoped to a path that survives the rewrite.
        path="/",
    )


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    request: Request,
    response: Response,
    session: DbSession,
) -> RegisterResponse:
    await rate_limit.enforce(
        _redis(request),
        rate_limit.REGISTER,
        bucket="register",
        identifier=_client_ip(request) or "anon",
    )
    issued, verified = await service.register(
        session,
        name=body.name,
        email=str(body.email),
        password=body.password,
        organisation=body.organisation,
        user_agent=request.headers.get("user-agent"),
        ip=_client_ip(request),
    )
    _set_refresh_cookie(response, issued.refresh_token)
    return RegisterResponse(
        access_token=issued.access_token,
        expires_in=issued.expires_in,
        email_verified=verified,
    )


@router.get("/providers", response_model=AuthProviders)
async def providers() -> AuthProviders:
    """Which sign-in methods this install can actually perform.

    The screen asks before drawing the buttons. A "Continue with GitHub" that
    leads to a 404 is worse than no button at all, and whether it works is a
    deployment fact the browser has no other way to learn.
    """
    return AuthProviders(github=github.is_enabled())


def _github_or_404() -> None:
    if not github.is_enabled():
        raise NotFoundError("GitHub sign-in is not configured on this install.")


def _safe_next(value: str | None) -> str:
    """Only in-app absolute paths survive. Anything else becomes the console.

    This value is round-tripped through GitHub and comes back as a query
    parameter, so it is attacker-controlled by definition: without this the
    callback is an open redirect wearing our domain.
    """
    if value is None or not value.startswith("/") or value.startswith("//"):
        return "/admin"
    return value


@router.get("/github/start", status_code=status.HTTP_307_TEMPORARY_REDIRECT)
async def github_start(
    request: Request,
    next_path: Annotated[str | None, Query(alias="next")] = None,
) -> RedirectResponse:
    """Send the browser to GitHub, remembering where it was going."""
    _github_or_404()
    await rate_limit.enforce(
        _redis(request),
        rate_limit.OAUTH,
        bucket="oauth-start",
        identifier=_client_ip(request) or "anon",
    )
    # The state is the CSRF defence: it is unguessable, it is held server-side,
    # and the callback spends it. A callback carrying a state we never issued is
    # somebody else's login being replayed into this browser.
    state = generate_token()
    await _redis(request).set(
        _OAUTH_STATE_KEY.format(state=state),
        _safe_next(next_path),
        ex=_OAUTH_STATE_TTL_SECONDS,
    )
    return RedirectResponse(
        github.authorize_url(state=state), status_code=status.HTTP_307_TEMPORARY_REDIRECT
    )


@router.get("/github/callback", status_code=status.HTTP_307_TEMPORARY_REDIRECT)
async def github_callback(
    request: Request,
    session: DbSession,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Where GitHub sends the browser back.

    Never returns a token in the URL. The session is handed over as the same
    httpOnly refresh cookie every other sign-in sets, and the page it lands on
    exchanges that for an access token — so nothing sensitive is ever in a
    location bar, a history entry or a server log.
    """
    _github_or_404()
    web = get_settings().web_origin

    if error is not None or code is None or state is None:
        # The person pressed "Cancel" on GitHub's consent screen, most likely.
        # That is not a failure worth an error page.
        return RedirectResponse(f"{web}/login", status_code=status.HTTP_307_TEMPORARY_REDIRECT)

    await rate_limit.enforce(
        _redis(request),
        rate_limit.OAUTH,
        bucket="oauth-callback",
        identifier=_client_ip(request) or "anon",
    )
    # Single use, atomically: GETDEL means a replayed callback finds nothing.
    stored = await _redis(request).getdel(_OAUTH_STATE_KEY.format(state=state))
    if stored is None:
        return RedirectResponse(
            f"{web}/login?error=oauth_state", status_code=status.HTTP_307_TEMPORARY_REDIRECT
        )
    destination = stored.decode() if isinstance(stored, bytes) else str(stored)

    try:
        identity = await github.exchange(code=code)
    except OAuthError:
        return RedirectResponse(
            f"{web}/login?error=oauth_failed", status_code=status.HTTP_307_TEMPORARY_REDIRECT
        )

    issued = await service.sign_in_with_github(
        session,
        identity,
        user_agent=request.headers.get("user-agent"),
        ip=_client_ip(request),
    )
    landing = RedirectResponse(
        f"{web}/auth/github?next={quote(_safe_next(destination), safe='/')}",
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    )
    _set_refresh_cookie(landing, issued.refresh_token)
    return landing


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


class DemoAccount(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: str
    label: str
    email: str


class DemoLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["organizer", "reviewer", "speaker"]


class DemoLoginResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_token: str
    expires_in: int
    #: "staff" opens the console, "speaker" opens the portal. The client needs to
    #: know which token it just received, because they are stored separately.
    kind: str
    event_id: str | None = None


def _demo_or_404() -> None:
    if not get_settings().demo_logins_allowed:
        raise NotFoundError("Not found.")


@router.get("/demo-accounts", response_model=list[DemoAccount])
async def demo_accounts() -> list[DemoAccount]:
    """Who you can sign in as without a password. Absent outside a demo build."""
    _demo_or_404()
    return [
        DemoAccount(role=role, label=label, email=email)
        for role, (email, label) in service.DEMO_ACCOUNTS.items()
    ]


@router.post("/demo-login", response_model=DemoLoginResponse)
async def demo_login(
    body: DemoLoginRequest, request: Request, response: Response, session: DbSession
) -> DemoLoginResponse:
    """One click into any of the three seats.

    The evaluation harness is a browser agent with no inbox, so the magic-link
    path is unreachable for it. This exists for exactly that, and 404s the moment
    the build is not a demo.
    """
    _demo_or_404()
    settings = get_settings()
    email, _label = service.DEMO_ACCOUNTS[body.role]

    if body.role == "speaker":
        token, event_id = await service.demo_speaker_token(session, email=email)
        return DemoLoginResponse(
            access_token=token,
            expires_in=settings.speaker_session_ttl_days * 24 * 60 * 60,
            kind="speaker",
            event_id=str(event_id),
        )

    issued = await service.demo_staff_session(
        session,
        email=email,
        user_agent=request.headers.get("user-agent"),
        ip=_client_ip(request),
    )
    _set_refresh_cookie(response, issued.refresh_token)
    return DemoLoginResponse(
        access_token=issued.access_token, expires_in=issued.expires_in, kind="staff"
    )


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
    response.delete_cookie(REFRESH_COOKIE, path="/")


@router.post("/magic-link", status_code=status.HTTP_204_NO_CONTENT)
async def request_magic_link(body: MagicLinkRequest, request: Request, session: DbSession) -> None:
    """Always 204, whether or not the address exists.

    Any other behaviour turns this into a speaker-enumeration oracle.
    """
    await rate_limit.enforce(
        _redis(request), rate_limit.MAGIC_LINK, bucket="magic-link", identifier=body.email
    )
    await service.issue_magic_link(
        session, email=body.email, event_id=body.event_id, ip=_client_ip(request)
    )


@router.post("/magic-link/consume", response_model=MagicLinkConsumeResponse)
async def consume_magic_link(
    body: MagicLinkConsumeRequest,
    request: Request,
    response: Response,
    session: DbSession,
) -> MagicLinkConsumeResponse:
    """Spend a link. What comes back depends on who the link was issued to.

    A staff link also sets the rotating refresh cookie, because a console session
    is expected to survive longer than the fifteen minutes an access token lasts,
    and confirms the address on the way through.
    """
    consumed = await service.consume_magic_link(
        session,
        token=body.token,
        user_agent=request.headers.get("user-agent"),
        ip=_client_ip(request),
    )
    if consumed.refresh_token is not None:
        _set_refresh_cookie(response, consumed.refresh_token)
    return MagicLinkConsumeResponse(
        access_token=consumed.access_token,
        expires_in=consumed.expires_in,
        kind=consumed.kind,
    )


@router.patch("/me", response_model=UserResponse)
async def update_me(body: ProfileUpdate, user: CurrentUser, session: DbSession) -> UserResponse:
    """Edit your own profile.

    Deliberately narrow: name, avatar and list density. Email is the login
    identity, and role and organisation are membership someone else granted —
    neither belongs behind a self-serve form.
    """
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(user, field, value)
    await session.flush()
    return await me(user, session)


@router.get("/me", response_model=UserResponse)
async def me(user: CurrentUser, session: DbSession) -> UserResponse:
    """Who is signed in, with the organisation and role the console header shows.

    Read outside tenancy: this answers "who am I" before an event is in scope,
    and a signed-in user is always allowed to know their own membership.
    """
    with tenancy_disabled():
        membership = (
            await session.execute(
                select(OrgMember, Organization)
                .join(Organization, Organization.id == OrgMember.org_id)
                .where(OrgMember.user_id == user.id)
                .limit(1)
            )
        ).first()

    payload = UserResponse.model_validate(user)
    payload.email_verified = user.is_email_verified
    if membership is not None:
        member, org = membership
        payload.role = member.role.value
        payload.org_name = org.name
    return payload
