"""The speaker roster and its bulk paths."""

from __future__ import annotations

from httpx import AsyncClient

from app.models import Event, Form

# The event-with-an-open-CFP fixture, reused rather than rebuilt.
from test_cfp_flow import cfp  # noqa: F401

CSV = (
    "name,email,company\n"
    "Rosa Lindqvist,rosa@northbound.example,Northbound Systems\n"
    "Tomas Eriksen,tomas@harbourlabs.example,Harbour Labs\n"
    ",missing@example.com,No Name Co\n"
    "Broken Row,not-an-email,\n"
)


async def test_importing_a_csv_reports_every_row_it_could_not_use(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _form = cfp

    response = await client.post(
        f"/v1/events/{event.id}/speakers/import",
        headers=headers,
        files={"file": ("speakers.csv", CSV, "text/csv")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["created"] == 2
    assert body["skipped"] == 2
    # A single bad line should not cost the other rows, and the operator needs to
    # know which lines to fix.
    assert any("Row 4" in message for message in body["errors"])
    assert any("Row 5" in message for message in body["errors"])


async def test_importing_the_same_person_twice_does_not_duplicate_them(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    """The roster is a directory: matching is by email inside the organisation,
    so last year's speaker is found rather than added again."""
    headers, event, _form = cfp

    await client.post(
        f"/v1/events/{event.id}/speakers/import",
        headers=headers,
        files={"file": ("speakers.csv", CSV, "text/csv")},
    )
    await client.post(
        f"/v1/events/{event.id}/speakers/import",
        headers=headers,
        files={"file": ("speakers.csv", CSV, "text/csv")},
    )

    roster = await client.get(f"/v1/events/{event.id}/speakers", headers=headers)
    emails = [row["email"] for row in roster.json()]

    assert len(emails) == len(set(emails))
    assert emails.count("rosa@northbound.example") == 1


async def test_a_file_without_an_email_column_is_refused(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _form = cfp

    response = await client.post(
        f"/v1/events/{event.id}/speakers/import",
        headers=headers,
        files={"file": ("speakers.csv", "name,company\nRosa,Northbound\n", "text/csv")},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


async def test_the_roster_exports_as_csv(
    client: AsyncClient, cfp: tuple[dict[str, str], Event, Form]
) -> None:
    headers, event, _form = cfp
    await client.post(
        f"/v1/events/{event.id}/speakers/import",
        headers=headers,
        files={"file": ("speakers.csv", CSV, "text/csv")},
    )

    response = await client.get(f"/v1/events/{event.id}/speakers/export.csv", headers=headers)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "rosa@northbound.example" in response.text
