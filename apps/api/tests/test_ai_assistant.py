"""The event assistant: what the planner is allowed to do with a model's answer.

Seam 1 (spec 0005). Everything here goes over HTTP through the SSE route, with
`select_adapter` replaced by a scripted fake, because the questions worth asking
are about the *boundary*: what we send, what we accept back, and what we refuse
to act on. The model is scripted rather than real for the obvious reason, and
because a test that asserts on model-written English is a tautology generator.

The other half of the feature is tested in `test_ai_catalog.py`, at the queries.
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
from app.core.tenancy import tenancy_disabled
from app.features.ai import assistant
from app.features.ai.adapters.base import Completion
from app.models import (
    AiProposal,
    AiProposalKind,
    AiProposalStatus,
    Event,
    EventMember,
    EventStatus,
    Form,
    FormKind,
    Organization,
    OrgMember,
    Role,
    Submission,
    SubmissionStatus,
    User,
)

PASSWORD = "correct horse battery staple"
FORM_SCHEMA: dict[str, object] = {"fields": [{"key": "abstract", "type": "textarea"}]}


class Scripted:
    """A model that says exactly what the test tells it to, in order.

    `seen` is the point of it: most of what matters here is what we *sent* — the
    catalog we advertised, the rows we handed back for prose, the history we
    carried — and no amount of reading the reply tells you that.
    """

    name = "scripted"
    #: The adapter names its model before it is asked anything, and the answer
    #: it eventually returns reports the same one. A fake that let those two
    #: differ would hide the bug this attribute exists for.
    model = "scripted-1"

    def __init__(self, *replies: str) -> None:
        self.replies = list(replies)
        self.seen: list[dict[str, str]] = []

    def _next(self, system: str, user: str) -> str:
        self.seen.append({"system": system, "user": user})
        return self.replies.pop(0) if self.replies else "{}"

    async def complete(self, *, system: str, user: str, max_tokens: int) -> Completion:
        return Completion(
            text=self._next(system, user), model=self.model, usage={"input_tokens": 7}
        )

    async def stream(self, *, system: str, user: str, max_tokens: int) -> AsyncIterator[str]:
        yield self._next(system, user)


def plan(*queries: tuple[str, dict[str, object]], clarify: str | None = None) -> str:
    return json.dumps(
        {
            "queries": [{"name": name, "args": args} for name, args in queries],
            "clarify": clarify,
            "refusal": None,
        }
    )


def sse(body: str) -> list[tuple[str, dict[str, object]]]:
    """Parse the wire format back into (event, payload) pairs."""
    parsed: list[tuple[str, dict[str, object]]] = []
    for block in body.strip().split("\n\n"):
        name, data = None, {}
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line.removeprefix("event: ")
            elif line.startswith("data: "):
                data = json.loads(line.removeprefix("data: "))
        if name is not None:
            parsed.append((name, data))
    return parsed


def names(events: list[tuple[str, dict[str, object]]]) -> list[str]:
    return [name for name, _ in events]


def payload(events: list[tuple[str, dict[str, object]]], wanted: str) -> dict[str, object]:
    for name, data in events:
        if name == wanted:
            return data
    raise AssertionError(f"no {wanted!r} event in {names(events)}")


@dataclass
class World:
    event: Event
    org_id: uuid.UUID
    admin: dict[str, str]
    reviewer: dict[str, str]


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
            slug=f"devflow-ask-{suffix}",
            timezone="UTC",
            starts_on=datetime(2027, 5, 12).date(),
            ends_on=datetime(2027, 5, 13).date(),
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
        reviewer = User(
            email=f"rev-{suffix}@example.com",
            name="Ravi Reviewer",
            password_hash=hash_password(PASSWORD),
            email_verified_at=datetime.now(UTC),
        )
        session.add_all([owner, reviewer])
        await session.flush()
        session.add(OrgMember(org_id=org.id, user_id=owner.id, role=Role.OWNER))
        session.add(
            EventMember(org_id=org.id, event_id=event.id, user_id=reviewer.id, role=Role.REVIEWER)
        )

        session.add(
            Submission(
                org_id=org.id,
                event_id=event.id,
                form_id=form.id,
                code="ASK001",
                title="Serving LLMs on spot GPUs",
                answers={"abstract": "About builds."},
                status=SubmissionStatus.ACCEPTED,
            )
        )
        await session.commit()

    async def token(email: str) -> dict[str, str]:
        login = await client.post("/v1/auth/login", json={"email": email, "password": PASSWORD})
        return {"Authorization": f"Bearer {login.json()['access_token']}"}

    return World(
        event=event,
        org_id=org.id,
        admin=await token(owner.email),
        reviewer=await token(reviewer.email),
    )


@pytest.fixture
def no_model_configured() -> Iterator[None]:
    """Explicitly unconfigured, so the stub tests do not bill whoever runs them.

    Same trap and same fix as `no_model_configured` in test_ai.py: every source
    `select_adapter` can pick has to be cleared here, or a developer with a real
    key quietly tests a live model instead of the stub.
    """
    settings = get_settings()
    before = (settings.anthropic_api_key, settings.ollama_base_url)
    settings.anthropic_api_key = ""
    settings.ollama_base_url = ""
    yield None
    settings.anthropic_api_key, settings.ollama_base_url = before


@pytest.fixture(autouse=True)
def sessions_hit_the_test_database(engine: object, monkeypatch: pytest.MonkeyPatch) -> None:
    """Point `db.session_factory` at this run's database.

    The SSE route is the one place in the app that opens its own sessions rather
    than taking `get_db` — it has to, or a `yield` dependency would hold a
    connection across two model calls. `conftest`'s `client` fixture redirects
    the app by overriding `get_db`, which this route never asks for, so without
    this the assistant would quietly read the developer's dev database while
    every other test used the disposable one.
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.core import db

    monkeypatch.setattr(
        db,
        "session_factory",
        async_sessionmaker(engine, expire_on_commit=False, autoflush=False),  # type: ignore[arg-type]
    )


