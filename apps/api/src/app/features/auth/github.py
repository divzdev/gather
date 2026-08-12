"""The GitHub OAuth gateway. The only module in the app that talks to GitHub.

Kept apart from `service.py` for the same reason SES lives behind `core/mail`:
the service decides what a sign-in means, and this decides how to ask a provider
who somebody is. Swapping providers, or testing the sign-in rules without a
network, then only has one seam to work against.

Absent configuration is a supported state, not an error. With no client id the
routes 404 and the sign-in screen never offers the button, which is what lets
`make setup && make dev` produce a working app with no credentials at all.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import get_settings
from app.core.errors import OAuthError

AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL: str = "https://github.com/login/oauth/access_token"  # noqa: S105 - an endpoint
USER_URL = "https://api.github.com/user"
EMAILS_URL = "https://api.github.com/user/emails"

#: `user:email` is needed because a GitHub profile's public email is frequently
#: absent, and the address we can prove is verified only comes from that list.
SCOPES = "read:user user:email"

#: GitHub is a third party on the far side of the internet, reached inside a
#: request a human is waiting on. Ten seconds is already generous.
TIMEOUT = httpx.Timeout(10.0)


@dataclass(frozen=True, slots=True)
class GitHubIdentity:
    """Who GitHub says this is. `email` is always one GitHub has verified."""

    provider_id: str
    email: str
    name: str
    avatar_url: str | None


def is_enabled() -> bool:
    settings = get_settings()
    return bool(settings.github_client_id and settings.github_client_secret)


def callback_url() -> str:
    """Deliberately the web origin, not the API's.

    The browser is sent here by GitHub, and everything downstream — the refresh
    cookie, the redirect into the console — is same-origin only if the callback
    lands on the app's own host. Next rewrites /api/v1/* to the API, so this is
    one URL that works identically in local dev and behind the deployed proxy.
    """
    return f"{get_settings().web_origin}/api/v1/auth/github/callback"


def authorize_url(*, state: str) -> str:
    return f"{AUTHORIZE_URL}?" + urlencode(
        {
            "client_id": get_settings().github_client_id,
            "redirect_uri": callback_url(),
            "scope": SCOPES,
            "state": state,
            # Force the account chooser rather than silently reusing whatever
            # session the browser already has. Someone signing in to a work tool
            # is often not in their work account.
            "allow_signup": "false",
        }
    )


async def _access_token(client: httpx.AsyncClient, *, code: str) -> str:
    settings = get_settings()
    response = await client.post(
        TOKEN_URL,
        json={
            "client_id": settings.github_client_id,
            "client_secret": settings.github_client_secret,
            "code": code,
            "redirect_uri": callback_url(),
        },
        headers={"Accept": "application/json"},
    )
    if response.status_code != httpx.codes.OK:
        raise OAuthError("GitHub refused the sign-in. Try again.")

    payload: dict[str, Any] = response.json()
    # A rejected code comes back 200 with an `error` key, not a 4xx. Reading only
    # the status here would hand the next call an empty bearer token and turn a
    # clear refusal into an unauthorized-looking mystery.
    token = payload.get("access_token")
    if not isinstance(token, str) or not token:
        raise OAuthError("GitHub refused the sign-in. Try again.")
    return token


def _pick_email(entries: list[dict[str, Any]]) -> str | None:
    """The primary verified address, or any verified one.

    Unverified addresses are never returned. Accepting one would make this route
    a way to claim an account belonging to somebody else's email simply by typing
    it into a GitHub profile.
    """
    verified = [
        entry["email"]
        for entry in entries
        if entry.get("verified") is True and isinstance(entry.get("email"), str)
    ]
    primary = [
        entry["email"]
        for entry in entries
        if entry.get("verified") is True and entry.get("primary") is True
    ]
    return next(iter(primary), None) or next(iter(verified), None)


async def exchange(*, code: str) -> GitHubIdentity:
    """Turn a callback code into a verified identity, or raise."""
    if not is_enabled():  # pragma: no cover - the router 404s first
        raise OAuthError("GitHub sign-in is not configured on this install.")

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            token = await _access_token(client, code=code)
            headers = {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
            }
            profile_response = await client.get(USER_URL, headers=headers)
            emails_response = await client.get(EMAILS_URL, headers=headers)
    except httpx.HTTPError as exc:
        raise OAuthError("Could not reach GitHub. Try again shortly.") from exc

    if profile_response.status_code != httpx.codes.OK:
        raise OAuthError("GitHub would not say who you are. Try again.")

    profile: dict[str, Any] = profile_response.json()
    provider_id = profile.get("id")
    if provider_id is None:
        raise OAuthError("GitHub would not say who you are. Try again.")

    entries: list[dict[str, Any]] = (
        emails_response.json() if emails_response.status_code == httpx.codes.OK else []
    )
    email = _pick_email(entries)
    if email is None:
        raise OAuthError(
            "Your GitHub account has no verified email address. "
            "Verify one on GitHub, or sign up with an email and password instead."
        )

    return GitHubIdentity(
        provider_id=str(provider_id),
        # `name` is optional on GitHub and frequently null; the login always
        # exists, and a person with no display name is better greeted by their
        # handle than by an empty string.
        name=str(profile.get("name") or profile.get("login") or email.split("@")[0]),
        email=email,
        avatar_url=str(profile["avatar_url"]) if profile.get("avatar_url") else None,
    )
