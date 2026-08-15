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
    FormStatus,
    Organization,
    OrgMember,
    Role,
    Speaker,
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
            email_verified_at=datetime.now(UTC),
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


async def test_a_draft_saved_before_the_name_was_asked_for_adopts_it_later(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The form autosaves as soon as it has an address, which is before it has
    asked who you are — so the first save can only send the email as the name.

    Left alone, that address was the speaker's name forever: on the roster, in
    the programme, and in the greeting of every email they got."""
    headers, event, form = cfp
    base = {"form_id": str(form.id), "answers": GOOD, "speaker_email": "late@example.com"}

    first = await client.post(
        f"/v1/public/events/{event.slug}/submissions/draft",
        json={**base, "title": "Half a thought", "speaker_name": "late@example.com"},
    )
    await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            **base,
            "title": "Half a thought",
            "speaker_name": "Dana Okafor",
            "draft_token": first.json()["draft_token"],
        },
    )

    listed = await client.get(f"/v1/events/{event.id}/submissions", headers=headers)
    speaker = next(
        s
        for row in listed.json()["data"]
        for s in row["speakers"]
        if s["email"] == "late@example.com"
    )

    assert speaker["name"] == "Dana Okafor"


async def test_a_later_draft_never_overwrites_a_name_a_human_chose(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """Adoption only replaces the email-as-name placeholder. An organizer who
    corrects a speaker's spelling must not have it undone by that speaker's next
    keystroke on a second proposal."""
    headers, event, form = cfp
    base = {"form_id": str(form.id), "answers": GOOD, "speaker_email": "fixed@example.com"}

    await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={**base, "title": "First", "speaker_name": "typo"},
    )
    with tenancy_disabled():
        speaker = await session.scalar(select(Speaker).where(Speaker.email == "fixed@example.com"))
        assert speaker is not None
        speaker.name = "Corrected By Staff"
        await session.commit()

    await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={**base, "title": "Second", "speaker_name": "typo again"},
    )

    listed = await client.get(f"/v1/events/{event.id}/submissions", headers=headers)
    names = {s["name"] for row in listed.json()["data"] for s in row["speakers"]}

    assert "Corrected By Staff" in names
    assert "typo again" not in names


async def test_the_public_form_carries_the_zone_its_deadline_is_in(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """`closes_at` is an instant in UTC. Without the event's zone the page can
    only format it in the reader's own, so the advertised deadline differed for
    every speaker outside the conference's timezone."""
    _, event, _ = cfp

    body = (await client.get(f"/v1/public/events/{event.slug}/cfp-form")).json()

    assert body["event_timezone"] == event.timezone
    assert body["submission_limit_per_speaker"] == event.submission_limit_per_speaker


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
            email_verified_at=datetime.now(UTC),
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


async def test_closing_the_cfp_from_settings_shuts_the_public_form(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The window is checked against the form, which carries its own dates, so
    an event-level change that did not reach the form left the settings field a
    silent no-op: the organizer closed the call and the portal stayed open."""
    headers, event, _form = cfp

    patched = await client.patch(
        f"/v1/events/{event.id}",
        json={"cfp_closes_at": "2020-01-01T00:00:00Z"},
        headers=headers,
    )
    assert patched.status_code == 200

    public = await client.get(f"/v1/public/events/{event.slug}/cfp-form")

    assert public.status_code == 200
    assert public.json()["is_open"] is False
    assert public.json()["closed_reason"] is not None


async def test_a_proposal_can_name_co_speakers(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, form = cfp

    response = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Two people, one talk",
            "answers": GOOD,
            "speaker_email": "lead@example.com",
            "speaker_name": "Lead Speaker",
            "co_speakers": [
                {"name": "Second Speaker", "email": "second@example.com"},
                {"name": "Third Speaker", "email": "third@example.com"},
            ],
        },
    )

    assert response.status_code == 201, response.text
    listing = await client.get(f"/v1/events/{event.id}/submissions", headers=headers)
    row = next(r for r in listing.json()["data"] if r["title"] == "Two people, one talk")
    names = [person["name"] for person in row["speakers"]]
    assert names[0] == "Lead Speaker"
    assert set(names) == {"Lead Speaker", "Second Speaker", "Third Speaker"}


async def test_the_submitter_is_never_duplicated_as_their_own_co_speaker(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """Easy to do on a form that pre-fills your own address into the first row."""
    headers, event, form = cfp

    await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Solo really",
            "answers": GOOD,
            "speaker_email": "solo@example.com",
            "speaker_name": "Solo Speaker",
            "co_speakers": [{"name": "Solo Speaker", "email": "SOLO@example.com"}],
        },
    )

    listing = await client.get(f"/v1/events/{event.id}/submissions", headers=headers)
    row = next(r for r in listing.json()["data"] if r["title"] == "Solo really")
    assert len(row["speakers"]) == 1


async def test_more_co_speakers_than_the_form_allows_is_refused(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _headers, event, form = cfp
    with tenancy_disabled():
        stored = await session.get(Form, form.id)
        assert stored is not None
        schema = dict(stored.schema)
        schema["settings"] = {**schema.get("settings", {}), "max_co_speakers": 1}
        stored.schema = schema
        await session.commit()

    response = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Too many cooks",
            "answers": GOOD,
            "speaker_email": "lead2@example.com",
            "speaker_name": "Lead Two",
            "co_speakers": [
                {"name": "A", "email": "a@example.com"},
                {"name": "B", "email": "b@example.com"},
            ],
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["field"] == "co_speakers"


async def test_a_draft_form_does_not_replace_the_live_call_for_papers(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """Starting a second form in the builder must not take the public CFP down.

    The public route took the newest CFP form of any status, so creating one
    swapped the live form for an empty untitled draft while the organiser was
    still deciding what to put on it.
    """
    headers, event, form = cfp
    with tenancy_disabled():
        stored = await session.get(Form, form.id)
        assert stored is not None
        stored.status = FormStatus.OPEN
        await session.commit()

    created = await client.post(
        f"/v1/events/{event.id}/forms",
        headers=headers,
        json={
            "name": "Untitled form",
            "kind": "cfp",
            "schema": {"sections": [], "logic": [], "settings": {}},
        },
    )
    assert created.status_code == 201

    public = await client.get(f"/v1/public/events/{event.slug}/cfp-form")

    assert public.status_code == 200
    assert public.json()["form_name"] != "Untitled form"
    assert public.json()["schema"]["sections"] != []


@pytest.mark.parametrize("field", ["closes_at", "opens_at"])
async def test_a_form_deadline_cannot_predate_the_event(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form], field: str
) -> None:
    """A call closing before the conference is normal — it has to. A call
    closing in 2005 is a typo in a datetime field nobody notices, and the form
    then reports itself permanently shut with no explanation on the public page.

    The floor is when the event was created, not now: backdating a deadline to
    last week is a legitimate record of a call that has already closed, and
    refusing that would block the honest case to catch the typo.
    """
    headers, event, form = cfp

    response = await client.patch(
        f"/v1/events/{event.id}/forms/{form.id}",
        headers=headers,
        json={field: "2005-10-27T21:28:00Z"},
    )

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


async def test_a_form_deadline_after_the_event_was_created_is_allowed(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The other side of the floor: a deadline already in the past is a warning
    on screen, never a refusal, so an organiser can record a closed call."""
    headers, event, form = cfp

    response = await client.patch(
        f"/v1/events/{event.id}/forms/{form.id}",
        headers=headers,
        json={"closes_at": "2027-05-01T12:00:00Z"},
    )

    assert response.status_code == 200, response.text


async def test_a_forms_kind_can_be_changed_until_it_locks(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """Step one of the builder promises "you can change this until the first
    submission arrives", and offers Call for papers / Speaker task as a choice.

    The PATCH did not accept `kind` at all, so the choice was decorative: the
    picker highlighted locally, the save dropped it, and reopening the form
    showed the kind it was created with.
    """
    headers, event, form = cfp

    response = await client.patch(
        f"/v1/events/{event.id}/forms/{form.id}", headers=headers, json={"kind": "task"}
    )

    assert response.status_code == 200, response.text
    assert response.json()["kind"] == "task"

    reopened = await client.get(f"/v1/events/{event.id}/forms/{form.id}", headers=headers)
    assert reopened.json()["kind"] == "task"


async def test_a_forms_kind_is_frozen_once_a_submission_arrives(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The other half of the same promise. Turning a call for papers into a task
    form under 200 collected proposals reclassifies every one of them."""
    headers, event, form = cfp
    submitted = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Locks the form",
            "answers": GOOD,
            "speaker_email": "locker@example.com",
            "speaker_name": "Lock Speaker",
        },
    )
    assert submitted.status_code == 201

    response = await client.patch(
        f"/v1/events/{event.id}/forms/{form.id}", headers=headers, json={"kind": "task"}
    )

    assert response.status_code == 409
    reopened = await client.get(f"/v1/events/{event.id}/forms/{form.id}", headers=headers)
    assert reopened.json()["kind"] == "cfp"


async def test_an_internal_note_is_attributed_and_never_public(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """Notes are team chatter. They have to name their author, and they must not
    appear on any surface a speaker can reach."""
    headers, event, form = cfp
    submitted = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Noted proposal",
            "answers": GOOD,
            "speaker_email": "noted@example.com",
            "speaker_name": "Noted Speaker",
        },
    )
    submission_id = submitted.json()["id"]
    code = submitted.json()["code"]

    added = await client.post(
        f"/v1/events/{event.id}/submissions/{submission_id}/notes",
        headers=headers,
        json={"body": "Strong opener, weak middle."},
    )
    listed = await client.get(
        f"/v1/events/{event.id}/submissions/{submission_id}/notes", headers=headers
    )

    assert added.status_code == 201
    assert added.json()["author_name"] != ""
    assert [row["body"] for row in listed.json()] == ["Strong opener, weak middle."]

    public = await client.get(f"/v1/public/events/{event.slug}/submissions/{code}/status")
    assert "weak middle" not in public.text


async def test_an_empty_note_is_refused(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, form = cfp
    submitted = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Blank note target",
            "answers": GOOD,
            "speaker_email": "blank@example.com",
            "speaker_name": "Blank Note",
        },
    )
    submission_id = submitted.json()["id"]

    response = await client.post(
        f"/v1/events/{event.id}/submissions/{submission_id}/notes",
        headers=headers,
        json={"body": "   "},
    )

    assert response.status_code == 422


async def _submitted(client: AsyncClient, event: Event, form: Form) -> tuple[str, str]:
    """A proposal that is in, with the token that lets its author back in."""
    draft = await client.post(
        f"/v1/public/events/{event.slug}/submissions/draft",
        json={
            "form_id": str(form.id),
            "title": "Taming 40-Minute CI",
            "answers": GOOD,
            "speaker_email": "editor@example.com",
            "speaker_name": "Edie Torres",
        },
    )
    token = draft.json()["draft_token"]
    submitted = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Taming 40-Minute CI",
            "answers": GOOD,
            "speaker_email": "editor@example.com",
            "speaker_name": "Edie Torres",
            "draft_token": token,
        },
    )
    assert submitted.status_code == 201, submitted.text
    return submitted.json()["code"], token


async def test_a_submitter_fixes_their_proposal_while_the_call_is_open(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, form = cfp
    code, token = await _submitted(client, event, form)

    status = await client.get(f"/v1/public/events/{event.slug}/submissions/{code}/status")
    assert status.json()["can_edit"] is True

    edited = await client.put(
        f"/v1/public/events/{event.slug}/submissions/{code}",
        json={"draft_token": token, "title": "Taming 40-Minute CI, properly", "answers": GOOD},
    )

    assert edited.status_code == 200, edited.text
    listed = await client.get(f"/v1/events/{event.id}/submissions", headers=headers)
    assert listed.json()["data"][0]["title"] == "Taming 40-Minute CI, properly"


async def test_the_code_alone_does_not_let_you_edit_somebody_elses_proposal(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """A code is a lookup key and deliberately not a secret, so it cannot be what
    authorises a write. The wrong token gets the same 404 as a wrong code —
    telling them apart is what would turn the code into a credential."""
    _headers, event, form = cfp
    code, _token = await _submitted(client, event, form)

    response = await client.put(
        f"/v1/public/events/{event.slug}/submissions/{code}",
        json={"draft_token": str(uuid.uuid4()), "title": "Hijacked", "answers": GOOD},
    )

    assert response.status_code == 404


async def test_the_deadline_closes_editing_as_well_as_submitting(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The refusal is the feature: an edit form left open over the deadline must
    not be able to save through it."""
    _headers, event, form = cfp
    code, token = await _submitted(client, event, form)
    with tenancy_disabled():
        live = await session.get(Form, form.id)
        assert live is not None
        live.closes_at = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()

    status = await client.get(f"/v1/public/events/{event.slug}/submissions/{code}/status")
    refused = await client.put(
        f"/v1/public/events/{event.slug}/submissions/{code}",
        json={"draft_token": token, "title": "Too late", "answers": GOOD},
    )

    assert status.json()["can_edit"] is False
    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "CFP_CLOSED"


async def test_editing_stops_once_a_reviewer_has_it(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """A reviewer who scored one abstract must not find a different one under
    their score."""
    _headers, event, form = cfp
    code, token = await _submitted(client, event, form)
    with tenancy_disabled():
        row = await session.scalar(select(Submission).where(Submission.code == code))
        assert row is not None
        row.status = SubmissionStatus.IN_REVIEW
        await session.commit()

    refused = await client.put(
        f"/v1/public/events/{event.slug}/submissions/{code}",
        json={"draft_token": token, "title": "Rewritten mid-review", "answers": GOOD},
    )

    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "SUBMISSION_LOCKED"


async def _submit(
    client: AsyncClient, event: Event, form: Form, *, title: str, name: str, email: str
) -> str:
    created = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": title,
            "answers": GOOD,
            "speaker_email": email,
            "speaker_name": name,
        },
    )
    assert created.status_code == 201, created.text
    return str(created.json()["code"])


async def test_search_matches_the_title_the_code_and_the_speaker(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """All three, because all three are what somebody has in front of them.

    The console filtered on these in the browser, over whatever slice it had
    fetched. Moving the list to the server would otherwise have quietly narrowed
    search to titles while the box went on looking the same.
    """
    headers, event, form = cfp
    code = await _submit(
        client, event, form, title="Taming CI", name="Priya Raman", email="priya@example.com"
    )
    await _submit(
        client, event, form, title="Caching Deeply", name="Jordan Alvarez", email="j@example.com"
    )

    async def search(term: str) -> list[str]:
        found = await client.get(
            f"/v1/events/{event.id}/submissions", params={"q": term}, headers=headers
        )
        assert found.status_code == 200, found.text
        return [row["title"] for row in found.json()["data"]]

    assert await search("taming") == ["Taming CI"]
    assert await search(code) == ["Taming CI"]
    assert await search("Alvarez") == ["Caching Deeply"]
    assert await search("nobody at all") == []


async def test_a_track_filter_narrows_the_list_and_the_total(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The count has to move with the rows.

    A filter that pages 25 of 608 while the total still says 608 is how a list
    lies about what it is showing.
    """
    headers, event, form = cfp
    await _submit(
        client, event, form, title="On the track", name="Priya Raman", email="priya@example.com"
    )
    await _submit(
        client, event, form, title="Off the track", name="Jordan Alvarez", email="j@example.com"
    )

    track_id = (
        await client.post(f"/v1/events/{event.id}/tracks", json={"name": "AI"}, headers=headers)
    ).json()["id"]

    listed = await client.get(f"/v1/events/{event.id}/submissions", headers=headers)
    target = next(row for row in listed.json()["data"] if row["title"] == "On the track")
    with tenancy_disabled():
        row = await session.get(Submission, uuid.UUID(target["id"]))
        assert row is not None
        row.track_id = uuid.UUID(track_id)
        await session.commit()

    filtered = await client.get(
        f"/v1/events/{event.id}/submissions",
        params={"filter[track_id]": track_id},
        headers=headers,
    )

    assert [r["title"] for r in filtered.json()["data"]] == ["On the track"]
    assert filtered.json()["meta"]["total"] == 1
