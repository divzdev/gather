"""The call-for-papers loop end to end.

Anonymous speaker submits → organizer sees it → decides → promotes to a session.
Every step goes through the real HTTP surface.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.tenancy import tenancy_disabled
from app.models import (
    DecisionStatus,
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

SCHEMA = {
    "sections": [
        {
            "key": "main",
            "title": "Proposal",
            "fields": [
                {"key": "abstract", "type": "long_text", "label": "Abstract", "required": True},
                {
                    "key": "format",
                    "type": "select",
                    "label": "Format",
                    "required": True,
                    "choices": [
                        {"value": "talk", "label": "Talk (30 min)"},
                        {"value": "workshop", "label": "Workshop (120 min)"},
                    ],
                },
                {"key": "prerequisites", "type": "long_text", "label": "Prerequisites"},
            ],
        }
    ],
    "logic": [
        {
            "field": "format",
            "operator": "is",
            "value": "workshop",
            "action": "show",
            "target": "prerequisites",
        },
        {
            "field": "format",
            "operator": "is",
            "value": "workshop",
            "action": "require",
            "target": "prerequisites",
        },
    ],
    "settings": {"confirmation_message": "Thanks — your proposal is in."},
}

GOOD = {"abstract": "A long enough abstract about builds.", "format": "talk"}


@pytest.fixture
async def cfp(client: AsyncClient, session: AsyncSession) -> tuple[dict[str, str], Event, Form]:
    """An open CFP on a fresh event, plus an admin's auth header."""
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
            status=EventStatus.CFP_OPEN,
            cfp_closes_at=datetime.now(UTC) + timedelta(days=30),
        )
        session.add(event)
        await session.flush()
        form = Form(
            org_id=org.id,
            event_id=event.id,
            name="CFP",
            kind=FormKind.CFP,
            schema=SCHEMA,
        )
        session.add(form)
        user = User(
            email=f"admin-{suffix}@example.com",
            name="Jordan Alvarez",
            password_hash=hash_password(PASSWORD),
        )
        session.add(user)
        await session.flush()
        session.add(OrgMember(org_id=org.id, user_id=user.id, role=Role.OWNER))
        await session.commit()

    login = await client.post("/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    return headers, event, form


async def test_public_form_is_readable_without_any_login(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _, event, _ = cfp

    response = await client.get(f"/v1/public/events/{event.slug}/cfp-form")

    assert response.status_code == 200
    body = response.json()
    assert body["event_name"] == "DevFlow Conf 2027"
    assert body["is_open"] is True
    assert [f["key"] for f in body["schema"]["sections"][0]["fields"]] == [
        "abstract",
        "format",
        "prerequisites",
    ]


async def test_submit_appears_in_the_organizer_list(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, form = cfp

    submitted = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Taming 40-Minute CI",
            "answers": GOOD,
            "speaker_email": "priya@example.com",
            "speaker_name": "Priya Raman",
        },
    )
    assert submitted.status_code == 201
    code = submitted.json()["code"]
    assert submitted.json()["confirmation_message"] == "Thanks — your proposal is in."

    listed = await client.get(f"/v1/events/{event.id}/submissions", headers=headers)
    rows = listed.json()["data"]
    assert [r["title"] for r in rows] == ["Taming 40-Minute CI"]
    assert rows[0]["code"] == code
    assert [s["email"] for s in rows[0]["speakers"]] == ["priya@example.com"]


async def test_required_field_missing_is_rejected(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _, event, form = cfp

    response = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "No abstract",
            "answers": {"format": "talk"},
            "speaker_email": "a@example.com",
            "speaker_name": "A",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["field"] == "abstract"


async def test_conditionally_required_field_is_enforced_server_side(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """A client that skips the workshop prerequisites must still be refused."""
    _, event, form = cfp

    response = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Workshop",
            "answers": {"abstract": "Hands on.", "format": "workshop"},
            "speaker_email": "b@example.com",
            "speaker_name": "B",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["field"] == "prerequisites"


async def test_draft_resumes_and_keeps_its_code(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The code is issued at first save, so a resumed draft keeps its identity."""
    _, event, form = cfp
    payload = {
        "form_id": str(form.id),
        "title": "Half written",
        "answers": {"abstract": "Just the start"},
        "speaker_email": "c@example.com",
        "speaker_name": "C",
    }

    first = await client.post(f"/v1/public/events/{event.slug}/submissions/draft", json=payload)
    assert first.status_code == 200
    token, code = first.json()["draft_token"], first.json()["code"]

    resumed = await client.post(
        f"/v1/public/events/{event.slug}/submissions/draft",
        json={**payload, "title": "Now finished", "draft_token": token},
    )

    assert resumed.json()["code"] == code
    assert resumed.json()["status"] == "draft"


async def test_draft_does_not_enforce_required_fields(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _, event, form = cfp

    response = await client.post(
        f"/v1/public/events/{event.slug}/submissions/draft",
        json={
            "form_id": str(form.id),
            "title": "Barely started",
            "answers": {},
            "speaker_email": "d@example.com",
            "speaker_name": "D",
        },
    )

    assert response.status_code == 200


async def test_a_closed_cfp_refuses_submissions(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The server clock decides, whatever the page was showing."""
    _, event, form = cfp
    with tenancy_disabled():
        stored = await session.get(Event, event.id)
        assert stored is not None
        stored.cfp_closes_at = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()

    response = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Too late",
            "answers": GOOD,
            "speaker_email": "e@example.com",
            "speaker_name": "E",
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CFP_CLOSED"

    page = await client.get(f"/v1/public/events/{event.slug}/cfp-form")
    assert page.json()["is_open"] is False
    assert page.json()["closed_reason"]


async def test_status_by_code_never_leaks_the_decision_before_it_is_sent(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, form = cfp
    submitted = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Pending",
            "answers": GOOD,
            "speaker_email": "f@example.com",
            "speaker_name": "F",
        },
    )
    code = submitted.json()["code"]
    submission_id = submitted.json()["id"]

    await client.post(
        f"/v1/events/{event.id}/submissions/{submission_id}/decision",
        json={"outcome": "accepted"},
        headers=headers,
    )

    public = await client.get(f"/v1/public/events/{event.slug}/submissions/{code}/status")

    assert public.status_code == 200
    assert public.json()["outcome"] is None
    assert public.json()["stage"] == "in_review"


async def test_deciding_sends_no_email(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The rule the product is built around."""
    from app.models import Message

    headers, event, form = cfp
    submitted = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Decide me",
            "answers": GOOD,
            "speaker_email": "g@example.com",
            "speaker_name": "G",
        },
    )
    submission_id = submitted.json()["id"]

    with tenancy_disabled():
        before = len(
            (await session.execute(select(Message).where(Message.event_id == event.id)))
            .scalars()
            .all()
        )

    decided = await client.post(
        f"/v1/events/{event.id}/submissions/{submission_id}/decision",
        json={"outcome": "rejected"},
        headers=headers,
    )
    assert decided.json()["decision_status"] == DecisionStatus.PENDING_SEND.value

    with tenancy_disabled():
        after = len(
            (await session.execute(select(Message).where(Message.event_id == event.id)))
            .scalars()
            .all()
        )
    assert after == before


async def test_pending_decisions_counts_by_outcome(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, form = cfp
    ids = []
    for index in range(3):
        response = await client.post(
            f"/v1/public/events/{event.slug}/submissions",
            json={
                "form_id": str(form.id),
                "title": f"Proposal {index}",
                "answers": GOOD,
                "speaker_email": f"h{index}@example.com",
                "speaker_name": f"H{index}",
            },
        )
        ids.append(response.json()["id"])

    await client.post(
        f"/v1/events/{event.id}/submissions/bulk-decision",
        json={"submission_ids": ids[:2], "outcome": "accepted"},
        headers=headers,
    )
    await client.post(
        f"/v1/events/{event.id}/submissions/{ids[2]}/decision",
        json={"outcome": "rejected"},
        headers=headers,
    )

    counts = await client.get(
        f"/v1/events/{event.id}/submissions/pending-decisions", headers=headers
    )
    assert counts.json() == {"accepted": 2, "waitlisted": 0, "rejected": 1, "total": 3}


async def test_accepted_submission_becomes_a_session(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The handoff: an accepted talk reaches the agenda without re-entry."""
    headers, event, form = cfp
    submitted = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Taming 40-Minute CI",
            "answers": GOOD,
            "speaker_email": "i@example.com",
            "speaker_name": "Priya Raman",
        },
    )
    submission_id = submitted.json()["id"]

    await client.post(
        f"/v1/events/{event.id}/submissions/{submission_id}/decision",
        json={"outcome": "accepted"},
        headers=headers,
    )
    promoted = await client.post(
        f"/v1/events/{event.id}/submissions/{submission_id}/promote", headers=headers
    )

    assert promoted.status_code == 201
    assert promoted.json()["title"] == "Taming 40-Minute CI"

    again = await client.post(
        f"/v1/events/{event.id}/submissions/{submission_id}/promote", headers=headers
    )
    assert again.json()["id"] == promoted.json()["id"]

    listed = await client.get(f"/v1/events/{event.id}/sessions", headers=headers)

    assert listed.status_code == 200
    rows = listed.json()
    assert [row["id"] for row in rows] == [promoted.json()["id"]]
    # Unplaced, and its content is not public until someone approves it.
    assert rows[0]["starts_at"] is None
    assert rows[0]["status"] == "unscheduled"
    assert rows[0]["content_status"] == "pending"
    assert [speaker["name"] for speaker in rows[0]["speakers"]] == ["Priya Raman"]


async def test_only_accepted_submissions_can_be_promoted(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, form = cfp
    submitted = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Not accepted",
            "answers": GOOD,
            "speaker_email": "j@example.com",
            "speaker_name": "J",
        },
    )

    response = await client.post(
        f"/v1/events/{event.id}/submissions/{submitted.json()['id']}/promote", headers=headers
    )

    assert response.status_code == 409


async def test_submitting_locks_the_form_structure(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """Deleting a field after answers exist would silently reinterpret them."""
    headers, event, form = cfp
    await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Locks the form",
            "answers": GOOD,
            "speaker_email": "k@example.com",
            "speaker_name": "K",
        },
    )

    trimmed = {**SCHEMA, "sections": [{**SCHEMA["sections"][0], "fields": []}], "logic": []}
    response = await client.patch(
        f"/v1/events/{event.id}/forms/{form.id}", json={"schema": trimmed}, headers=headers
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "FORM_LOCKED"


async def test_renaming_a_label_is_still_allowed_after_lock(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, form = cfp
    await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Locks it",
            "answers": GOOD,
            "speaker_email": "l@example.com",
            "speaker_name": "L",
        },
    )

    relabelled = {
        **SCHEMA,
        "sections": [
            {
                **SCHEMA["sections"][0],
                "fields": [
                    {**SCHEMA["sections"][0]["fields"][0], "label": "Session abstract"},
                    *SCHEMA["sections"][0]["fields"][1:],
                ],
            }
        ],
    }
    response = await client.patch(
        f"/v1/events/{event.id}/forms/{form.id}", json={"schema": relabelled}, headers=headers
    )

    assert response.status_code == 200
    assert response.json()["is_locked"] is True