@pytest.fixture
def scripted(monkeypatch: pytest.MonkeyPatch) -> object:
    """Replace the gateway's adapter choice for the duration of one test."""

    def install(*replies: str) -> Scripted:
        fake = Scripted(*replies)
        monkeypatch.setattr(assistant, "select_adapter", lambda **_: fake)
        return fake

    return install


async def ask(
    client: AsyncClient, world: World, question: str, headers: dict[str, str] | None = None, **extra
) -> object:
    return await client.post(
        f"/v1/events/{world.event.id}/ai/ask",
        json={"question": question, **extra},
        headers=headers if headers is not None else world.admin,
    )


# ──────────────────────────────── who may ask ────────────────────────────────


async def test_a_reviewer_cannot_ask_the_assistant_anything(
    client: AsyncClient, world: World
) -> None:
    """Blind review is enforced at the API, and a question answerer over
    submissions and speakers would drive straight around it."""
    response = await ask(client, world, "who submitted the GPU talk", headers=world.reviewer)

    assert response.status_code == 403


async def test_an_admin_gets_an_answer(client: AsyncClient, world: World, scripted) -> None:
    scripted(plan(("submissions_by", {"group_by": "status"})), "One accepted talk so far.")

    response = await ask(client, world, "how many submissions do we have")

    assert response.status_code == 200
    events = sse(response.text)
    # `model` is second on every path: the adapter is named as soon as it is
    # resolved, so the screen can say what is answering during the wait rather
    # than only once the answer lands.
    assert names(events) == ["planning", "model", "queries", "token", "done"]
    assert payload(events, "token")["text"] == "One accepted talk so far."


# ─────────────────────────── the plan is untrusted ───────────────────────────


async def test_a_query_that_does_not_exist_is_dropped_not_run(
    client: AsyncClient, world: World, scripted
) -> None:
    fake = scripted(
        plan(("delete_everything", {}), ("submissions_by", {"group_by": "status"})),
        "One accepted talk.",
    )

    response = await ask(client, world, "how many submissions")

    assert payload(sse(response.text), "queries")["names"] == ["submissions_by"]
    assert "delete_everything" not in fake.seen[1]["user"], "it must not reach the prose call"


async def test_arguments_the_query_refuses_drop_that_query(
    client: AsyncClient, world: World, scripted
) -> None:
    scripted(plan(("submissions_by", {"group_by": "'; DROP TABLE"})), "Nothing to report.")

    response = await ask(client, world, "break it")

    assert payload(sse(response.text), "queries")["names"] == []


async def test_a_plan_asking_for_too_many_queries_is_trimmed(
    client: AsyncClient, world: World, scripted
) -> None:
    """Three is the ceiling; a plan naming more is cut rather than refused, so a
    greedy plan still answers instead of failing in the user's face."""
    scripted(
        plan(
            ("submissions_by", {"group_by": "status"}),
            ("event_overview", {}),
            ("speakers_by_status", {}),
            ("outbox_delivery", {}),
        ),
        "Here is the state of things.",
    )

    response = await ask(client, world, "tell me everything")

    assert len(payload(sse(response.text), "queries")["names"]) == assistant.MAX_QUERIES


