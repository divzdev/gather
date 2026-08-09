from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Enum as SaEnum
from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, OrgScoped, PrimaryKey, Timestamps, Uuid
from app.models.enums import Role


class Organization(PrimaryKey, Timestamps, Base):
    """The top-level tenant. Deliberately not OrgScoped — it *is* the scope."""

    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    archived_at: Mapped[datetime | None] = mapped_column(nullable=True)


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
