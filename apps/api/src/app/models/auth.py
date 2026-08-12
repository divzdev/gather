from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Enum as SaEnum
from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, PrimaryKey, Timestamps, Uuid
from app.models.enums import MagicLinkPurpose


class AuthSession(Base, PrimaryKey, Timestamps):
    """A staff refresh token. Rotated on every use, hashed at rest.

    Not tenant-scoped: it belongs to a user, who may span organizations.
    """

    __tablename__ = "auth_sessions"
    __table_args__ = (Index("ix_auth_sessions_user_id_expires_at", "user_id", "expires_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    refresh_token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(400), nullable=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    def is_usable(self, now: datetime) -> bool:
        return self.revoked_at is None and self.expires_at > now


class MagicLink(Base, PrimaryKey, Timestamps):
    """Single-use, short-lived passwordless login.

    Speakers never have a password, so this is the only way in for them. Staff do
    have one, and this is how they get back when they have lost it — there is no
    password reset in this build, and a link that signs you in is strictly better
    than one that lets you choose a new secret over the same email channel.

    The email is stored rather than an id because a link may be issued before we
    know whether that address belongs to anyone — the endpoint must answer
    identically either way so it cannot be used to enumerate people. At most one
    of `speaker_id` and `user_id` is set, and which one decides what consuming it
    produces: a portal token or a console session.
    """

    __tablename__ = "magic_links"
    __table_args__ = (Index("ix_magic_links_email_created_at", "email", "created_at"),)

    email: Mapped[str] = mapped_column(CITEXT(), nullable=False)
    speaker_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("events.id", ondelete="CASCADE"), nullable=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    purpose: Mapped[MagicLinkPurpose] = mapped_column(
        SaEnum(
            MagicLinkPurpose,
            name="magic_link_purpose",
            native_enum=True,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=MagicLinkPurpose.PORTAL,
    )
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    def is_usable(self, now: datetime) -> bool:
        return self.consumed_at is None and self.expires_at > now
