from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class Strict(BaseModel):
    """Unknown fields are rejected, not ignored — see .claude/rules/python.md."""

    model_config = ConfigDict(extra="forbid")


class LoginRequest(Strict):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class RegisterRequest(Strict):
    name: str = Field(min_length=1, max_length=200)
    #: Optional: an organiser running a single event has none, and Settings
    #: can name it later.
    organisation: str = Field(default="", max_length=200)
    email: EmailStr
    # Long enough to matter, capped so a huge string cannot burn Argon2 time.
    password: str = Field(min_length=12, max_length=200)


class TokenResponse(Strict):
    access_token: str
    token_type: str = "bearer"  # noqa: S105 - the OAuth scheme name, not a secret
    expires_in: int


class MagicLinkRequest(Strict):
    email: EmailStr
    event_id: uuid.UUID | None = None


class MagicLinkConsumeRequest(Strict):
    token: str = Field(min_length=1, max_length=200)


class UserResponse(Strict):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    email: str
    name: str
    avatar_url: str | None
    density_pref: str
    theme_pref: str
    #: The console header shows both on every screen. Without them it fell back
    #: to the prototype's placeholder and told every organiser they were
    #: "Sasha Whitfield, program lead, demo org".
    role: str = ""
    org_name: str | None = None


class ProfileUpdate(Strict):
    """What a person may change about themselves.

    Not the email: it is the login identity and changing it is an account
    recovery flow, not a profile edit. Not the role or organisation either —
    those are membership, granted by someone else.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    avatar_url: str | None = Field(default=None, max_length=500)
    density_pref: Literal["comfortable", "compact"] | None = None
