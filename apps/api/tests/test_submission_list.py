"""The submission list contract: page, filter, search, sort.

The console reads this endpoint on its busiest screen and, until now, read it
once with `per_page=200` and did the rest in the browser. Everything below is
what the browser used to do and the database now does — so each case is really
asking "does the server still return what the old client computed?"
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.tenancy import tenancy_disabled
from app.models import (
    Event,
    EventStatus,
    Form,
    FormKind,
    Organization,
    OrgMember,
    Role,
    Speaker,
    Submission,
    SubmissionSpeaker,
    SubmissionStatus,
    Track,
    User,
)

PASSWORD = "correct horse battery staple"
SCHEMA: dict[str, Any] = {"sections": [], "logic": []}

# title, status, review_count, score, on the first track?
ROWS: tuple[tuple[str, SubmissionStatus, int, Decimal | None, bool], ...] = (
    ("Shipping Rust at the edge", SubmissionStatus.SUBMITTED, 0, None, True),
    ("Postgres for the impatient", SubmissionStatus.IN_REVIEW, 2, Decimal("4.5"), True),
    ("A field guide to flaky tests", SubmissionStatus.IN_REVIEW, 0, None, False),
    ("Designing for the last mile", SubmissionStatus.ACCEPTED, 3, Decimal("4.9"), False),
    ("Why your build is slow", SubmissionStatus.REJECTED, 1, Decimal("2.1"), False),
)


@dataclass
class World:
    headers: dict[str, str]
    event_id: uuid.UUID
    track_id: uuid.UUID


@pytest.fixture
async def world(client: AsyncClient, session: AsyncSession) -> World:
    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        org = Organization(name=f"Org {suffix}", slug=f"org-{suffix}")
        session.add(org)
        await session.flush()
        event = Event(
            org_id=org.id,
            name="DevFlow Conf 2027",
            slug=f"devflow-{suffix}",
            timezone="UTC",
            starts_on=datetime(2027, 5, 12).date(),
            ends_on=datetime(2027, 5, 14).date(),
            status=EventStatus.IN_REVIEW,
            cfp_closes_at=datetime.now(UTC) + timedelta(days=1),
        )
        session.add(event)
        await session.flush()
        form = Form(org_id=org.id, event_id=event.id, name="CFP", kind=FormKind.CFP, schema=SCHEMA)
        track = Track(org_id=org.id, event_id=event.id, name=f"Platform {suffix}", hue_index=1)
        other = Track(org_id=org.id, event_id=event.id, name=f"Practice {suffix}", hue_index=2)
        user = User(
            email=f"owner-{suffix}@example.com",
            name="Owner",
            password_hash=hash_password(PASSWORD),
        )
        session.add_all([form, track, other, user])
        await session.flush()
        session.add(OrgMember(org_id=org.id, user_id=user.id, role=Role.OWNER))

        speaker = Speaker(org_id=org.id, email=f"spk-{suffix}@example.com", name="Priya Raman")
        session.add(speaker)
        await session.flush()

        for index, (title, status, reviews, score, on_track) in enumerate(ROWS):
            submission = Submission(
                org_id=org.id,
                event_id=event.id,
                form_id=form.id,
                code=f"L{index:05d}",
                title=title,
                answers={},
                status=status,
                review_count=reviews,
                score_avg=score,
                track_id=track.id if on_track else other.id,
                # Ascending by index, so "oldest first" is ROWS order.
                submitted_at=datetime(2027, 1, 1, tzinfo=UTC) + timedelta(days=index),
            )
            session.add(submission)
            await session.flush()
            session.add(
                SubmissionSpeaker(
                    org_id=org.id,
                    event_id=event.id,
                    submission_id=submission.id,
                    speaker_id=speaker.id,
                    is_primary=True,
                )
            )
        await session.commit()

    login = await client.post("/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    return World(
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
        event_id=event.id,
        track_id=track.id,
    )


async def _list(client: AsyncClient, world: World, query: str = "") -> dict[str, Any]:
    response = await client.get(
        f"/v1/events/{world.event_id}/submissions?{query}", headers=world.headers
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_a_page_reports_the_whole_total_not_the_page_size(
    client: AsyncClient, world: World
) -> None:
    body = await _list(client, world, "per_page=2&page=1")

    assert len(body["data"]) == 2
    # The bug this endpoint's client had for months: reading len(data) as the
    # total, so a 608-submission event said "200 submissions".
    assert body["meta"] == {"total": 5, "page": 1, "per_page": 2, "pages": 3}


async def test_the_last_page_holds_the_remainder_and_nothing_repeats(
    client: AsyncClient, world: World
) -> None:
    seen = [
        row["code"]
        for page in (1, 2, 3)
        for row in (await _list(client, world, f"per_page=2&page={page}&sort=submitted_at"))["data"]
    ]

    assert len(seen) == len(set(seen)) == 5


async def test_a_page_past_the_end_is_empty_rather_than_an_error(
    client: AsyncClient, world: World
) -> None:
    body = await _list(client, world, "per_page=2&page=99")

    assert body["data"] == []
    assert body["meta"]["total"] == 5


async def test_statuses_filter_as_a_set(client: AsyncClient, world: World) -> None:
    body = await _list(client, world, "filter[status]=accepted,rejected")

    assert {row["status"] for row in body["data"]} == {"accepted", "rejected"}
    assert body["meta"]["total"] == 2


async def test_reviewed_separates_ready_to_decide_from_awaiting_reviews(
    client: AsyncClient, world: World
) -> None:
    """The console's one view that is not a status: in review *and* scored."""
    ready = await _list(client, world, "filter[status]=in_review&filter[reviewed]=true")
    waiting = await _list(client, world, "filter[status]=in_review&filter[reviewed]=false")

    assert [row["title"] for row in ready["data"]] == ["Postgres for the impatient"]
    assert [row["title"] for row in waiting["data"]] == ["A field guide to flaky tests"]
    # Two halves of the same set, with nothing lost between them.
    assert ready["meta"]["total"] + waiting["meta"]["total"] == 2


