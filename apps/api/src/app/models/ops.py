"""Activity log, AI proposals, integrations, and saved views."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, EventScoped, OrgScoped, PrimaryKey, Timestamps, Uuid, pg_enum
from app.models.enums import (
    ActorKind,
    AiProposalKind,
    AiProposalStatus,
    IntegrationProvider,
    PushKind,
)


class ActivityLog(Base, PrimaryKey, Timestamps, OrgScoped):
    """Append-only. The data is logged; there is deliberately no browser UI."""

    __tablename__ = "activity_log"
    __table_args__ = (
        Index("ix_activity_log_entity", "entity_type", "entity_id", "created_at"),
        Index("ix_activity_log_event_created", "event_id", "created_at"),
    )

    event_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("events.id", ondelete="CASCADE"), nullable=True
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    actor_speaker_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("speakers.id", ondelete="SET NULL"), nullable=True
    )
    actor_kind: Mapped[ActorKind] = mapped_column(
        pg_enum(ActorKind, "actor_kind"), nullable=False, default=ActorKind.USER
    )
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    changes: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)


class AiProposal(Base, PrimaryKey, Timestamps, EventScoped):
    """Every AI suggestion, and what a human did with it.

    The row is created before streaming starts, so a dropped connection loses
    nothing — a reconnect reads it back.
    """

    __tablename__ = "ai_proposals"

    kind: Mapped[AiProposalKind] = mapped_column(
        pg_enum(AiProposalKind, "ai_proposal_kind"), nullable=False
    )
    input: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    output: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    token_usage: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[AiProposalStatus] = mapped_column(
        pg_enum(AiProposalStatus, "ai_proposal_status"),
        nullable=False,
        default=AiProposalStatus.STREAMING,
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(nullable=True)


class IntegrationConfig(Base, PrimaryKey, Timestamps, EventScoped):
    __tablename__ = "integration_configs"
    __table_args__ = (UniqueConstraint("event_id", "provider"),)

    provider: Mapped[IntegrationProvider] = mapped_column(
        pg_enum(IntegrationProvider, "integration_provider"), nullable=False
    )
    # Envelope-encrypted and never returned by the API, in any shape.
    credentials_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    remote_event_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    field_mapping: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    last_tested_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_test_result: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)


class IntegrationPush(Base, PrimaryKey, Timestamps, EventScoped):
    """A dry run and a real push share this shape because they share a code path."""

    __tablename__ = "integration_pushes"

    integration_config_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("integration_configs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[PushKind] = mapped_column(pg_enum(PushKind, "push_kind"), nullable=False)
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    rows: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class SavedView(Base, PrimaryKey, Timestamps, EventScoped):
    """A saved view is just serialised URL query state."""

    __tablename__ = "saved_views"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    table_key: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    query: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
