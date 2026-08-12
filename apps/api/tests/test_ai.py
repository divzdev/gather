"""AI-assisted review: what the model is shown, and what it is allowed to change.

Two properties carry the whole feature, and both are invisible in a screenshot:

1. **A blind round stays blind.** Identity is stripped before the payload leaves
   the process, exactly as it is for a human reviewer. A leak here defeats the
   round without failing anything.
2. **The model never writes.** Its output is a proposal. Accepting one produces a
   `reviews` row owned by the human who accepted it, through the same service
   method the scorecard uses.

The tests below assert the mechanism and the isolation. None of them assert that
the scores are *good* — they are suggestions a person adopts, and grading a model's
judgement in CI would be theatre.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password
from app.core.tenancy import tenancy_disabled, tenant_scope
from app.features.ai import proposals, service
from app.features.ai.adapters.base import Completion
from app.features.ai.schemas import ScoreAnswer
from app.models import (
    AiProposal,
    AiProposalStatus,
    Event,
    EventStatus,
    Form,
    FormKind,
    Organization,
    OrgMember,
    Review,
    ReviewStatus,
    Role,
    Speaker,
    Submission,
    SubmissionSpeaker,
    SubmissionStatus,
    User,
)

PASSWORD = "correct horse battery staple"

#: `speaker_bio` is identity-bearing; the blind tests below turn on it being
#: stripped, and on the abstract surviving.
FORM_SCHEMA = {
    "sections": [
        {
            "key": "s",
            "title": "Proposal",
            "fields": [
                {"key": "abstract", "type": "long_text", "label": "Abstract"},
                {
                    "key": "speaker_bio",
                    "type": "long_text",
                    "label": "Bio",
                    "identity_bearing": True,
                },
            ],
        }
    ],
    "logic": [],
}


@dataclass
class World:
    headers: dict[str, str]
    event: Event
    reviewer_id: uuid.UUID
    submissions: list[uuid.UUID]


@pytest.fixture
async def world(client: AsyncClient, session: AsyncSession) -> AsyncIterator[World]:
    """An event in review with two submissions and one reviewer.

    Yields *inside* `tenant_scope`, because most tests here call the AI service
    directly rather than over HTTP. A real request gets its tenant from the
    `bind_tenant` dependency; without the equivalent, every query against a
    tenant-scoped table raises — which is the tenancy guard working, not a
    problem to route around.
    """
    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        org = Organization(name=f"Org {suffix}", slug=f"org-{suffix}")
        session.add(org)
        await session.flush()
        event = Event(
            org_id=org.id,
            name="DevFlow Conf 2027",
            slug=f"devflow-ai-{suffix}",
            timezone="UTC",
            starts_on=datetime(2027, 5, 12).date(),
            ends_on=datetime(2027, 5, 14).date(),
            status=EventStatus.IN_REVIEW,
            cfp_closes_at=datetime.now(UTC) + timedelta(days=1),
        )
        session.add(event)
        await session.flush()
        form = Form(
            org_id=org.id, event_id=event.id, name="CFP", kind=FormKind.CFP, schema=FORM_SCHEMA
        )
        session.add(form)

        owner = User(
            email=f"owner-{suffix}@example.com",
            name="Ada Owner",
            password_hash=hash_password(PASSWORD),
            email_verified_at=datetime.now(UTC),
        )
        session.add(owner)
        await session.flush()
        session.add(OrgMember(org_id=org.id, user_id=owner.id, role=Role.OWNER))

        speaker = Speaker(org_id=org.id, email=f"spk-{suffix}@example.com", name="Priya Raman")
        session.add(speaker)
        await session.flush()

        ids = []
        for index in range(2):
            submission = Submission(
                org_id=org.id,
                event_id=event.id,
                form_id=form.id,
                code=f"AI{index:04d}"[:6],
                title=f"Proposal {index}",
                answers={"abstract": "About builds.", "speaker_bio": "Priya works at Latticework."},
                status=SubmissionStatus.SUBMITTED,
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
            ids.append(submission.id)
        await session.commit()

    login = await client.post("/v1/auth/login", json={"email": owner.email, "password": PASSWORD})
    built = World(
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
        event=event,
        reviewer_id=owner.id,
        submissions=ids,
    )
    with tenant_scope(org_id=event.org_id, event_id=event.id):
        yield built


async def _round(client: AsyncClient, world: World, *, blind: bool = False) -> uuid.UUID:
    created = await client.post(
        f"/v1/events/{world.event.id}/review-rounds",
        json={"name": "Round 1", "is_blind": blind},
        headers=world.headers,
    )
    round_id = created.json()["id"]
    await client.patch(
        f"/v1/events/{world.event.id}/review-rounds/{round_id}",
        json={"status": "open"},
        headers=world.headers,
    )
    return uuid.UUID(round_id)


@pytest.fixture
def no_model_configured() -> Iterator[None]:
    """Explicitly unconfigured, rather than assuming it.

    Whoever runs this very likely has a real `ANTHROPIC_API_KEY` in their `.env`
    — and without this the "zero credentials" test quietly called a live model
    and billed them for the privilege of proving nothing. Same trap as
    `github_absent` in test_auth_methods.py, same fix.

    `OLLAMA_BASE_URL` has to be cleared for the same reason and caught the same
    way: the moment a local server was configured this test started passing
    through it instead of the stub. Every source the gateway can pick has to be
    named here — the assertion is "nothing is configured", so a new adapter that
    forgets to appear in this list makes the test silently stop testing.
    """
    settings = get_settings()
    before = (settings.anthropic_api_key, settings.ollama_base_url)
    settings.anthropic_api_key = ""
    settings.ollama_base_url = ""
    yield None
    settings.anthropic_api_key, settings.ollama_base_url = before


async def _criterion(
    client: AsyncClient, world: World, round_id: uuid.UUID, *, label: str
) -> uuid.UUID:
    response = await client.post(
        f"/v1/events/{world.event.id}/review-rounds/{round_id}/criteria",
        json={"label": label, "kind": "rating", "weight": "1.00"},
        headers=world.headers,
    )
    return uuid.UUID(response.json()["id"])


class Recorder:
    """An adapter that answers however a test wants, and remembers what it was asked.

    The point is `self.seen`: several tests below are about what we *sent*, which
    no amount of inspecting the reply can tell you.
    """

    name = "recorder"

    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.seen: list[dict[str, str]] = []

    async def complete(self, *, system: str, user: str, max_tokens: int) -> Completion:
        self.seen.append({"system": system, "user": user})
        return Completion(text=self.reply, model="recorder-1", usage={"input_tokens": 11})

    async def stream(self, *, system: str, user: str, max_tokens: int) -> AsyncIterator[str]:
        self.seen.append({"system": system, "user": user})
        yield self.reply


def _answer(criterion_id: uuid.UUID, value: int = 4) -> str:
    return json.dumps(
        {
            "scores": [
                {"criterion_id": str(criterion_id), "value": value, "reason": "Concrete outline."}
            ],
            "summary": "Solid, if narrow.",
        }
    )


async def _assign(client: AsyncClient, world: World, round_id: uuid.UUID, index: int = 0) -> None:
    await client.post(
        f"/v1/events/{world.event.id}/review-rounds/{round_id}/assignments",
        json={
            "submission_ids": [str(world.submissions[index])],
            "user_ids": [str(world.reviewer_id)],
        },
        headers=world.headers,
    )


# ─────────────────────────── the blind round ───────────────────────────


async def test_a_blind_round_never_sends_identity_to_the_model(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """The bio is `identity_bearing`, so it must not appear in the outbound payload.

    `Priya works at Latticework` is in every seeded submission's answers. If the
    blind path regresses, that string reaches a third party.
    """
    round_id = await _round(client, world, blind=True)
    criterion_id = await _criterion(client, world, round_id, label="Relevance")
    recorder = Recorder(_answer(criterion_id))

    await service.score_submission(
        session,
        event_id=world.event.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
        adapter=recorder,
    )

    sent = recorder.seen[0]["user"]
    assert "Latticework" not in sent
    assert "Priya" not in sent
    assert "speaker_bio" not in sent
    # The abstract is not identity-bearing and must survive, or we have proved
    # only that we sent nothing useful.
    assert "About builds." in sent


async def test_an_open_round_does_send_identity(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """The mirror of the test above: a non-blind round is supposed to include it."""
    round_id = await _round(client, world, blind=False)
    criterion_id = await _criterion(client, world, round_id, label="Relevance")
    recorder = Recorder(_answer(criterion_id))

    await service.score_submission(
        session,
        event_id=world.event.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
        adapter=recorder,
    )

    assert "Latticework" in recorder.seen[0]["user"]


# ─────────────────────────── the proposal never writes ───────────────────────────


async def test_a_suggestion_creates_no_review(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    round_id = await _round(client, world)
    criterion_id = await _criterion(client, world, round_id, label="Relevance")

    proposal = await service.score_submission(
        session,
        event_id=world.event.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
        adapter=Recorder(_answer(criterion_id)),
    )

    assert proposal.status is AiProposalStatus.READY
    reviews = (await session.execute(select(Review))).scalars().all()
    assert reviews == []


async def test_accepting_makes_the_review_the_accepting_humans(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """`reviews.user_id` is NOT NULL — the AI cannot own a score, by schema."""
    round_id = await _round(client, world)
    criterion_id = await _criterion(client, world, round_id, label="Relevance")
    await _assign(client, world, round_id)

    proposal = await service.score_submission(
        session,
        event_id=world.event.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
        adapter=Recorder(_answer(criterion_id)),
    )
    review = await service.accept_scores(
        session,
        proposal_id=proposal.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
        values=None,
        comment="Adopted after reading.",
    )

    assert review.user_id == world.reviewer_id
    assert review.status is ReviewStatus.SCORED
    assert proposal.status is AiProposalStatus.ACCEPTED


async def test_a_reviewer_can_edit_before_accepting(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """The edited value wins, not the suggestion. Otherwise the review is not theirs."""
    round_id = await _round(client, world)
    criterion_id = await _criterion(client, world, round_id, label="Relevance")
    await _assign(client, world, round_id)

    proposal = await service.score_submission(
        session,
        event_id=world.event.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
        adapter=Recorder(_answer(criterion_id, value=4)),
    )
    await service.accept_scores(
        session,
        proposal_id=proposal.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
        values={criterion_id: 2},
        comment=None,
    )

    from app.models import ReviewScore

    scored = (await session.execute(select(Review))).scalars().all()
    assert len(scored) == 1
    values = (await session.execute(select(ReviewScore.value))).scalars().all()
    assert [float(value) for value in values if value is not None] == [2.0]


async def test_accepting_without_an_assignment_is_refused(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """Acceptance goes through `review.score()`, so its guards still apply."""
    round_id = await _round(client, world)
    criterion_id = await _criterion(client, world, round_id, label="Relevance")

    proposal = await service.score_submission(
        session,
        event_id=world.event.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
        adapter=Recorder(_answer(criterion_id)),
    )

    with pytest.raises(Exception) as caught:
        await service.accept_scores(
            session,
            proposal_id=proposal.id,
            round_id=round_id,
            submission_id=world.submissions[0],
            user_id=world.reviewer_id,
            values=None,
            comment=None,
        )
    assert "assign" in str(caught.value).lower() or "not" in str(caught.value).lower()


# ─────────────────────────── a model is allowed to be wrong ──────────────────


@pytest.mark.parametrize(
    "reply",
    [
        pytest.param("I'd rather not.", id="prose instead of json"),
        pytest.param("", id="empty"),
        pytest.param("[1, 2, 3]", id="json but not an object"),
        pytest.param('{"scores": "all of them"}', id="right key, wrong type"),
    ],
)
async def test_a_bad_answer_fails_the_proposal_rather_than_the_request(
    client: AsyncClient, session: AsyncSession, world: World, reply: str
) -> None:
    round_id = await _round(client, world)
    await _criterion(client, world, round_id, label="Relevance")

    proposal = await service.score_submission(
        session,
        event_id=world.event.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
        adapter=Recorder(reply),
    )

    assert proposal.status is AiProposalStatus.FAILED
    assert proposal.output["error"]


async def test_a_fenced_answer_is_still_read(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """Models wrap JSON in ``` often enough that refusing it would be a self-own."""
    round_id = await _round(client, world)
    criterion_id = await _criterion(client, world, round_id, label="Relevance")
    fenced = f"Here you go:\n```json\n{_answer(criterion_id)}\n```"

    proposal = await service.score_submission(
        session,
        event_id=world.event.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
        adapter=Recorder(fenced),
    )

    assert proposal.status is AiProposalStatus.READY
    assert proposal.output["scores"][0]["value"] == 4


async def test_scores_outside_the_scale_are_dropped(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    """11 on a 1-5 scale is not clamped to 5 — a human never chose 5."""
    round_id = await _round(client, world)
    criterion_id = await _criterion(client, world, round_id, label="Relevance")

    proposal = await service.score_submission(
        session,
        event_id=world.event.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
        adapter=Recorder(_answer(criterion_id, value=11)),
    )

    assert proposal.output["scores"] == []


async def test_an_invented_criterion_is_dropped(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    round_id = await _round(client, world)
    await _criterion(client, world, round_id, label="Relevance")

    proposal = await service.score_submission(
        session,
        event_id=world.event.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
        adapter=Recorder(_answer(uuid.uuid4())),
    )

    assert proposal.output["scores"] == []


# ─────────────────────────── zero credentials ───────────────────────────


async def test_with_no_api_key_the_stub_answers_and_says_so(
    client: AsyncClient, session: AsyncSession, world: World, no_model_configured: None
) -> None:
    """`make setup && make dev` with no credentials is graded. This is that path.

    The stub has to produce a usable proposal — the whole pipeline runs — while
    being unmistakably labelled, so nobody reads deterministic filler as
    judgement.
    """
    round_id = await _round(client, world)
    await _criterion(client, world, round_id, label="Relevance")

    proposal = await service.score_submission(
        session,
        event_id=world.event.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
    )

    assert proposal.status is AiProposalStatus.READY
    assert proposal.model is not None and proposal.model.startswith("stub:")
    assert proposal.output["is_stub"] is True
    assert "no model is configured" in proposal.output["summary"]


async def test_the_stub_is_deterministic(session: AsyncSession) -> None:
    from app.features.ai.adapters.stub import StubAdapter

    payload = json.dumps({"criteria": [{"id": str(uuid.uuid4()), "scale_min": 1, "scale_max": 5}]})
    adapter = StubAdapter(model="whatever")
    first = await adapter.complete(system="s", user=payload, max_tokens=10)
    second = await adapter.complete(system="s", user=payload, max_tokens=10)

    assert first.text == second.text


# ─────────────────────────── spend guards ───────────────────────────


async def test_the_daily_cap_refuses_rather_than_spending(
    client: AsyncClient, session: AsyncSession, world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A public box with a real key needs a ceiling that is not per-user.

    The rate limit stops one person hammering the button; twenty people each
    clicking politely would sail past it.
    """
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "ai_daily_proposal_cap", 1, raising=False)

    round_id = await _round(client, world)
    criterion_id = await _criterion(client, world, round_id, label="Relevance")
    recorder = Recorder(_answer(criterion_id))

    await service.score_submission(
        session,
        event_id=world.event.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
        adapter=recorder,
    )
    await session.commit()

    with pytest.raises(Exception) as caught:
        await service.score_submission(
            session,
            event_id=world.event.id,
            round_id=round_id,
            submission_id=world.submissions[1],
            user_id=world.reviewer_id,
            adapter=recorder,
        )

    assert "AI_DAILY_CAP_REACHED" in str(getattr(caught.value, "code", "")) or "today" in str(
        caught.value
    )
    # And it refused *before* calling the model, which is the entire point.
    assert len(recorder.seen) == 1


# ─────────────────────────── tenancy ───────────────────────────


async def test_a_proposal_is_scoped_to_its_event(
    client: AsyncClient, session: AsyncSession, world: World
) -> None:
    round_id = await _round(client, world)
    criterion_id = await _criterion(client, world, round_id, label="Relevance")

    proposal = await service.score_submission(
        session,
        event_id=world.event.id,
        round_id=round_id,
        submission_id=world.submissions[0],
        user_id=world.reviewer_id,
        adapter=Recorder(_answer(criterion_id)),
    )
    await session.commit()

    with tenancy_disabled():
        stored = await session.get(AiProposal, proposal.id)
    assert stored is not None
    assert stored.event_id == world.event.id
    assert stored.org_id == world.event.org_id


# ─────────────────────────── parsing, in isolation ───────────────────────────


def test_parse_reports_where_the_answer_went_wrong() -> None:
    """The reason lands on a proposal row and then on a screen, so it has to read."""
    from app.core.errors import ApiError

    with pytest.raises(ApiError) as caught:
        proposals.parse('{"scores": [{"criterion_id": "not-a-uuid", "value": 3}]}', ScoreAnswer)

    assert "scores.0.criterion_id" in caught.value.message


# ─────────────────────────── duplicate detection ───────────────────────────
#
# The shortlist is the interesting half. 214 submissions is 22,791 pairs, so what
# stops this being absurd is that Postgres picks the candidates and the model only
# adjudicates the handful that survive.


def _dupe_answer(left: uuid.UUID, right: uuid.UUID, *, is_duplicate: bool = True) -> str:
    return json.dumps(
        {
            "pairs": [
                {
                    "left_id": str(left),
                    "right_id": str(right),
                    "is_duplicate": is_duplicate,
                    "confidence": "high",
                    "reason": "Identical outline, same closing case study.",
                }
            ],
            "summary": "One real duplicate.",
        }
    )


async def test_dissimilar_titles_never_reach_the_model(session: AsyncSession, world: World) -> None:
    """The seeded pair is "Proposal 0" / "Proposal 1" — similar, but the guard here
    is that a model is not consulted when SQL finds nothing worth asking about."""
    from app.features.ai import queries

    recorder = Recorder("{}")
    monkey = queries.MIN_SIMILARITY
    try:
        queries.MIN_SIMILARITY = 0.99
        proposal = await service.find_duplicates(
            session, event_id=world.event.id, user_id=world.reviewer_id, adapter=recorder
        )
    finally:
        queries.MIN_SIMILARITY = monkey

    assert proposal.status is AiProposalStatus.READY
    assert proposal.output["pairs"] == []
    assert recorder.seen == [], "a model was asked about nothing"


async def test_a_near_identical_pair_is_shortlisted_and_adjudicated(
    session: AsyncSession, world: World
) -> None:
    left, right = world.submissions[0], world.submissions[1]
    recorder = Recorder(_dupe_answer(left, right))

    proposal = await service.find_duplicates(
        session, event_id=world.event.id, user_id=world.reviewer_id, adapter=recorder
    )

    assert proposal.status is AiProposalStatus.READY
    pairs = proposal.output["pairs"]
    assert len(pairs) == 1
    assert pairs[0]["is_duplicate"] is True
    # The codes come from our rows, not the model's answer — they are what an
    # organiser needs to go and look at the two submissions.
    assert pairs[0]["left_code"] and pairs[0]["right_code"]
    assert "text_similarity" in pairs[0]


async def test_a_verdict_about_a_pair_we_never_asked_about_is_dropped(
    session: AsyncSession, world: World
) -> None:
    """Invented ids would not resolve to anything an organiser could open."""
    recorder = Recorder(_dupe_answer(uuid.uuid4(), uuid.uuid4()))

    proposal = await service.find_duplicates(
        session, event_id=world.event.id, user_id=world.reviewer_id, adapter=recorder
    )

    assert proposal.output["pairs"] == []


async def test_duplicate_detection_writes_nothing_to_the_submissions(
    session: AsyncSession, world: World
) -> None:
    """It reports. Withdrawing a proposal costs a speaker their talk, so a human does it."""
    left, right = world.submissions[0], world.submissions[1]
    before = [
        (await session.get(Submission, sid)).status  # type: ignore[union-attr]
        for sid in (left, right)
    ]

    await service.find_duplicates(
        session,
        event_id=world.event.id,
        user_id=world.reviewer_id,
        adapter=Recorder(_dupe_answer(left, right)),
    )

    after = [
        (await session.get(Submission, sid)).status  # type: ignore[union-attr]
        for sid in (left, right)
    ]
    assert before == after
