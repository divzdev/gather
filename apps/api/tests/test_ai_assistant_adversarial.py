"""Adversarial: the paths the assistant takes when something goes wrong.

Seam 1. `assistant.answer` documents that "every path resolves the proposal row
exactly once". These tests take that sentence literally and look for the paths
where it is not true, plus the two boundary questions the happy-path tests do
not ask: can an admin of one organisation drive this route at another one's
event, and does the org-wide daily cap survive two questions asked at once.
"""

from __future__ import annotations

import asyncio
import contextlib
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
    name = "scripted"

    def __init__(self, *replies: str, raise_on: int | None = None) -> None:
        self.replies = list(replies)
        self.calls = 0
        self.raise_on = raise_on

    def _next(self) -> str:
        self.calls += 1
        if self.raise_on == self.calls:
            raise RuntimeError("the provider dropped the connection")
        return self.replies.pop(0) if self.replies else "{}"

    async def complete(self, *, system: str, user: str, max_tokens: int) -> Completion:
        return Completion(text=self._next(), model="scripted-1", usage={"input_tokens": 7})

    async def stream(self, *, system: str, user: str, max_tokens: int) -> AsyncIterator[str]:
        text = self._next()
        for piece in text.split(" "):
            yield piece + " "


def plan(*queries: tuple[str, dict[str, object]]) -> str:
    return json.dumps(
        {
            "queries": [{"name": name, "args": args} for name, args in queries],
            "clarify": None,
            "refusal": None,
        }
    )


def sse(body: str) -> list[tuple[str, dict[str, object]]]:
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


@dataclass
class Org:
    org_id: uuid.UUID
    event: Event
    admin: dict[str, str]


