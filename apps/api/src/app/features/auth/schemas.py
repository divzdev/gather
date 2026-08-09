from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class Strict(BaseModel):
    """Unknown fields are rejected, not ignored — see .claude/rules/python.md."""

    model_config = ConfigDict(extra="forbid")


class LoginRequest(Strict):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


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
