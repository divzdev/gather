"""Embeds an organiser has generated and kept.

A snippet builder with no memory answers "can you produce a snippet" and not
"what have you put on the website" — which is the question an organiser has in
March when a widget on a sponsor's page is showing last year's programme.

The row stores the *settings*, never the snippet text. The script is generated
from the settings on demand, so a saved embed picks up any fix to the generator
instead of preserving whatever it emitted the day it was saved.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.core.deps import DbSession, bind_tenant, require_role
from app.core.errors import ApiError, NotFoundError
from app.features.publishing import embed
from app.models import Event, Role, SavedEmbed, User

router = APIRouter(
    prefix="/v1/events/{event_id}/embeds",
    tags=["embeds"],
    dependencies=[Depends(bind_tenant)],
)

STAFF = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)


class SavedEmbedCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    widget: str
    theme: str = "light"
    track: str | None = Field(default=None, max_length=80)
    limit: int = Field(default=5, ge=1, le=25)


class SavedEmbedRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    name: str
    widget: str
    theme: str
    track: str | None
    limit: int
    #: Regenerated on every read rather than stored, so a saved embed is never a
    #: stale copy of a snippet the generator has since fixed.
    snippet: str = ""


def _with_snippet(row: SavedEmbed, *, origin: str, slug: str) -> SavedEmbedRead:
    return SavedEmbedRead.model_validate(row).model_copy(
        update={
            "snippet": embed.snippet(
                origin=origin,
                slug=slug,
                widget=row.widget,
                theme=row.theme,
                track=row.track,
                limit=row.limit,
            )
        }
    )


async def _event(session: DbSession) -> Event:
    event = await session.scalar(select(Event))
    if event is None:
        raise NotFoundError("No event in scope.")
    return event


@router.get("", response_model=list[SavedEmbedRead])
async def list_embeds(
    session: DbSession, request: Request, _: User = Depends(require_role(*STAFF))
) -> Any:
    event = await _event(session)
    origin = str(request.base_url).rstrip("/")
    rows = (
        (await session.execute(select(SavedEmbed).order_by(SavedEmbed.created_at))).scalars().all()
    )
    return [_with_snippet(row, origin=origin, slug=event.slug) for row in rows]


@router.post("", response_model=SavedEmbedRead, status_code=status.HTTP_201_CREATED)
async def save_embed(
    body: SavedEmbedCreate,
    session: DbSession,
    request: Request,
    _: User = Depends(require_role(*STAFF)),
) -> Any:
    if body.widget not in embed.WIDGETS:
        raise ApiError(
            f"No embed widget called {body.widget!r}.",
            code="VALIDATION_FAILED",
            status_code=422,
            field="widget",
        )
    event = await _event(session)
    row = SavedEmbed(
        name=body.name.strip(),
        widget=body.widget,
        theme=body.theme if body.theme in embed.PALETTES else "light",
        track=body.track,
        limit=body.limit,
    )
    session.add(row)
    await session.flush()
    return _with_snippet(row, origin=str(request.base_url).rstrip("/"), slug=event.slug)


@router.delete("/{embed_id}", status_code=status.HTTP_204_NO_CONTENT)
async def forget_embed(
    embed_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*STAFF))
) -> None:
    """Forgetting the record, not the embed.

    Whatever is already on somebody else's page keeps working — the script reads
    the published snapshot and never consulted this table. Saying so matters:
    the alternative reading is that deleting this breaks a live widget.
    """
    row = await session.get(SavedEmbed, embed_id)
    if row is None:
        raise NotFoundError(f"No saved embed with id {embed_id}.")
    await session.delete(row)
