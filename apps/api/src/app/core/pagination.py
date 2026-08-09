"""The one list-query contract every collection endpoint uses.

`page`, `per_page`, `sort=-field`, `q`, `filter[key]=a,b`. No endpoint invents its
own pagination; the frontend's DataTable is written against this shape once.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import ceil
from typing import Annotated, Any

from fastapi import Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import Select, func, inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

MAX_PER_PAGE = 200


@dataclass(frozen=True, slots=True)
class SortField:
    name: str
    descending: bool


@dataclass(slots=True)
class ListQuery:
    page: int = 1
    per_page: int = 50
    q: str | None = None
    sort: list[SortField] = field(default_factory=list)
    filters: dict[str, list[str]] = field(default_factory=dict)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.per_page


class PageMeta(BaseModel):
    total: int
    page: int
    per_page: int
    pages: int


class Page[T](BaseModel):
    data: list[T]
    meta: PageMeta


def _parse_sort(raw: str | None) -> list[SortField]:
    if not raw:
        return []
    fields = []
    for part in raw.split(","):
        token = part.strip()
        if not token:
            continue
        if token.startswith("-"):
            fields.append(SortField(name=token[1:], descending=True))
        else:
            fields.append(SortField(name=token, descending=False))
    return fields


def _parse_filters(request: Request) -> dict[str, list[str]]:
    """`filter[status]=accepted,waitlisted` becomes {"status": [...]}."""
    filters: dict[str, list[str]] = {}
    for key, value in request.query_params.multi_items():
        if not key.startswith("filter[") or not key.endswith("]"):
            continue
        name = key[len("filter[") : -1]
        if not name:
            continue
        filters.setdefault(name, []).extend(v for v in value.split(",") if v)
    return filters


def list_query(
    request: Request,
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(ge=1, le=MAX_PER_PAGE)] = 50,
    q: Annotated[str | None, Query(max_length=200)] = None,
    sort: Annotated[str | None, Query(max_length=200)] = None,
) -> ListQuery:
    return ListQuery(
        page=page,
        per_page=per_page,
        q=q,
        sort=_parse_sort(sort),
        filters=_parse_filters(request),
    )


ListQueryDep = Annotated[ListQuery, Depends(list_query)]


async def paginate(
    session: AsyncSession, statement: Select[Any], query: ListQuery
) -> tuple[list[Any], PageMeta]:
    """Count and fetch one page. The count strips ordering, which Postgres would
    otherwise sort pointlessly.

    The count is taken over the entity's primary key rather than
    `select(func.count()).select_from(subquery)`. The subquery form hides the
    entity behind an anonymous FROM, so the session's tenancy criteria have
    nothing to attach to and the total is counted across every organization —
    a new workspace could read another one's row count.
    """
    entity = statement.column_descriptions[0]["entity"]
    # The mapped attribute, not the table column: an aggregate over a bare
    # Column carries no mapper, so the session's tenancy criteria have nothing
    # to attach to and the total is counted across every organization.
    primary_key = getattr(entity, inspect(entity).primary_key[0].name)
    count_statement = select(func.count(primary_key))
    if statement.whereclause is not None:
        count_statement = count_statement.where(statement.whereclause)
    total = int(await session.scalar(count_statement) or 0)

    rows = (
        (await session.execute(statement.limit(query.per_page).offset(query.offset)))
        .scalars()
        .all()
    )
    return list(rows), PageMeta(
        total=total,
        page=query.page,
        per_page=query.per_page,
        pages=ceil(total / query.per_page) if query.per_page else 0,
    )