async def test_a_track_filter_narrows_to_that_track(client: AsyncClient, world: World) -> None:
    body = await _list(client, world, f"filter[track_id]={world.track_id}")

    assert body["meta"]["total"] == 2
    assert {row["track_id"] for row in body["data"]} == {str(world.track_id)}


async def test_search_matches_title_code_and_speaker_name(
    client: AsyncClient, world: World
) -> None:
    by_title = await _list(client, world, "q=flaky")
    by_code = await _list(client, world, "q=L00003")
    by_speaker = await _list(client, world, "q=priya")

    assert [row["title"] for row in by_title["data"]] == ["A field guide to flaky tests"]
    assert [row["title"] for row in by_code["data"]] == ["Designing for the last mile"]
    # Matching only the title would have been the quiet cost of moving this
    # list to the server — the browser searched all three.
    assert by_speaker["meta"]["total"] == 5


async def test_search_and_status_narrow_together_rather_than_either_winning(
    client: AsyncClient, world: World
) -> None:
    body = await _list(client, world, "q=the&filter[status]=accepted")

    assert [row["title"] for row in body["data"]] == ["Designing for the last mile"]


async def test_best_score_first_does_not_open_with_the_unscored(
    client: AsyncClient, world: World
) -> None:
    body = await _list(client, world, "sort=-score_avg")

    scores = [row["score_avg"] for row in body["data"]]
    # Postgres sorts nulls first on a descending sort, which put every
    # unreviewed proposal above the highest-scoring talk in the event. An
    # absent score is not a high one.
    assert scores[:3] == ["4.90", "4.50", "2.10"]
    assert scores[3:] == [None, None]


async def test_sorting_reverses(client: AsyncClient, world: World) -> None:
    ascending = await _list(client, world, "sort=title")
    descending = await _list(client, world, "sort=-title")

    titles = [row["title"] for row in ascending["data"]]
    assert titles == sorted(titles)
    assert [row["title"] for row in descending["data"]] == list(reversed(titles))


async def test_per_page_above_the_ceiling_is_refused(client: AsyncClient, world: World) -> None:
    response = await client.get(
        f"/v1/events/{world.event_id}/submissions?per_page=500", headers=world.headers
    )

    # The console offers 25/50/100/200 for exactly this reason.
    assert response.status_code == 422
