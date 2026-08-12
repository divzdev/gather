"""The organiser's side of portal resource pages."""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.core.deps import DbSession, bind_tenant, require_role
from app.core.errors import ConflictError, NotFoundError
from app.features.pages import service
from app.models import Page, PageVisibility, Role, User

router = APIRouter(
    prefix="/v1/events/{event_id}/pages",
    tags=["pages"],
    dependencies=[Depends(bind_tenant)],
)

READ = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)
WRITE = (Role.OWNER, Role.ADMIN)


class TextBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["text"]
    text: str = Field(max_length=20_000)


class EmbedBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["embed"]
    html: str = Field(max_length=20_000)


#: Discriminated so a block cannot be half of each, which is what a single
#: model with two optional bodies would allow.
Block = Annotated[TextBlock | EmbedBlock, Field(discriminator="type")]


class PageRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    title: str
    slug: str
    blocks: list[dict[str, Any]]
    visibility: PageVisibility
    is_pinned_in_portal: bool
    sort_order: int


class PageWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=300)
    blocks: list[Block] = Field(default_factory=list, max_length=100)
    visibility: PageVisibility = PageVisibility.DRAFT
    is_pinned_in_portal: bool = False
    sort_order: int = 0


def _stored(blocks: list[Block]) -> list[dict[str, Any]]:
    """Blocks as they go to the database — embeds cleaned, exactly once."""
    return [
        {"type": "embed", "html": service.sanitize_html(block.html)}
        if isinstance(block, EmbedBlock)
        else {"type": "text", "text": block.text}
        for block in blocks
    ]


@router.get("", response_model=list[PageRead])
async def list_pages(session: DbSession, _: User = Depends(require_role(*READ))) -> list[Page]:
    rows = await session.execute(select(Page).order_by(Page.sort_order, Page.title))
    return list(rows.scalars().all())


@router.post("", response_model=PageRead, status_code=status.HTTP_201_CREATED)
async def create_page(
    event_id: uuid.UUID,
    body: PageWrite,
    session: DbSession,
    _: User = Depends(require_role(*WRITE)),
) -> Page:
    slug = service.slugify(body.title)
    if await session.scalar(select(Page).where(Page.slug == slug)) is not None:
        raise ConflictError(f"A page with the slug {slug!r} already exists on this event.")

    page = Page(
        event_id=event_id,
        title=body.title,
        slug=slug,
        blocks=_stored(body.blocks),
        visibility=body.visibility,
        is_pinned_in_portal=body.is_pinned_in_portal,
        sort_order=body.sort_order,
    )
    session.add(page)
    await session.flush()
    return page


@router.patch("/{page_id}", response_model=PageRead)
async def update_page(
    page_id: uuid.UUID,
    body: PageWrite,
    session: DbSession,
    _: User = Depends(require_role(*WRITE)),
) -> Page:
    page = await session.get(Page, page_id)
    if page is None:
        raise NotFoundError("That page does not exist.")

    page.title = body.title
    page.blocks = _stored(body.blocks)
    page.visibility = body.visibility
    page.is_pinned_in_portal = body.is_pinned_in_portal
    page.sort_order = body.sort_order
    return page


@router.delete("/{page_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_page(
    page_id: uuid.UUID,
    session: DbSession,
    _: User = Depends(require_role(*WRITE)),
) -> None:
    page = await session.get(Page, page_id)
    if page is None:
        raise NotFoundError("That page does not exist.")
    await session.delete(page)
