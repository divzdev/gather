"""Category-based routing: a category answer files the proposal under it.

The point of the feature is that "Track: Platform & Infra" on a form stops being
a string in a JSONB blob and becomes the event's actual track — so the
organiser's filter finds it and the agenda has a colour to draw without anyone
re-keying 200 proposals.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import tenancy_disabled
from app.features.forms.schema import FormSchema
from app.models import Event, Form, SessionFormat, Submission, Track

# The event-with-an-open-CFP fixture, reused rather than rebuilt.
from test_cfp_flow import cfp  # noqa: F401


def _schema(routes_to: str | None = "track", field_type: str = "select") -> dict:
    return {
        "sections": [
            {
                "key": "main",
                "title": "Session",
                "fields": [
                    {"key": "title", "type": "short_text", "label": "Title", "required": True},
                    {
                        "key": "track",
                        "type": field_type,
                        "label": "Track",
                        "routes_to": routes_to,
                        "choices": [
                            {"value": "plat", "label": "Platform & Infra"},
                            {"value": "ai", "label": "AI Engineering"},
                        ],
                    },
                ],
            }
        ]
    }


def test_only_a_choice_field_can_carry_a_category() -> None:
    with pytest.raises(ValueError, match="only a choice field"):
        FormSchema.model_validate(_schema(field_type="short_text"))


def test_two_fields_cannot_route_to_the_same_target() -> None:
    schema = _schema()
    schema["sections"][0]["fields"].append(
        {
            "key": "track_again",
            "type": "select",
            "label": "Track",
            "routes_to": "track",
            "choices": [{"value": "x", "label": "X"}],
        }
    )
    with pytest.raises(ValueError, match="all route to track"):
        FormSchema.model_validate(schema)


def test_a_field_routes_to_nothing_by_default() -> None:
    assert FormSchema.model_validate(_schema(routes_to=None)).field("track").routes_to is None


async def _tracks(session: AsyncSession, event: Event) -> None:
    with tenancy_disabled():
        for name in ["Platform & Infra", "AI Engineering"]:
            session.add(Track(org_id=event.org_id, event_id=event.id, name=name))
        session.add(
            SessionFormat(org_id=event.org_id, event_id=event.id, name="Lightning Talk (10 min)")
        )
        await session.commit()


async def _submit(client: AsyncClient, event: Event, form: Form, answers: dict) -> str:
    response = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": "Taming 40-Minute CI",
            "answers": {"title": "Taming 40-Minute CI", **answers},
            "speaker_email": f"{uuid.uuid4().hex}@example.com",
            "speaker_name": "Priya Raman",
        },
    )
    assert response.status_code == 201, response.text
    return str(response.json()["code"])


async def _set_schema(session: AsyncSession, form: Form, schema: dict) -> None:
    with tenancy_disabled():
        found = await session.get(Form, form.id)
        assert found is not None
        found.schema = schema
        await session.commit()


async def test_the_chosen_category_becomes_the_submissions_track(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _, event, form = cfp
    await _tracks(session, event)
    await _set_schema(session, form, _schema())

    code = await _submit(client, event, form, {"track": "plat"})

    with tenancy_disabled():
        row = await session.scalar(select(Submission).where(Submission.code == code))
        track = await session.get(Track, row.track_id) if row and row.track_id else None
    assert track is not None, "the proposal was not filed under any track"
    assert track.name == "Platform & Infra"


async def test_a_category_that_matches_nothing_leaves_the_proposal_unfiled(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _, event, form = cfp
    await _tracks(session, event)
    schema = _schema()
    schema["sections"][0]["fields"][1]["choices"].append({"value": "ufo", "label": "Not A Track"})
    await _set_schema(session, form, schema)

    code = await _submit(client, event, form, {"track": "ufo"})

    with tenancy_disabled():
        row = await session.scalar(select(Submission).where(Submission.code == code))
    assert row is not None and row.track_id is None


async def test_matching_survives_case_and_spacing_drift(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The two lists are maintained on different screens, so they will drift."""
    _, event, form = cfp
    await _tracks(session, event)
    schema = _schema()
    schema["sections"][0]["fields"][1]["choices"] = [
        {"value": "plat", "label": "  platform &   infra "}
    ]
    await _set_schema(session, form, schema)

    code = await _submit(client, event, form, {"track": "plat"})

    with tenancy_disabled():
        row = await session.scalar(select(Submission).where(Submission.code == code))
        track = await session.get(Track, row.track_id) if row and row.track_id else None
    assert track is not None and track.name == "Platform & Infra"


async def test_a_format_field_routes_to_the_session_format(
    client: AsyncClient, session: AsyncSession, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    _, event, form = cfp
    await _tracks(session, event)
    schema = _schema()
    schema["sections"][0]["fields"][1] = {
        "key": "format",
        "type": "select",
        "label": "Format",
        "routes_to": "session_format",
        "choices": [{"value": "lt", "label": "Lightning Talk (10 min)"}],
    }
    await _set_schema(session, form, schema)

    code = await _submit(client, event, form, {"format": "lt"})

    with tenancy_disabled():
        row = await session.scalar(select(Submission).where(Submission.code == code))
        fmt = (
            await session.get(SessionFormat, row.session_format_id)
            if row and row.session_format_id
            else None
        )
    assert fmt is not None and fmt.name == "Lightning Talk (10 min)"
