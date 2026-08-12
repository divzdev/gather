"""Role resolution and the default-deny gate.

engineering-brief §4.7: the per-event role wins over the org default, and a caller
with neither has no access at all.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_role, resolve_role
from app.core.security import hash_password
from app.core.tenancy import tenancy_disabled
from app.models import Event, EventMember, Organization, OrgMember, Role, User


async def _make_user(session: AsyncSession, label: str) -> User:
    user = User(
        email=f"{label}-{uuid.uuid4().hex[:8]}@example.com",
        name=label,
        password_hash=hash_password("irrelevant"),
        email_verified_at=datetime.now(UTC),
    )
    session.add(user)
    await session.flush()
    return user


async def test_org_role_applies_to_the_orgs_events(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    org_a, _ = two_orgs
    with tenancy_disabled():
        user = await _make_user(session, "coordinator")
        session.add(OrgMember(org_id=org_a.id, user_id=user.id, role=Role.COORDINATOR))
        await session.flush()
        event = await session.scalar(select(Event).where(Event.org_id == org_a.id))
        assert event is not None

        assert await resolve_role(session, user.id, event.id) == Role.COORDINATOR


async def test_event_role_overrides_the_org_role(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    org_a, _ = two_orgs
    with tenancy_disabled():
        user = await _make_user(session, "reviewer")
        session.add(OrgMember(org_id=org_a.id, user_id=user.id, role=Role.REVIEWER))
        await session.flush()
        event = await session.scalar(select(Event).where(Event.org_id == org_a.id))
        assert event is not None
        session.add(
            EventMember(org_id=org_a.id, event_id=event.id, user_id=user.id, role=Role.ADMIN)
        )
        await session.flush()

        assert await resolve_role(session, user.id, event.id) == Role.ADMIN


async def test_a_member_of_another_org_has_no_role(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    """The cross-tenant case: membership in org B grants nothing on org A's event."""
    org_a, org_b = two_orgs
    with tenancy_disabled():
        outsider = await _make_user(session, "outsider")
        session.add(OrgMember(org_id=org_b.id, user_id=outsider.id, role=Role.OWNER))
        await session.flush()
        event_a = await session.scalar(select(Event).where(Event.org_id == org_a.id))
        assert event_a is not None

        assert await resolve_role(session, outsider.id, event_a.id) is None


async def test_no_membership_means_no_role(
    session: AsyncSession, two_orgs: tuple[Organization, Organization]
) -> None:
    org_a, _ = two_orgs
    with tenancy_disabled():
        stranger = await _make_user(session, "stranger")
        await session.flush()
        event = await session.scalar(select(Event).where(Event.org_id == org_a.id))
        assert event is not None

        assert await resolve_role(session, stranger.id, event.id) is None


async def test_unknown_event_resolves_to_no_role(session: AsyncSession) -> None:
    with tenancy_disabled():
        user = await _make_user(session, "someone")
        await session.flush()

        assert await resolve_role(session, user.id, uuid.uuid4()) is None


def test_require_role_with_no_roles_refuses_to_build() -> None:
    """Fail closed at import time: a route that names no role must not admit everyone."""
    with pytest.raises(ValueError, match="at least one role"):
        require_role()