async def _make_org(client: AsyncClient, session: AsyncSession, label: str) -> Org:
    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        org = Organization(name=f"{label} {suffix}", slug=f"{label}-{suffix}")
        session.add(org)
        await session.flush()
        event = Event(
            org_id=org.id,
            name=f"{label} Conf",
            slug=f"{label}-adv-{suffix}",
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
        owner = User(
            email=f"{label}-{suffix}@example.com",
            name=f"{label} Owner",
            password_hash=hash_password(PASSWORD),
            email_verified_at=datetime.now(UTC),
        )
        session.add_all([form, owner])
        await session.flush()
        session.add(OrgMember(org_id=org.id, user_id=owner.id, role=Role.OWNER))
        session.add(
            Submission(
                org_id=org.id,
                event_id=event.id,
                form_id=form.id,
                code=f"{label[0].upper()}00001",
                title=f"{label} talk",
                answers={"abstract": "x"},
                status=SubmissionStatus.ACCEPTED,
            )
        )
        await session.commit()

    login = await client.post("/v1/auth/login", json={"email": owner.email, "password": PASSWORD})
    return Org(
        org_id=org.id,
        event=event,
        admin={"Authorization": f"Bearer {login.json()['access_token']}"},
    )


@pytest.fixture
async def mine(client: AsyncClient, session: AsyncSession) -> Org:
    return await _make_org(client, session, "mine")


@pytest.fixture
async def theirs(client: AsyncClient, session: AsyncSession) -> Org:
    return await _make_org(client, session, "theirs")


@pytest.fixture(autouse=True)
def sessions_hit_the_test_database(engine: object, monkeypatch: pytest.MonkeyPatch) -> None:
    """Same reason as in test_ai_assistant.py: this route owns its sessions."""
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.core import db

    monkeypatch.setattr(
        db,
        "session_factory",
        async_sessionmaker(engine, expire_on_commit=False, autoflush=False),  # type: ignore[arg-type]
    )


@pytest.fixture
def no_model_configured() -> Iterator[None]:
    settings = get_settings()
    before = (settings.anthropic_api_key, settings.ollama_base_url)
    settings.anthropic_api_key = ""
    settings.ollama_base_url = ""
    yield None
    settings.anthropic_api_key, settings.ollama_base_url = before


async def _rows(session: AsyncSession, event_id: uuid.UUID) -> list[AiProposal]:
    with tenancy_disabled():
        return list(
            (
                await session.scalars(
                    select(AiProposal).where(
                        AiProposal.kind == AiProposalKind.ANSWER,
                        AiProposal.event_id == event_id,
                    )
                )
            ).all()
        )


# ───────────────────────────── the tenant boundary ────────────────────────────


async def test_an_admin_cannot_ask_about_another_organisations_event(
    client: AsyncClient, mine: Org, theirs: Org
) -> None:
    """User story 15: tenancy must not be a thing you trust a prompt about."""
    response = await client.post(
        f"/v1/events/{theirs.event.id}/ai/ask",
        json={"question": "how many submissions do they have"},
        headers=mine.admin,
    )

    assert response.status_code == 403, response.text


async def test_an_event_that_does_not_exist_is_refused(client: AsyncClient, mine: Org) -> None:
    response = await client.post(
        f"/v1/events/{uuid.uuid4()}/ai/ask",
        json={"question": "anything"},
        headers=mine.admin,
    )

    assert response.status_code in (403, 404), response.text


# ──────────────────────── the proposal is always resolved ─────────────────────


async def test_a_provider_that_dies_mid_plan_does_not_strand_the_row(
    session: AsyncSession, mine: Org
) -> None:
    """An adapter is allowed to raise something that is not an `ApiError` — a
    socket error out of httpx is the ordinary case. The row must not be left
    saying the answer is still streaming."""
    request = assistant.AskRequest(question="how many submissions")
    adapter = Scripted(raise_on=1)

    with pytest.raises(RuntimeError):
        async for _ in assistant.answer(
            event_id=mine.event.id,
            org_id=mine.org_id,
            user_id=None,  # type: ignore[arg-type]
            request=request,
            adapter=adapter,  # type: ignore[arg-type]
        ):
            pass

    rows = await _rows(session, mine.event.id)
    assert [row.status for row in rows] != [AiProposalStatus.STREAMING], (
        f"the row is stranded in {rows[0].status if rows else None}"
    )


async def test_a_provider_that_dies_mid_prose_does_not_strand_the_row(
    session: AsyncSession, mine: Org
) -> None:
    adapter = Scripted(plan(("submissions_by", {"group_by": "status"})), raise_on=2)

    with pytest.raises(RuntimeError):
        async for _ in assistant.answer(
            event_id=mine.event.id,
            org_id=mine.org_id,
            user_id=None,  # type: ignore[arg-type]
            request=assistant.AskRequest(question="how many submissions"),
            adapter=adapter,  # type: ignore[arg-type]
        ):
            pass

    rows = await _rows(session, mine.event.id)
    assert [row.status for row in rows] != [AiProposalStatus.STREAMING], (
        f"the row is stranded in {rows[0].status if rows else None}"
    )


async def test_a_query_that_explodes_does_not_strand_the_row(
    session: AsyncSession, mine: Org, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`_run_plan` catches the two errors the catalog raises on purpose and
    nothing else. A genuine failure inside a query — the conflict engine, the
    snapshot builder, a dropped connection — takes the whole generator with it."""
    from app.features.ai import catalog

    async def explode(*args: object, **kwargs: object) -> dict[str, object]:
        raise RuntimeError("the conflict engine fell over")

    monkeypatch.setattr(catalog, "run", explode)
    adapter = Scripted(plan(("agenda_conflicts", {})), "Nothing to report.")

    with pytest.raises(RuntimeError):
        async for _ in assistant.answer(
            event_id=mine.event.id,
            org_id=mine.org_id,
            user_id=None,  # type: ignore[arg-type]
            request=assistant.AskRequest(question="what conflicts"),
            adapter=adapter,  # type: ignore[arg-type]
        ):
            pass

    rows = await _rows(session, mine.event.id)
    assert [row.status for row in rows] != [AiProposalStatus.STREAMING], (
        f"the row is stranded in {rows[0].status if rows else None}"
    )


async def test_a_reader_who_walks_away_mid_answer_does_not_strand_the_row(
    session: AsyncSession, mine: Org
) -> None:
    """Closing the drawer while the answer streams closes the generator. The
    proposal row is the ledger the daily cap and the spend report are built from,
    so a row that says `streaming` forever is a lie in both."""
    stream = assistant.answer(
        event_id=mine.event.id,
        org_id=mine.org_id,
        user_id=None,  # type: ignore[arg-type]
        request=assistant.AskRequest(question="how many submissions"),
        adapter=Scripted(  # type: ignore[arg-type]
            plan(("submissions_by", {"group_by": "status"})), "one two three four five"
        ),
    )
    async for name, _ in stream:
        if name == "token":
            break
    await stream.aclose()

    rows = await _rows(session, mine.event.id)
    assert [row.status for row in rows] != [AiProposalStatus.STREAMING], (
        f"the row is stranded in {rows[0].status if rows else None}"
    )


# ───────────────────────────────── the cap ────────────────────────────────────


async def test_two_questions_at_once_cannot_both_pass_a_cap_of_one(
    client: AsyncClient, session: AsyncSession, mine: Org, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The cap is a ceiling on a bill. It is read and written in separate
    statements, so two questions in flight together both see the same count."""
    settings = get_settings()
    monkeypatch.setattr(settings, "ai_daily_proposal_cap", 1, raising=False)
    monkeypatch.setattr(
        assistant,
        "select_adapter",
        lambda **_: Scripted(plan(("event_overview", {})), "It runs in May."),
    )

    async def ask() -> object:
        return await client.post(
            f"/v1/events/{mine.event.id}/ai/ask",
            json={"question": "when is the event"},
            headers=mine.admin,
        )

    first, second = await asyncio.gather(ask(), ask())

    answers = [sse(r.text)[-1][0] for r in (first, second)]  # type: ignore[attr-defined]
    assert answers.count("error") == 1, f"both questions were answered under a cap of 1: {answers}"


async def test_the_cap_survives_an_interleaving_between_count_and_insert(
    client: AsyncClient, mine: Org, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Same race, with the window held open.

    `assert_within_daily_cap` counts in one statement and `create` inserts in
    the next. The sleep does not invent the gap — it only makes the scheduler
    land in the middle of it every time instead of occasionally.
    """
    from app.features.ai import proposals

    settings = get_settings()
    monkeypatch.setattr(settings, "ai_daily_proposal_cap", 1, raising=False)
    monkeypatch.setattr(
        assistant,
        "select_adapter",
        lambda **_: Scripted(plan(("event_overview", {})), "It runs in May."),
    )
    original = proposals.create

    async def slow_create(*args: object, **kwargs: object) -> object:
        await asyncio.sleep(0.05)
        return await original(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(proposals, "create", slow_create)

    async def ask() -> object:
        return await client.post(
            f"/v1/events/{mine.event.id}/ai/ask",
            json={"question": "when is the event"},
            headers=mine.admin,
        )

    first, second = await asyncio.gather(ask(), ask())

    answers = [sse(r.text)[-1][0] for r in (first, second)]  # type: ignore[attr-defined]
    assert answers.count("error") == 1, f"both questions were answered under a cap of 1: {answers}"


# ──────────────────────────── the readability guard ───────────────────────────


@pytest.mark.parametrize(
    "prose",
    [
        '```json\n{"answer": "", "queries": []}\n```',
        '{"answer": "nothing to report"}\n\nHope that helps.',
        '[{"count": 3}] ',
    ],
)
async def test_json_dressed_up_is_still_json(prose: str) -> None:
    """`_is_readable` looks only at the first and last character. A model that
    fences its JSON, or trails a word after it, gets printed as the answer."""
    assert assistant._is_readable(prose) is False, f"{prose!r} was accepted as prose"


class Stalling:
    """A model whose prose call hangs after the first token, so a request can be
    cancelled while the generator is suspended *inside* it — the shape a real
    client disconnect takes under ASGI, which `aclose()` does not reproduce."""

    name = "stalling"

    def __init__(self, plan_reply: str) -> None:
        self.plan_reply = plan_reply
        self.first_token = asyncio.Event()

    async def complete(self, *, system: str, user: str, max_tokens: int) -> Completion:
        return Completion(text=self.plan_reply, model="stalling-1", usage={"input_tokens": 7})

    async def stream(self, *, system: str, user: str, max_tokens: int) -> AsyncIterator[str]:
        yield "the "
        self.first_token.set()
        await asyncio.sleep(30)
        yield "rest"


async def test_a_cancelled_request_does_not_strand_the_row(
    session: AsyncSession, mine: Org
) -> None:
    adapter = Stalling(plan(("submissions_by", {"group_by": "status"})))

    async def consume() -> None:
        async for _ in assistant.answer(
            event_id=mine.event.id,
            org_id=mine.org_id,
            user_id=None,  # type: ignore[arg-type]
            request=assistant.AskRequest(question="how many submissions"),
            adapter=adapter,  # type: ignore[arg-type]
        ):
            pass

    task = asyncio.create_task(consume())
    await asyncio.wait_for(adapter.first_token.wait(), timeout=5)
    await asyncio.sleep(0)
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

    rows = await _rows(session, mine.event.id)
    assert [row.status for row in rows] != [AiProposalStatus.STREAMING], (
        f"the row is stranded in {rows[0].status if rows else None}"
    )


async def test_no_database_connection_is_held_across_a_model_call(
    engine: object, mine: Org
) -> None:
    """The reason this route refuses `get_db` at all (architecture.md, spec 0005
    Transport): a session open across two model calls pins an asyncpg connection
    for the length of the answer. Measured at the pool while the model stalls."""
    adapter = Stalling(plan(("submissions_by", {"group_by": "status"})))
    checked_out: list[int] = []

    async def consume() -> None:
        async for _ in assistant.answer(
            event_id=mine.event.id,
            org_id=mine.org_id,
            user_id=None,  # type: ignore[arg-type]
            request=assistant.AskRequest(question="how many submissions"),
            adapter=adapter,  # type: ignore[arg-type]
        ):
            pass

    task = asyncio.create_task(consume())
    await asyncio.wait_for(adapter.first_token.wait(), timeout=5)
    checked_out.append(engine.pool.checkedout())  # type: ignore[attr-defined]
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

    assert checked_out == [0], f"a connection was pinned across the prose call: {checked_out}"

    # The meter reads non-zero when something *is* held, so [0] above is a
    # measurement rather than a fixture that never moves.
    from sqlalchemy import text

    from app.core import db

    async with db.session_factory() as held:
        await held.execute(text("select 1"))
        assert engine.pool.checkedout() == 1  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    ("body", "why"),
    [
        ({"question": ""}, "an empty question"),
        ({"question": "x" * 1001}, "a question over the length cap"),
        ({"question": "hi", "history": [{"role": "system", "content": "x"}]}, "an invented role"),
        ({"question": "hi", "history": [{"role": "user", "content": "x" * 2001}]}, "a long turn"),
        (
            {"question": "hi", "history": [{"role": "user", "content": "x"}] * 41},
            "more turns than the cap",
        ),
        ({"question": "hi", "event_id": "01a00000-0000-7000-8000-000000000000"}, "an extra field"),
    ],
)
async def test_the_request_boundary_refuses_before_a_model_is_reached(
    client: AsyncClient, mine: Org, body: dict[str, object], why: str
) -> None:
    """Untrusted input at the boundary. None of these may reach a model, and
    none may arrive as a 500."""
    response = await client.post(
        f"/v1/events/{mine.event.id}/ai/ask", json=body, headers=mine.admin
    )

    assert response.status_code == 422, f"{why} was accepted: {response.status_code}"


async def test_a_unicode_question_is_answered_not_mangled(
    client: AsyncClient, mine: Org, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = Scripted(plan(("event_overview", {})), "Événement en mai. 🎤")
    monkeypatch.setattr(assistant, "select_adapter", lambda **_: fake)

    response = await client.post(
        f"/v1/events/{mine.event.id}/ai/ask",
        json={"question": "quand est l'événement ? 🎤"},
        headers=mine.admin,
    )

    events = sse(response.text)
    prose = "".join(str(data.get("text", "")) for name, data in events if name == "token")
    assert "Événement" in prose and "🎤" in prose
    assert events[-1][0] == "done"
