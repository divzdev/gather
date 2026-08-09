from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any, ClassVar

import uuid_utils
from sqlalchemy import DateTime, ForeignKey, MetaData, func
from sqlalchemy import Enum as SaEnum
from sqlalchemy.dialects.postgresql import UUID as PgUUID  # noqa: N811 - dialect alias
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column

#: Shared UUID column type. SQLAlchemy type instances are stateless and safe to
#: reuse, so every model imports this rather than re-aliasing the dialect import.
Uuid = PgUUID(as_uuid=True)

# Stable constraint names so Alembic autogenerate produces readable, reviewable
# migrations instead of database-assigned noise.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s",
    "pk": "pk_%(table_name)s",
}


def pg_enum(enum_cls: type[Enum], name: str) -> SaEnum:
    """Native Postgres enum storing the member *values*, not their Python names."""
    return SaEnum(
        enum_cls, name=name, native_enum=True, values_callable=lambda e: [m.value for m in e]
    )


def uuid7() -> uuid.UUID:
    """Time-ordered primary keys: index locality plus creation order for free."""
    return uuid.UUID(bytes=uuid_utils.uuid7().bytes)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)

    # Every `datetime` column is timestamptz. Storage is always UTC and the client
    # renders using event.timezone; a naive column silently breaks that, and it is
    # far too easy to forget DateTime(timezone=True) on an individual field.
    type_annotation_map: ClassVar[dict[Any, Any]] = {datetime: DateTime(timezone=True)}


class PrimaryKey:
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class OrgScoped:
    """Marker: every row belongs to one organization.

    Subclassing this is what enrolls a model in automatic tenancy filtering —
    see app/core/tenancy.py. There is no way to opt a row out.
    """

    @declared_attr
    @classmethod
    def org_id(cls) -> Mapped[uuid.UUID]:
        return mapped_column(
            Uuid,
            ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )


class EventScoped(OrgScoped):
    """Marker: row belongs to one event within one organization."""

    @declared_attr
    @classmethod
    def event_id(cls) -> Mapped[uuid.UUID]:
        return mapped_column(
            Uuid,
            ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
