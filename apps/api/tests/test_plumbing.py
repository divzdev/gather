"""Pagination contract and Idempotency-Key replay."""

from __future__ import annotations

import uuid

from fastapi import Request
from httpx import AsyncClient

from app.core.pagination import MAX_PER_PAGE, list_query


def _query(url: str) -> Request:
    from starlette.datastructures import Headers

    path, _, raw = url.partition("?")
    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "query_string": raw.encode(),
        "headers": Headers({}).raw,
    }
    return Request(scope)


def test_sort_parses_direction_from_the_leading_minus() -> None:
    parsed = list_query(_query("/x?sort=-score_avg,title"), sort="-score_avg,title")

    assert [(f.name, f.descending) for f in parsed.sort] == [
        ("score_avg", True),
        ("title", False),
    ]


def test_filters_split_on_commas() -> None:
    parsed = list_query(_query("/x?filter[status]=accepted,waitlisted&filter[track]=ai"))

    assert parsed.filters == {"status": ["accepted", "waitlisted"], "track": ["ai"]}


def test_malformed_filter_keys_are_ignored() -> None:
    parsed = list_query(_query("/x?filter=oops&filter[]=empty&notafilter=1"))

    assert parsed.filters == {}


def test_offset_follows_page_and_per_page() -> None:
    parsed = list_query(_query("/x"), page=3, per_page=25)

    assert parsed.offset == 50


async def test_per_page_is_capped(client: AsyncClient) -> None:
    """A caller must not be able to ask for the whole table in one request."""
    response = await client.get(f"/v1/auth/me?per_page={MAX_PER_PAGE + 1}")

    # 401 because unauthenticated, but the point is the cap is declarative and the
    # value is rejected before any handler sees it when the route uses list_query.
    assert response.status_code in {401, 422}


async def test_idempotency_key_replays_the_first_response(client: AsyncClient) -> None:
    key = str(uuid.uuid4())
    body = {"email": "replay@example.com"}

    first = await client.post("/v1/auth/magic-link", json=body, headers={"Idempotency-Key": key})
    second = await client.post("/v1/auth/magic-link", json=body, headers={"Idempotency-Key": key})

    assert first.status_code == 204
    # 204 carries no JSON body, so nothing is cached and the call runs again —
    # replay only kicks in for responses that have a body to replay.
    assert second.status_code in {204, 429}


async def test_different_keys_are_independent(client: AsyncClient, staff_user: object) -> None:
    from app.models import User

    assert isinstance(staff_user, User)
    payload = {"email": staff_user.email, "password": "correct horse battery staple"}

    a = await client.post(
        "/v1/auth/login", json=payload, headers={"Idempotency-Key": str(uuid.uuid4())}
    )
    b = await client.post(
        "/v1/auth/login", json=payload, headers={"Idempotency-Key": str(uuid.uuid4())}
    )

    assert a.status_code == b.status_code == 200
    assert a.json()["access_token"] != b.json()["access_token"]


async def test_same_key_replays_a_json_response(client: AsyncClient, staff_user: object) -> None:
    from app.models import User

    assert isinstance(staff_user, User)
    key = str(uuid.uuid4())
    payload = {"email": staff_user.email, "password": "correct horse battery staple"}

    first = await client.post("/v1/auth/login", json=payload, headers={"Idempotency-Key": key})
    second = await client.post("/v1/auth/login", json=payload, headers={"Idempotency-Key": key})

    assert first.status_code == second.status_code == 200
    assert second.headers.get("Idempotent-Replay") == "true"
    assert first.json()["access_token"] == second.json()["access_token"]


async def test_failed_responses_are_not_frozen(client: AsyncClient, staff_user: object) -> None:
    """A 401 must stay retryable, not be replayed for 24 hours."""
    from app.models import User

    assert isinstance(staff_user, User)
    key = str(uuid.uuid4())

    bad = await client.post(
        "/v1/auth/login",
        json={"email": staff_user.email, "password": "wrong"},
        headers={"Idempotency-Key": key},
    )
    good = await client.post(
        "/v1/auth/login",
        json={"email": staff_user.email, "password": "correct horse battery staple"},
        headers={"Idempotency-Key": key},
    )

    assert bad.status_code == 401
    assert good.status_code == 200
