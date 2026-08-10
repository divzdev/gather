"""A router factory for simple event-scoped resources.

Tracks, rooms, session formats, event days and schedule blocks are the same five
endpoints over different columns. Five hand-written copies would be ~300 lines of
identical code, so this is the second-usage threshold met honestly rather than a
generic CRUD framework: it covers list/create/read/update/delete over one model
and nothing else. A resource that grows real behaviour gets its own router and
stops using this.
"""

import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import DbSession, bind_tenant, require_role
from app.core.errors import ConflictError, NotFoundError
from app.models import Role, User
from app.models.base import Base

WRITE_ROLES = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)
READ_ROLES = (Role.OWNER, Role.ADMIN, Role.COORDINATOR, Role.REVIEWER)

PostCreate = Callable[[AsyncSession, Any], Awaitable[None]]
#: Returns how many rows still point at this one, so a delete can refuse.
InUseCheck = Callable[[AsyncSession, uuid.UUID], Awaitable[int]]


def event_resource_router[ModelT: Base, ReadT: BaseModel](
    *,
    model: type[ModelT],
    read_schema: type[ReadT],
    create_schema: type[BaseModel],
    update_schema: type[BaseModel],
    plural: str,
    tag: str,
    order_by: str = "sort_order",
    on_create: PostCreate | None = None,
    in_use: InUseCheck | None = None,
) -> APIRouter:
    router = APIRouter(
        prefix="/v1/events/{event_id}/" + plural,
        tags=[tag],
        dependencies=[Depends(bind_tenant)],
    )

    async def _get(session: AsyncSession, item_id: uuid.UUID) -> ModelT:
        item = await session.get(model, item_id)
        if item is None:
            raise NotFoundError(f"No {tag[:-1] if tag.endswith('s') else tag} with id {item_id}.")
        return item

    @router.get("", response_model=list[read_schema])  # type: ignore[valid-type]
    async def list_items(
        session: DbSession,
        _: User = Depends(require_role(*READ_ROLES)),
    ) -> Any:
        column = getattr(model, order_by, None) or model.id  # type: ignore[attr-defined]
        rows = (await session.execute(select(model).order_by(column))).scalars().all()
        return list(rows)

    @router.post("", response_model=read_schema, status_code=status.HTTP_201_CREATED)
    async def create_item(
        body: create_schema,  # type: ignore[valid-type]
        session: DbSession,
        _: User = Depends(require_role(*WRITE_ROLES)),
    ) -> Any:
        item = model(**body.model_dump(exclude_unset=True))  # type: ignore[attr-defined]
        session.add(item)
        if on_create is not None:
            await on_create(session, item)
        await session.flush()
        return item

    @router.get("/{item_id}", response_model=read_schema)
    async def read_item(
        item_id: uuid.UUID,
        session: DbSession,
        _: User = Depends(require_role(*READ_ROLES)),
    ) -> Any:
        return await _get(session, item_id)

    @router.patch("/{item_id}", response_model=read_schema)
    async def update_item(
        item_id: uuid.UUID,
        body: update_schema,  # type: ignore[valid-type]
        session: DbSession,
        _: User = Depends(require_role(*WRITE_ROLES)),
    ) -> Any:
        item = await _get(session, item_id)
        for key, value in body.model_dump(exclude_unset=True).items():  # type: ignore[attr-defined]
            setattr(item, key, value)
        await session.flush()
        return item

    @router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_item(
        item_id: uuid.UUID,
        session: DbSession,
        _: User = Depends(require_role(*WRITE_ROLES)),
    ) -> None:
        item = await _get(session, item_id)
        if in_use is not None:
            # The foreign keys are ON DELETE SET NULL, so this would otherwise
            # succeed and quietly strip the track off forty sessions. Refusing
            # with the count is the sensible outcome; unpicking it afterwards is
            # not something an organiser can do.
            used_by = await in_use(session, item_id)
            if used_by > 0:
                raise ConflictError(
                    f"{used_by} session{'s' if used_by != 1 else ''} still use this. "
                    "Move them first, or it would be removed from all of them.",
                    details={"in_use": used_by},
                )
        await session.delete(item)

    return router