async def test_malformed_json_fails_the_proposal_rather_than_the_request(
    client: AsyncClient, session: AsyncSession, world: World, scripted
) -> None:
    scripted("I would love to help but I am not JSON.")

    response = await ask(client, world, "how many submissions")

    assert response.status_code == 200, "the stream opened, so the failure arrives inside it"
    assert names(sse(response.text))[-1] == "error"
    with tenancy_disabled():
        row = (
            await session.scalars(select(AiProposal).where(AiProposal.event_id == world.event.id))
        ).one()
    assert row.status == AiProposalStatus.FAILED
    assert row.output["error"], "a failed proposal has to say why"


# ──────────────────────── asking back, and declining ─────────────────────────


async def test_an_ambiguous_question_asks_back_without_a_second_call(
    client: AsyncClient, world: World, scripted
) -> None:
    fake = scripted(plan(clarify="Which day did you mean?"))

    response = await ask(client, world, "what is on in Hall A")

    events = sse(response.text)
    assert names(events) == ["planning", "model", "clarify"]
    assert payload(events, "clarify")["question"] == "Which day did you mean?"
    assert len(fake.seen) == 1, "asking back must not cost a second model call"


async def test_a_question_outside_the_catalog_is_refused_in_words(
    client: AsyncClient, world: World, scripted
) -> None:
    scripted(
        json.dumps(
            {"queries": [], "clarify": None, "refusal": "I can only answer about this event."}
        )
    )

    response = await ask(client, world, "what is the weather in Lisbon")

    events = sse(response.text)
    assert names(events) == ["planning", "model", "refusal"]
    assert "this event" in str(payload(events, "refusal")["message"])


# ──────────────────────────── the ledger and the cap ──────────────────────────


async def test_one_question_writes_exactly_one_proposal(
    client: AsyncClient, session: AsyncSession, world: World, scripted
) -> None:
    """Two model calls, one row. The cap counts questions, not round trips."""
    scripted(plan(("event_overview", {})), "It runs in May.")

    await ask(client, world, "when is the event")

    with tenancy_disabled():
        # Scoped to this world's event: with tenancy off, every other test's
        # answer rows are visible too, and "exactly one" would be a count of the
        # suite rather than of this question.
        rows = (
            await session.scalars(
                select(AiProposal).where(
                    AiProposal.kind == AiProposalKind.ANSWER,
                    AiProposal.event_id == world.event.id,
                )
            )
        ).all()
    assert len(rows) == 1
    assert rows[0].status == AiProposalStatus.READY
    assert rows[0].resolved_at is None, "an answer is never accepted or discarded"


