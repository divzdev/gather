"""Who the CFP's spam ceiling is counting.

The submission limit used to be keyed by IP alone, five an hour. An IP is not a
person: one office, one university lab, one co-working space or one mobile
carrier behind CGNAT all share a single address, so colleagues throttled each
other — worst in the hours before a deadline, which is when a company pushes its
speakers through at once.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models import Event, Form

# The open-CFP fixture, reused rather than rebuilt.
from test_cfp_flow import cfp  # noqa: F401

Cfp = tuple[dict[str, str], Event, Form]


async def _submit(client: AsyncClient, event: Event, form: Form, email: str) -> int:
    response = await client.post(
        f"/v1/public/events/{event.slug}/submissions",
        json={
            "form_id": str(form.id),
            "title": f"Proposal {uuid.uuid4().hex[:6]}",
            "answers": {"abstract": "A working account of something.", "format": "talk"},
            "speaker_email": email,
            "speaker_name": "Sam Rivera",
        },
    )
    return response.status_code


async def test_colleagues_on_one_address_do_not_throttle_each_other(
    client: AsyncClient, cfp: Cfp
) -> None:
    """The defect. Every request here shares a client IP, as four speakers from
    one company would."""
    _headers, event, form = cfp

    statuses = [
        await _submit(client, event, form, f"speaker{n}-{uuid.uuid4().hex[:6]}@example.com")
        for n in range(8)
    ]

    assert statuses == [201] * 8, (
        f"distinct speakers sharing one IP were throttled: {statuses}. "
        f"The submission ceiling is counting the network, not the submitter."
    )


async def test_one_speaker_still_cannot_flood_the_call(client: AsyncClient, cfp: Cfp) -> None:
    """The ceiling has to keep meaning something, or removing the IP key just
    removes the protection."""
    _headers, event, form = cfp
    email = f"prolific-{uuid.uuid4().hex[:6]}@example.com"

    statuses = [await _submit(client, event, form, email) for _ in range(7)]

    assert statuses[:5] == [201] * 5, f"a speaker was cut off early: {statuses}"
    assert statuses[5:] == [429, 429], f"a speaker submitted past the ceiling: {statuses}"


async def test_the_address_is_matched_regardless_of_case_or_padding(
    client: AsyncClient, cfp: Cfp
) -> None:
    """Otherwise the ceiling is one retype away from being no ceiling."""
    _headers, event, form = cfp
    local = f"shouty-{uuid.uuid4().hex[:6]}"

    for _ in range(5):
        assert await _submit(client, event, form, f"{local}@example.com") == 201

    assert await _submit(client, event, form, f"  {local.upper()}@EXAMPLE.COM  ") == 429