async def test_the_same_email_twice_is_one_speaker(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, form = cfp
    for title in ("First proposal", "Second proposal"):
        await client.post(
            f"/v1/public/events/{event.slug}/submissions",
            json={
                "form_id": str(form.id),
                "title": title,
                "answers": GOOD,
                "speaker_email": "repeat@example.com",
                "speaker_name": "Repeat Speaker",
            },
        )

    listed = await client.get(f"/v1/events/{event.id}/submissions", headers=headers)
    speaker_ids = {r["speakers"][0]["id"] for r in listed.json()["data"]}

    assert len(listed.json()["data"]) == 2
    assert len(speaker_ids) == 1


async def test_submission_list_is_scoped_to_its_event(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """An organizer of one event must not see another event's proposals."""
    headers, event, form = cfp
    await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Mine",
            "answers": GOOD,
            "speaker_email": "m@example.com",
            "speaker_name": "M",
        },
    )

    with tenancy_disabled():
        others = (
            (await session.execute(select(Submission).where(Submission.event_id != event.id)))
            .scalars()
            .all()
        )

    listed = await client.get(f"/v1/events/{event.id}/submissions", headers=headers)
    titles = {r["title"] for r in listed.json()["data"]}

    assert titles == {"Mine"}
    for other in others:
        assert other.title not in titles


