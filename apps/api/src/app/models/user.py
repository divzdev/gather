from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, String
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, PrimaryKey, Timestamps


class User(PrimaryKey, Timestamps, Base):
    """Staff and reviewers. Speakers are a separate model and never have a password.

    Not OrgScoped: one person can be a member of several organizations, so the
    membership carries the tenancy, not the identity.
    """

    __tablename__ = "users"

    # CITEXT so "Ada@Example.com" and "ada@example.com" cannot both exist.
    email: Mapped[str] = mapped_column(CITEXT(), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(nullable=True)

    density_pref: Mapped[str] = mapped_column(String(20), nullable=False, default="compact")
    theme_pref: Mapped[str] = mapped_column(String(20), nullable=False, default="system")
