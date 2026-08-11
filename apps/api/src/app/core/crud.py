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
#: Applied after the fields are set and before the flush, for a resource whose
#: edit has consequences beyond its own row.
PostUpdate = Callable[[AsyncSession, Any, dict[str, Any]], Awaitable[None]]
#: Why this row cannot be deleted, or None if it can. A sentence rather than a
#: count, because "3 sessions are scheduled on this day" and "2 sessions are in
#: this room" are different facts and the factory cannot know which it is holding.
InUseCheck = Callable[[AsyncSession, uuid.UUID], Awaitable[str | None]]
#: How many sessions point at each row of this resource, in one query. Feeds the
#: count a screen shows next to a row, so removing something says what it costs
#: before it is clicked rather than only after the server refuses.
UsageCounts = Callable[[AsyncSession], Awaitable[dict[uuid.UUID, int]]]


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
    on_update: PostUpdate | None = None,
    in_use: InUseCheck | None = None,
    usage: UsageCounts | None = None,
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

    async def _with_counts(session: AsyncSession, rows: list[ModelT]) -> list[ReadT]:
        """One aggregate for the whole page, not one per row."""
        counts = {} if usage is None else await usage(session)
        return [
            read_schema.model_validate(row).model_copy(
                update={"session_count": counts.get(row.id, 0)}  # type: ignore[attr-defined]
            )
            for row in rows
        ]

    @router.get("", response_model=list[read_schema])  # type: ignore[valid-type]
    async def list_items(
        session: DbSession,
        _: User = Depends(require_role(*READ_ROLES)),
    ) -> Any:
        column = getattr(model, order_by, None) or model.id  # type: ignore[attr-defined]
        rows = (await session.execute(select(model).order_by(column))).scalars().all()
        return await _with_counts(session, list(rows))

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
        return (await _with_counts(session, [item]))[0]

    @router.get("/{item_id}", response_model=read_schema)
    async def read_item(
        item_id: uuid.UUID,
        session: DbSession,
        _: User = Depends(require_role(*READ_ROLES)),
    ) -> Any:
        return (await _with_counts(session, [await _get(session, item_id)]))[0]

    @router.patch("/{item_id}", response_model=read_schema)
    async def update_item(
        item_id: uuid.UUID,
        body: update_schema,  # type: ignore[valid-type]
        session: DbSession,
        _: User = Depends(require_role(*WRITE_ROLES)),
    ) -> Any:
        item = await _get(session, item_id)
        changes: dict[str, Any] = body.model_dump(exclude_unset=True)  # type: ignore[attr-defined]
        # What the row held before, so a hook can see what actually moved.
        before = {key: getattr(item, key) for key in changes}
        for key, value in changes.items():
            setattr(item, key, value)
        if on_update is not None:
            await on_update(session, item, before)
        await session.flush()
        # Counted after the flush, so an edit that moved other rows reports what
        # it actually touched rather than the zero a bare row would carry.
        return (await _with_counts(session, [item]))[0]

    @router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_item(
        item_id: uuid.UUID,
        session: DbSession,
        _: User = Depends(require_role(*WRITE_ROLES)),
    ) -> None:
        item = await _get(session, item_id)
        if in_use is not None:
            # The foreign keys are ON DELETE SET NULL or CASCADE, so this would
            # otherwise succeed and quietly strip the track off forty sessions,
            # or take the day's lunch break with it. Refusing is the sensible
            # outcome; unpicking it afterwards is not something an organiser can
            # do.
            blocked = await in_use(session, item_id)
            if blocked is not None:
                raise ConflictError(blocked, details={"blocked": True})
        await session.delete(item)

    return router
