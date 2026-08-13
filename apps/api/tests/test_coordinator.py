"""The proposal's point of contact — a column that existed and nothing exposed."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.tenancy import tenancy_disabled
from app.models import Event, EventMember, Form, Role, Submission, SubmissionStatus, User
from test_cfp_flow import cfp  # noqa: F401

Cfp = tuple[dict[str, str], Event, Form]


async def _submission(session: AsyncSession, event: Event, form: Form) -> Submission:
    with tenancy_disabled():
        row = Submission(
            org_id=event.org_id,
            event_id=event.id,
            form_id=form.id,
            code=f"T{uuid.uuid4().hex[:5].upper()}",
            title="A talk that needs shepherding",
            answers={},
            status=SubmissionStatus.SUBMITTED,
        )
        session.add(row)
        await session.commit()
    return row


async def _staff(session: AsyncSession, event: Event, role: Role) -> User:
    with tenancy_disabled():
        user = User(
            email=f"staff-{uuid.uuid4().hex[:8]}@example.com",
            name="Casey Coordinator",
            password_hash=hash_password("irrelevant"),
            email_verified_at=datetime.now(UTC),
        )
        session.add(user)
        await session.flush()
        session.add(EventMember(org_id=event.org_id, event_id=event.id, user_id=user.id, role=role))
        await session.commit()
    return user


async def test_assigning_and_clearing_a_coordinator(
    client: AsyncClient, session: AsyncSession, cfp: Cfp
) -> None:
    headers, event, form = cfp
    submission = await _submission(session, event, form)
    coordinator = await _staff(session, event, Role.COORDINATOR)

    assigned = await client.patch(
        f"/v1/events/{event.id}/submissions/{submission.id}/coordinator",
        headers=headers,
        json={"coordinator_user_id": str(coordinator.id)},
    )
    assert assigned.status_code == 200
    assert assigned.json()["coordinator_user_id"] == str(coordinator.id)

    cleared = await client.patch(
        f"/v1/events/{event.id}/submissions/{submission.id}/coordinator",
        headers=headers,
        json={"coordinator_user_id": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["coordinator_user_id"] is None


async def test_a_reviewer_cannot_be_the_point_of_contact(
    client: AsyncClient, session: AsyncSession, cfp: Cfp
) -> None:
    headers, event, form = cfp
    submission = await _submission(session, event, form)
    reviewer = await _staff(session, event, Role.REVIEWER)

    response = await client.patch(
        f"/v1/events/{event.id}/submissions/{submission.id}/coordinator",
        headers=headers,
        json={"coordinator_user_id": str(reviewer.id)},
    )

    assert response.status_code == 422


async def test_an_outsider_cannot_be_the_point_of_contact(
    client: AsyncClient, session: AsyncSession, cfp: Cfp
) -> None:
    headers, event, form = cfp
    submission = await _submission(session, event, form)
    with tenancy_disabled():
        outsider = User(
            email=f"outsider-{uuid.uuid4().hex[:8]}@example.com",
            name="No Role At All",
            password_hash=hash_password("irrelevant"),
        )
        session.add(outsider)
        await session.commit()

    response = await client.patch(
        f"/v1/events/{event.id}/submissions/{submission.id}/coordinator",
        headers=headers,
        json={"coordinator_user_id": str(outsider.id)},
    )

    assert response.status_code == 422