async def test_submission_limit_is_enforced(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _, event, form = cfp
    with tenancy_disabled():
        stored = await session.get(Event, event.id)
        assert stored is not None
        stored.submission_limit_per_speaker = 1
        await session.commit()

    payload = {
        "form_id": str(form.id),
        "answers": GOOD,
        "speaker_email": "limited@example.com",
        "speaker_name": "Limited",
    }
    first = await client.post(
        f"/v1/public/events/{event.slug}/submissions", json={**payload, "title": "One"}
    )
    second = await client.post(
        f"/v1/public/events/{event.slug}/submissions", json={**payload, "title": "Two"}
    )

    assert first.status_code == 201
    assert second.status_code == 403
    assert second.json()["error"]["code"] == "SUBMISSION_LIMIT_REACHED"


async def test_coordinators_cannot_decide(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _, event, form = cfp
    submitted = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Whose call",
            "answers": GOOD,
            "speaker_email": "n@example.com",
            "speaker_name": "N",
        },
    )

    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        stored_event = await session.get(Event, event.id)
        assert stored_event is not None
        coordinator = User(
            email=f"coord-{suffix}@example.com",
            name="Coordinator",
            password_hash=hash_password(PASSWORD),
        )
        session.add(coordinator)
        await session.flush()
        session.add(
            OrgMember(org_id=stored_event.org_id, user_id=coordinator.id, role=Role.COORDINATOR)
        )
        await session.commit()

    login = await client.post(
        "/v1/auth/login", json={"email": coordinator.email, "password": PASSWORD}
    )
    coord_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = await client.post(
        f"/v1/events/{event.id}/submissions/{submitted.json()['id']}/decision",
        json={"outcome": "accepted"},
        headers=coord_headers,
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ROLE_REQUIRED"


async def test_submitted_status_is_visible_by_code(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _, event, form = cfp
    submitted = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Track me",
            "answers": GOOD,
            "speaker_email": "o@example.com",
            "speaker_name": "O",
        },
    )
    code = submitted.json()["code"]

    response = await client.get(f"/v1/public/events/{event.slug}/submissions/{code}/status")

    assert response.status_code == 200
    assert response.json()["title"] == "Track me"
    assert response.json()["stage"] == "submitted"
    assert "score" not in response.text and "reviewer" not in response.text


async def test_unknown_code_is_a_404(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _, event, _ = cfp

    response = await client.get(f"/v1/public/events/{event.slug}/submissions/ZZZZZZ/status")

    assert response.status_code == 404


async def test_submission_status_is_submitted_after_submit(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _, event, form = cfp

    response = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "State check",
            "answers": GOOD,
            "speaker_email": "p@example.com",
            "speaker_name": "P",
        },
    )

    assert response.json()["status"] == SubmissionStatus.SUBMITTED.value