async def test_the_daily_cap_refuses_before_spending(
    client: AsyncClient, world: World, scripted, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = scripted(plan(("event_overview", {})), "It runs in May.")
    settings = get_settings()
    monkeypatch.setattr(settings, "ai_daily_proposal_cap", 1, raising=False)

    await ask(client, world, "when is the event")
    second = await ask(client, world, "when is the event")

    assert names(sse(second.text))[-1] == "error"
    assert len(fake.seen) == 2, "the second question must not have reached a model"


# ─────────────────────────── what the model is sent ───────────────────────────


async def test_the_planner_is_told_about_every_catalog_entry(
    client: AsyncClient, world: World, scripted
) -> None:
    fake = scripted(plan(("event_overview", {})), "It runs in May.")

    await ask(client, world, "when is the event")

    advertised = fake.seen[0]["user"] + fake.seen[0]["system"]
    from app.features.ai import catalog

    for name in catalog.CATALOG:
        assert name in advertised, f"the planner was never told {name} exists"


async def test_the_prose_call_is_given_the_rows_and_not_the_database(
    client: AsyncClient, world: World, scripted
) -> None:
    fake = scripted(plan(("event_overview", {})), "It runs in May.")

    await ask(client, world, "when is the event")

    assert "DevFlow Conf 2027" in fake.seen[1]["user"], "the rows have to reach the prose call"


async def test_history_is_carried_into_the_plan(
    client: AsyncClient, world: World, scripted
) -> None:
    """Follow-ups are the whole reason history exists: 'what about Thursday' is
    unanswerable without the turn before it."""
    fake = scripted(plan(("sessions_in_window", {"day": "2027-05-13"})), "Nothing that day.")

    await ask(
        client,
        world,
        "what about the next day",
        history=[
            {"role": "user", "content": "what is on 2027-05-12"},
            {"role": "assistant", "content": "One talk in Hall A."},
        ],
    )

    assert "what is on 2027-05-12" in fake.seen[0]["user"]


async def test_history_is_bounded_so_a_long_chat_cannot_grow_the_prompt_forever(
    client: AsyncClient, world: World, scripted
) -> None:
    fake = scripted(plan(("event_overview", {})), "It runs in May.")
    turns = [{"role": "user", "content": f"question {index}"} for index in range(30)]

    await ask(client, world, "when is the event", history=turns)

    sent = fake.seen[0]["user"]
    # Pinned to the boundary, not to "some were dropped": this passed with the
    # bound four times looser, which is most of the protection gone.
    kept = assistant.MAX_HISTORY
    assert f"question {len(turns) - 1}" in sent, "the most recent turn always goes"
    assert f"question {len(turns) - kept}" in sent, f"the last {kept} turns go"
    assert f"question {len(turns) - kept - 1}" not in sent, "and nothing older than that"


# ──────────────────────────── with no key at all ──────────────────────────────


async def test_with_no_model_configured_the_numbers_are_still_real(
    client: AsyncClient, world: World, no_model_configured: None
) -> None:
    """The zero-credential path. The stub picks the query by keyword and writes
    unintelligent prose, but the rows underneath it came out of Postgres."""
    response = await ask(client, world, "how many submissions do we have")

    events = sse(response.text)
    assert payload(events, "done")["is_stub"] is True
    assert payload(events, "queries")["names"] == ["submissions_by"]
    prose = "".join(str(data.get("text", "")) for name, data in events if name == "token")
    assert "no model" in prose.lower(), "it must never pass itself off as reasoning"


async def test_a_plan_naming_the_same_query_twice_runs_it_once(
    client: AsyncClient, world: World, scripted
) -> None:
    """Observed with a real llama3.1:8b, which asked for `submissions_by` three
    times. Running it three times costs three queries and renders "Looked at
    submission counts · submission counts · submission counts"."""
    scripted(
        plan(
            ("submissions_by", {"group_by": "status"}),
            ("submissions_by", {"group_by": "status"}),
            ("submissions_by", {"group_by": "status"}),
        ),
        "One accepted talk.",
    )

    response = await ask(client, world, "how many submissions")

    assert payload(sse(response.text), "queries")["names"] == ["submissions_by"]


async def test_the_same_query_with_different_arguments_is_not_deduplicated(
    client: AsyncClient, world: World, scripted
) -> None:
    """Two days of the schedule is a legitimate plan, not a repeat."""
    scripted(
        plan(
            ("sessions_in_window", {"day": "2027-05-12"}),
            ("sessions_in_window", {"day": "2027-05-13"}),
        ),
        "Nothing either day.",
    )

    response = await ask(client, world, "what is on across the event")

    assert payload(sse(response.text), "queries")["names"] == [
        "sessions_in_window",
        "sessions_in_window",
    ]


async def test_prose_that_is_not_prose_is_a_failure_not_an_answer(
    client: AsyncClient, session: AsyncSession, world: World, scripted
) -> None:
    """A small model can carry JSON mode over from the planning call and reply
    `{}`. Printing that as the answer is worse than admitting it failed."""
    scripted(plan(("submissions_by", {"group_by": "status"})), "{ \n\n}")

    response = await ask(client, world, "how many submissions")

    events = sse(response.text)
    assert names(events)[-1] == "error"
    assert "".join(str(data.get("text", "")) for name, data in events if name == "token") != "{"
    with tenancy_disabled():
        row = (
            await session.scalars(select(AiProposal).where(AiProposal.event_id == world.event.id))
        ).one()
    assert row.status == AiProposalStatus.FAILED


async def test_every_terminal_event_says_which_model_answered(
    client: AsyncClient, world: World, scripted
) -> None:
    """Reported: "still not showing what model is being used".

    It was only on `done`. Both of the paths the reporter actually hit — a
    refusal and a clarification — end without one, so the screen never learned
    what had answered. A refusal is still a model speaking.
    """
    scripted(
        json.dumps({"queries": [], "clarify": None, "refusal": "Not something I can look up."})
    )

    response = await ask(client, world, "what is the weather")

    events = sse(response.text)
    # The model, not the wire protocol. The first cut of this yielded
    # `adapter.name` — "openai-compat" — which answers a question nobody asked
    # and reads on screen as a bug.
    assert payload(events, "model")["name"] == "scripted-1"
    assert payload(events, "model")["provider"], "and who it belongs to"
    refusal = payload(events, "refusal")
    assert refusal["model"] == "scripted-1"
    assert refusal["usage"] == {"input_tokens": 7}
    assert isinstance(refusal["elapsed_ms"], int)
