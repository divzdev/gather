"""What the reviewers said, read back by the organiser.

The scorecard tells a reviewer their comment is "visible to organizers, never to
the speaker". It was visible to nobody: the numbers reached the console as one
averaged `score_avg` and the words reached no surface at all. These tests pin the
route that closes that, and pin who is refused it — a reviewer reading another
reviewer's scoring before writing their own is what round-based review exists to
prevent, so the read is organiser-only by design rather than by omission.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from test_review import World, _criterion, _round, _score, world  # noqa: F401


async def _assign(client: AsyncClient, world: World, round_id: uuid.UUID, *reviewers: uuid.UUID):
    await client.post(
        f"/v1/events/{world.event.id}/review-rounds/{round_id}/assignments",
        json={
            "submission_ids": [str(world.submissions[0])],
            "user_ids": [str(r) for r in reviewers],
        },
        headers=world.headers,
    )


async def _reviews(client: AsyncClient, world: World, headers: dict[str, str]):
    return await client.get(
        f"/v1/events/{world.event.id}/submissions/{world.submissions[0]}/reviews",
        headers=headers,
    )


async def test_organiser_reads_the_reviewer_name_score_and_comment(
    client: AsyncClient, world: World
) -> None:
    round_id = await _round(client, world)
    relevance = await _criterion(client, world, round_id, label="Relevance")
    await _assign(client, world, round_id, world.reviewer_id)
    await client.put(
        f"/v1/events/{world.event.id}/review/submissions/{world.submissions[0]}/scores"
        f"?round_id={round_id}",
        json={
            "values": {str(relevance): 4},
            "conflict_of_interest": False,
            "comment": "Strong on the CI numbers, thin on the migration story.",
        },
        headers=world.reviewer_headers,
    )

    response = await _reviews(client, world, world.headers)

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["reviewer_name"] == "rev1"
    assert body[0]["score_avg"] == 4.0
    assert body[0]["comment"] == "Strong on the CI numbers, thin on the migration story."
    assert body[0]["round_name"] == "Round 1"


async def test_a_reviewer_cannot_read_the_reviews_on_a_submission(
    client: AsyncClient, world: World
) -> None:
    """The whole point of the round. A reviewer who can read this before scoring
    is anchored by whatever the first reviewer wrote."""
    round_id = await _round(client, world)
    await _criterion(client, world, round_id, label="Relevance")
    await _assign(client, world, round_id, world.reviewer_id, world.reviewer2_id)

    response = await _reviews(client, world, world.reviewer_headers)

    assert response.status_code == 403


async def test_each_reviewers_score_is_its_own_mean_not_the_submission_average(
    client: AsyncClient, world: World
) -> None:
    """`score_avg` on the submission is the mean across reviewers. This route has
    to disagree with it per row, or the organiser cannot see that two people
    scored the same talk 5 and 1."""
    round_id = await _round(client, world)
    relevance = await _criterion(client, world, round_id, label="Relevance")
    await _assign(client, world, round_id, world.reviewer_id, world.reviewer2_id)
    await _score(client, world, round_id, world.submissions[0], {relevance: 5})
    await _score(
        client,
        world,
        round_id,
        world.submissions[0],
        {relevance: 1},
        headers=world.reviewer2_headers,
    )

    body = (await _reviews(client, world, world.headers)).json()

    assert sorted(row["score_avg"] for row in body) == [1.0, 5.0]


async def test_a_free_text_criterion_does_not_drag_the_per_review_mean(
    client: AsyncClient, world: World
) -> None:
    """A `text` criterion carries no number. Counting it as a zero would put a
    5-out-of-5 review on screen as 2.5."""
    round_id = await _round(client, world)
    relevance = await _criterion(client, world, round_id, label="Relevance")
    notes = await _criterion(client, world, round_id, label="Notes", kind="text", is_required=False)
    await _assign(client, world, round_id, world.reviewer_id)
    await _score(
        client, world, round_id, world.submissions[0], {relevance: 5, notes: "Nicely argued"}
    )

    body = (await _reviews(client, world, world.headers)).json()

    assert body[0]["score_avg"] == 5.0


async def test_a_weighted_scorecard_is_weighted_here_too(client: AsyncClient, world: World) -> None:
    round_id = await _round(client, world)
    heavy = await _criterion(client, world, round_id, label="Relevance", weight="3.00")
    light = await _criterion(client, world, round_id, label="Novelty", weight="1.00")
    await _assign(client, world, round_id, world.reviewer_id)
    await _score(client, world, round_id, world.submissions[0], {heavy: 5, light: 1})

    body = (await _reviews(client, world, world.headers)).json()

    # (5*3 + 1*1) / 4 = 4.0 — the unweighted answer would be 3.0.
    assert body[0]["score_avg"] == 4.0


async def test_a_review_typed_by_a_human_is_not_marked_as_a_suggestion(
    client: AsyncClient, world: World
) -> None:
    round_id = await _round(client, world)
    relevance = await _criterion(client, world, round_id, label="Relevance")
    await _assign(client, world, round_id, world.reviewer_id)
    await _score(client, world, round_id, world.submissions[0], {relevance: 4})

    body = (await _reviews(client, world, world.headers)).json()

    assert body[0]["from_ai_suggestion"] is False


async def test_a_submission_nobody_has_reviewed_returns_an_empty_list(
    client: AsyncClient, world: World
) -> None:
    response = await _reviews(client, world, world.headers)

    assert response.status_code == 200
    assert response.json() == []
