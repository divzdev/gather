"""The operator's side of the Accelevents push.

Four surfaces, in the order an operator meets them: configure, test the
connection and read back which remote event you are aimed at, dry run, execute.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.core import crypto
from app.core.deps import DbSession, bind_tenant, require_role
from app.core.errors import ConflictError, NotFoundError
from app.features.integrations import adapter, service
from app.models import IntegrationConfig, IntegrationProvider, IntegrationPush, PushKind, Role, User

router = APIRouter(
    prefix="/v1/events/{event_id}/integrations/accelevents",
    tags=["integrations"],
    dependencies=[Depends(bind_tenant)],
)

READ = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)
WRITE = (Role.OWNER, Role.ADMIN)


class ConfigWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Write-only. There is no shape of this API that returns it again.
    api_key: str | None = Field(default=None, max_length=500)
    remote_event_id: str | None = Field(default=None, max_length=200)


class ConfigRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: IntegrationProvider
    remote_event_id: str | None
    #: Whether a credential exists, never what it is.
    has_credentials: bool
    last_tested_at: datetime | None
    last_test_result: dict[str, Any]


class PushRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    kind: PushKind
    summary: dict[str, Any]
    rows: dict[str, Any]
    created_at: datetime


async def _config(session: DbSession, event_id: uuid.UUID) -> IntegrationConfig | None:
    """The event's Accelevents row. Tenancy scopes this to `event_id` at the
    session, so the provider is the only predicate written by hand."""
    found: IntegrationConfig | None = await session.scalar(
        select(IntegrationConfig).where(
            IntegrationConfig.provider == IntegrationProvider.ACCELEVENTS
        )
    )
    return found


def _read(config: IntegrationConfig) -> ConfigRead:
    return ConfigRead(
        provider=config.provider,
        remote_event_id=config.remote_event_id,
        has_credentials=config.credentials_encrypted is not None,
        last_tested_at=config.last_tested_at,
        last_test_result=config.last_test_result,
    )


@router.get("", response_model=ConfigRead)
async def read_config(
    event_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*READ))
) -> ConfigRead:
    config = await _config(session, event_id)
    if config is None:
        raise NotFoundError("Accelevents is not configured for this event.")
    return _read(config)


@router.put("", response_model=ConfigRead)
async def configure(
    event_id: uuid.UUID,
    body: ConfigWrite,
    session: DbSession,
    _: User = Depends(require_role(*WRITE)),
) -> ConfigRead:
    config = await _config(session, event_id)
    if config is None:
        config = IntegrationConfig(event_id=event_id, provider=IntegrationProvider.ACCELEVENTS)
        session.add(config)

    # A key is only replaced when one is supplied: saving the form after editing
    # the remote event id must not wipe the credential.
    if body.api_key is not None:
        config.credentials_encrypted = crypto.seal(body.api_key)
    if body.remote_event_id is not None:
        config.remote_event_id = body.remote_event_id

    await session.flush()
    return _read(config)


@router.post("/test", response_model=ConfigRead)
async def test_connection(
    event_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*WRITE))
) -> ConfigRead:
    config = await _config(session, event_id)
    if config is None:
        raise NotFoundError("Accelevents is not configured for this event.")

    config.last_test_result = adapter.describe_event(config.remote_event_id)
    config.last_tested_at = datetime.now(UTC)
    await session.flush()
    return _read(config)


@router.post("/push", response_model=PushRead, status_code=status.HTTP_201_CREATED)
async def push(
    event_id: uuid.UUID,
    session: DbSession,
    dry_run: bool = True,
    user: User = Depends(require_role(*WRITE)),
) -> IntegrationPush:
    """Build the plan, and either keep it as a rehearsal or record it as sent.

    Executing without a credential is refused rather than quietly rehearsing:
    an operator who presses Execute and gets a success page is entitled to
    believe something left the building.
    """
    config = await _config(session, event_id)
    if config is None:
        raise NotFoundError("Accelevents is not configured for this event.")
    if not dry_run and config.credentials_encrypted is None:
        raise ConflictError("Add an API key before executing a push.")

    plan = await service.build_plan(session, config_id=config.id)
    return await service.record(
        session,
        event_id=event_id,
        config_id=config.id,
        plan=plan,
        kind=PushKind.DRY_RUN if dry_run else PushKind.EXECUTE,
        user_id=user.id,
    )


@router.get("/pushes", response_model=list[PushRead])
async def list_pushes(
    event_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*READ))
) -> list[IntegrationPush]:
    rows = await session.execute(
        select(IntegrationPush).order_by(IntegrationPush.created_at.desc()).limit(50)
    )
    return list(rows.scalars().all())
