"""The switches on the Form settings screen, and whether they do anything.

Four of them did not. The value went into `FormSchema.settings`, came back out
of the API, and was read by no server code — so an organiser could turn drafts
off, or admin alerts on, and nothing whatsoever changed. These tests are what
makes each one true.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import tenancy_disabled
from app.features.forms.schema import FormSchema, FormSettings
from app.models import (
    Event,
    EventStatus,
    Form,
    FormKind,
    Message,
    Organization,
    OrgMember,
    Role,
    User,
)

# ---------------------------------------------------------------------------
# The rule itself: a pure function over the schema, so it is tested directly.
# ---------------------------------------------------------------------------


def settings(**overrides: object) -> FormSettings:
    return FormSettings.model_validate(overrides)


def test_a_default_form_accepts_co_speakers_up_to_four() -> None:
    # The two defaults used to disagree — the roles editor said "disabled, 3",
    # the flags beside it said "allowed, 4" — and which one you believed
    # depended on whether you were the organiser or the speaker.
    assert settings().co_speaker_rule() == (0, 4)


def test_the_roles_editor_is_what_the_rule_reads() -> None:
    rule = settings(
        participant_roles=[
            {"key": "speaker", "label": "Speaker", "minimum": 1, "maximum": 1},
            {"key": "co_speaker", "label": "Co-speaker", "minimum": 1, "maximum": 2},
        ]
    ).co_speaker_rule()
    assert rule == (1, 2)


def test_disabling_the_co_speaker_role_allows_none() -> None:
    rule = settings(
        participant_roles=[
            {"key": "co_speaker", "label": "Co-speaker", "enabled": False, "maximum": 5},
        ]
    ).co_speaker_rule()
    assert rule == (0, 0)


def test_collecting_no_participants_overrides_the_roles() -> None:
    rule = settings(
        collect_participants=False,
        participant_roles=[{"key": "co_speaker", "label": "Co-speaker", "maximum": 5}],
    ).co_speaker_rule()
    assert rule == (0, 0)


def test_a_form_saved_before_roles_existed_still_means_something() -> None:
    # `participant_roles` has a default, so its absence has to be spelled out.
    assert settings(participant_roles=[], max_co_speakers=2).co_speaker_rule() == (0, 2)
    off = settings(participant_roles=[], allow_co_speakers=False, max_co_speakers=2)
    assert off.co_speaker_rule() == (0, 0)


# ---------------------------------------------------------------------------
# The HTTP boundary.
# ---------------------------------------------------------------------------

SCHEMA: dict[str, object] = {
    "sections": [
        {
            "key": "main",
            "title": "Proposal",
            "fields": [
                {"key": "abstract", "type": "long_text", "label": "Abstract", "required": True}
            ],
        }
    ],
    "logic": [],
    "settings": {},
}

ANSWERS = {"abstract": "A long enough abstract about builds."}


class Fixture:
    """One event with an open call, plus the addresses that should and should
    not hear about a submission."""

    def __init__(self, event: Event, form: Form, owner: str, admin: str, reviewer: str) -> None:
        self.event = event
        self.form = form
        self.owner = owner
        self.admin = admin
        self.reviewer = reviewer


@pytest.fixture
async def cfp(session: AsyncSession) -> Fixture:
    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        org = Organization(name=f"Org {suffix}", slug=f"org-{suffix}")
        session.add(org)
        await session.flush()
        event = Event(
            org_id=org.id,
            name="DevFlow Conf 2027",
            slug=f"switches-{suffix}",
            timezone="UTC",
            starts_on=datetime(2027, 5, 12).date(),
            ends_on=datetime(2027, 5, 14).date(),
            status=EventStatus.CFP_OPEN,
            cfp_closes_at=datetime.now(UTC) + timedelta(days=30),
        )
        session.add(event)
        await session.flush()
        form = Form(
            org_id=org.id, event_id=event.id, name="CFP", kind=FormKind.CFP, schema=dict(SCHEMA)
        )
        session.add(form)

        people = {
            Role.OWNER: f"owner-{suffix}@conf.test",
            Role.ADMIN: f"admin-{suffix}@conf.test",
            # A reviewer must never be told who submitted what: that is blind
            # review walked around by way of an inbox.
            Role.REVIEWER: f"reviewer-{suffix}@conf.test",
        }
        for role, address in people.items():
            user = User(email=address, name=role.value.title(), password_hash="x")
            session.add(user)
            await session.flush()
            session.add(OrgMember(org_id=org.id, user_id=user.id, role=role))
        await session.commit()

    return Fixture(
        event,
        form,
        people[Role.OWNER],
        people[Role.ADMIN],
        people[Role.REVIEWER],
    )


async def set_settings(session: AsyncSession, form: Form, **overrides: object) -> None:
    """Rewrite one form's settings, the way the builder's PATCH does."""
    with tenancy_disabled():
        row = await session.get(Form, form.id)
        assert row is not None
        schema = FormSchema.model_validate(row.schema)
        merged = schema.settings.model_dump()
        merged.update(overrides)
        schema.settings = FormSettings.model_validate(merged)
        row.schema = schema.model_dump(mode="json")
        await session.commit()


async def mail_for(session: AsyncSession, event: Event) -> list[Message]:
    with tenancy_disabled():
        rows = await session.scalars(select(Message).where(Message.event_id == event.id))
        return list(rows)


def draft_body(form: Form, **overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "form_id": str(form.id),
        "title": "A talk with a name",
        "answers": ANSWERS,
        "speaker_email": "drafter@example.org",
        "speaker_name": "Drafty McDraft",
        "co_speakers": [],
    }
    body.update(overrides)
    return body


def problem(response: object) -> dict[str, object]:
    """The error envelope, which nests everything under `error`."""
    return response.json()["error"]  # type: ignore[attr-defined,no-any-return]


# --- allow_drafts ----------------------------------------------------------


async def test_a_draft_is_refused_when_the_form_forbids_drafts(
    client: AsyncClient, session: AsyncSession, cfp: Fixture
) -> None:
    allowed = await client.post(
        f"/v1/public/events/{cfp.event.slug}/submissions/draft", json=draft_body(cfp.form)
    )
    assert allowed.status_code == 200, allowed.text

    await set_settings(session, cfp.form, allow_drafts=False)

    refused = await client.post(
        f"/v1/public/events/{cfp.event.slug}/submissions/draft",
        json=draft_body(cfp.form, speaker_email="second@example.org"),
    )
    assert refused.status_code == 403
    assert problem(refused)["code"] == "DRAFTS_DISABLED"
    # And it says why, in words, rather than only in a code.
    assert "one sitting" in problem(refused)["message"]


async def test_submitting_still_works_when_drafts_are_off(
    client: AsyncClient, session: AsyncSession, cfp: Fixture
) -> None:
    """`submit()` builds its row through `save_draft`, so a refusal placed one
    level too deep would take the whole call for papers down with it."""
    await set_settings(session, cfp.form, allow_drafts=False)

    made = await client.post(
        f"/v1/public/events/{cfp.event.slug}/submissions",
        json={
            "form_id": str(cfp.form.id),
            "title": "Completed in one sitting",
            "answers": ANSWERS,
            "speaker_email": "onesitting@example.org",
            "speaker_name": "One Sitting",
        },
    )
    assert made.status_code == 201, made.text


# --- notify_admins_on_submit ----------------------------------------------


async def test_admins_are_emailed_when_a_proposal_arrives(
    client: AsyncClient, session: AsyncSession, cfp: Fixture
) -> None:
    made = await client.post(
        f"/v1/public/events/{cfp.event.slug}/submissions",
        json={
            "form_id": str(cfp.form.id),
            "title": "Taming 40-Minute CI",
            "answers": ANSWERS,
            "speaker_email": "priya@example.org",
            "speaker_name": "Priya Raman",
        },
    )
    assert made.status_code == 201, made.text

    sent = await mail_for(session, cfp.event)
    to = {message.to_email for message in sent}
    assert cfp.owner in to
    assert cfp.admin in to
    assert cfp.reviewer not in to, "a reviewer was told who submitted what"
    # The speaker's own receipt is still sent, and is a different message.
    assert "priya@example.org" in to

    alert = next(message for message in sent if message.to_email == cfp.admin)
    assert "Taming 40-Minute CI" in alert.subject or "Taming 40-Minute CI" in alert.body_rendered
    assert made.json()["code"] in alert.body_rendered
    assert "Priya Raman" in alert.body_rendered


async def test_no_admin_is_emailed_when_the_switch_is_off(
    client: AsyncClient, session: AsyncSession, cfp: Fixture
) -> None:
    await set_settings(session, cfp.form, notify_admins_on_submit=False)

    made = await client.post(
        f"/v1/public/events/{cfp.event.slug}/submissions",
        json={
            "form_id": str(cfp.form.id),
            "title": "Quiet one",
            "answers": ANSWERS,
            "speaker_email": "quiet@example.org",
            "speaker_name": "Quiet Speaker",
        },
    )
    assert made.status_code == 201, made.text

    to = {message.to_email for message in await mail_for(session, cfp.event)}
    assert to == {"quiet@example.org"}, "the submitter's receipt is the only mail owed"


# --- confirm_participants --------------------------------------------------


async def test_co_speakers_are_confirmed_and_get_no_edit_token(
    client: AsyncClient, session: AsyncSession, cfp: Fixture
) -> None:
    made = await client.post(
        f"/v1/public/events/{cfp.event.slug}/submissions",
        json={
            "form_id": str(cfp.form.id),
            "title": "Two on stage",
            "answers": ANSWERS,
            "speaker_email": "lead@example.org",
            "speaker_name": "Lead Speaker",
            "co_speakers": [{"name": "Second Voice", "email": "second@example.org", "role": None}],
        },
    )
    assert made.status_code == 201, made.text

    sent = await mail_for(session, cfp.event)
    theirs = next(message for message in sent if message.to_email == "second@example.org")
    assert "Two on stage" in theirs.body_rendered
    assert "Lead Speaker" in theirs.body_rendered
    # The token authorises editing the proposal. A co-speaker did not write it
    # and is not handed the key to it.
    assert "?t=" not in theirs.body_rendered


async def test_the_submitter_is_confirmed_even_with_the_switch_off(
    client: AsyncClient, session: AsyncSession, cfp: Fixture
) -> None:
    """Turning participant confirmation off silences the co-speakers. It must
    not silence the receipt carrying the code the submitter needs forever."""
    await set_settings(session, cfp.form, confirm_participants=False)

    made = await client.post(
        f"/v1/public/events/{cfp.event.slug}/submissions",
        json={
            "form_id": str(cfp.form.id),
            "title": "Just me then",
            "answers": ANSWERS,
            "speaker_email": "lead2@example.org",
            "speaker_name": "Lead Two",
            "co_speakers": [{"name": "Silent One", "email": "silent@example.org", "role": None}],
        },
    )
    assert made.status_code == 201, made.text

    to = {message.to_email for message in await mail_for(session, cfp.event)}
    assert "lead2@example.org" in to
    assert "silent@example.org" not in to


# --- participant_roles enforced -------------------------------------------


async def test_more_co_speakers_than_the_form_allows_is_refused(
    client: AsyncClient, session: AsyncSession, cfp: Fixture
) -> None:
    await set_settings(
        session,
        cfp.form,
        participant_roles=[{"key": "co_speaker", "label": "Co-speaker", "maximum": 1}],
    )

    made = await client.post(
        f"/v1/public/events/{cfp.event.slug}/submissions",
        json={
            "form_id": str(cfp.form.id),
            "title": "A crowd",
            "answers": ANSWERS,
            "speaker_email": "crowd@example.org",
            "speaker_name": "Crowd Lead",
            "co_speakers": [
                {"name": "One", "email": "one@example.org", "role": None},
                {"name": "Two", "email": "two@example.org", "role": None},
            ],
        },
    )
    assert made.status_code == 422, made.text
    assert problem(made)["code"] == "VALIDATION_FAILED"
    assert "1" in str(problem(made)["message"])


async def test_fewer_co_speakers_than_required_is_refused(
    client: AsyncClient, session: AsyncSession, cfp: Fixture
) -> None:
    await set_settings(
        session,
        cfp.form,
        participant_roles=[
            {"key": "co_speaker", "label": "Co-speaker", "minimum": 1, "maximum": 3}
        ],
    )

    made = await client.post(
        f"/v1/public/events/{cfp.event.slug}/submissions",
        json={
            "form_id": str(cfp.form.id),
            "title": "Alone but shouldn't be",
            "answers": ANSWERS,
            "speaker_email": "alone@example.org",
            "speaker_name": "Alone",
            "co_speakers": [],
        },
    )
    assert made.status_code == 422, made.text
    assert problem(made)["code"] == "VALIDATION_FAILED"


async def test_the_public_form_is_told_the_resolved_rule(
    client: AsyncClient, session: AsyncSession, cfp: Fixture
) -> None:
    """The browser must not re-derive the rule, or it can disagree with the API
    about how many boxes to draw."""
    await set_settings(
        session,
        cfp.form,
        participant_roles=[
            {"key": "co_speaker", "label": "Co-speaker", "minimum": 1, "maximum": 2}
        ],
    )

    read = await client.get(f"/v1/public/events/{cfp.event.slug}/cfp-form")
    assert read.status_code == 200
    assert read.json()["co_speaker_min"] == 1
    assert read.json()["co_speaker_max"] == 2
