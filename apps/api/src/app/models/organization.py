from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Enum as SaEnum
from sqlalchemy import ForeignKey, LargeBinary, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, OrgScoped, PrimaryKey, Timestamps, Uuid
from app.models.enums import Role


class Organization(PrimaryKey, Timestamps, Base):
    """The top-level tenant. Deliberately not OrgScoped — it *is* the scope."""

    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    archived_at: Mapped[datetime | None] = mapped_column(nullable=True)

    #: The org key (CONTEXT.md): the organization's own Anthropic key, sealed
    #: with the same Fernet construction as Accelevents credentials and just as
    #: write-only — no API ever returns it. last4 and provenance exist so the
    #: Settings status line is one row with no unsealing and no join.
    ai_key_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    ai_key_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    #: Which provider preset the key belongs to, and which model it asks for.
    #: Two wire protocols cover every preset; the base URL is code, not data —
    #: a stored URL would be an SSRF primitive on the shared box.
    ai_provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    ai_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    #: Only for `ai_provider = 'ollama'`, where the address is the org's to
    #: supply. Restricted to private addresses on save and again on use —
    #: `features/ai/local_url.py` explains why both.
    ai_base_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    ai_key_set_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    ai_key_set_at: Mapped[datetime | None] = mapped_column(nullable=True)
    #: Daily proposal cap (CONTEXT.md): org-wide ceiling on AI proposals per
    #: day. NULL falls back to the server default; 0 turns AI off for the org.
    ai_daily_proposal_cap: Mapped[int | None] = mapped_column(nullable=True)


class OrgMember(PrimaryKey, Timestamps, OrgScoped, Base):
    """A user's membership and default role in one organization."""

    __tablename__ = "org_members"
    __table_args__ = (UniqueConstraint("org_id", "user_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[Role] = mapped_column(
        SaEnum(Role, name="role", native_enum=True, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
