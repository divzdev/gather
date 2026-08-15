"""Test wiring.

Everything here is per-run rather than shared. One machine can have several
suites going at once — this one, a Playwright run against the dev API, another
agent's — and every shared name between them is a way for one run to corrupt
another's results. A single `gather_test` meant two runs raced to drop and
recreate the same schema and deadlocked before either executed a test; a single
`ratelimit:` namespace meant clearing counters cleared everybody's.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable
from datetime import UTC, date, datetime

#: Set before anything imports app config, which caches settings on first read.
RUN_ID = os.environ.get("PYTEST_RUN_ID", str(os.getpid()))
os.environ["RATE_LIMIT_PREFIX"] = f"ratelimit-test-{RUN_ID}"

import asyncpg  # noqa: E402
import pytest  # noqa: E402
from httpx import AsyncClient  # noqa: E402
from sqlalchemy import text as sa_text  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.models import Base, Event, EventStatus, Organization, User  # noqa: E402

# Tests never touch the development database.
DEV_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://gather:gather@localhost:5441/gather",
)
TEST_DB = f"gather_test_{RUN_ID}"
_ADMIN_DSN = DEV_URL.replace("postgresql+asyncpg://", "postgresql://").rsplit("/", 1)[0]
TEST_URL = f"{DEV_URL.rsplit('/', 1)[0]}/{TEST_DB}"


async def _ensure_test_database() -> None:
    conn = await asyncpg.connect(f"{_ADMIN_DSN}/postgres")
    try:
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", TEST_DB)
        if not exists:
            # Identifier cannot be parameterised; TEST_DB is a module constant.
            await conn.execute(f'CREATE DATABASE "{TEST_DB}"')
    finally:
        await conn.close()

    conn = await asyncpg.connect(f"{_ADMIN_DSN}/{TEST_DB}")
    try:
        await conn.execute("CREATE EXTENSION IF NOT EXISTS citext")
    finally:
        await conn.close()


async def _drop_test_database() -> None:
    conn = await asyncpg.connect(f"{_ADMIN_DSN}/postgres")
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
    finally:
        await conn.close()


@pytest.fixture(scope="session")
async def engine() -> AsyncGenerator[object, None]:
    """A database of this run's own, created empty and dropped after.

    No `drop_all` on the way in: the database is new, so there is nothing to
    drop, and dropping is what two concurrent runs used to deadlock on.
    """
    await _ensure_test_database()
    eng = create_async_engine(TEST_URL, pool_pre_ping=True)
    async with eng.begin() as conn:
        # `create_all` builds tables from the models and knows nothing about
        # anything a migration did by hand. `pg_trgm` is one of those, and
        # without it duplicate detection fails here while working everywhere
        # else — the worst kind of divergence between the suite and reality.
        await conn.execute(sa_text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()
    await _drop_test_database()


@pytest.fixture
async def session(engine: object) -> AsyncGenerator[AsyncSession, None]:
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)  # type: ignore[arg-type]
    async with factory() as s:
        yield s
        await s.rollback()


@pytest.fixture
async def client(engine: object) -> AsyncGenerator[AsyncClient, None]:
    """Drives the real app: real Postgres, real Redis, real dependency graph.

    Only the session factory is redirected at the test database — nothing else is
    stubbed, so the tests exercise the wiring a request actually goes through.
    """
    from httpx import ASGITransport

    from app.core import db as db_module
    from app.main import create_app

    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)  # type: ignore[arg-type]

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as s:
            try:
                yield s
            except Exception:
                await s.rollback()
                raise
            else:
                await s.commit()

    app = create_app()
    app.dependency_overrides[db_module.get_db] = override_get_db

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


@pytest.fixture
async def caller_from(
    engine: object,
) -> AsyncGenerator[Callable[[str], Awaitable[AsyncClient]], None]:
    """Build request clients that appear to come from a chosen address.

    The `client` fixture hard-codes one source address, so "two different callers
    get two separate buckets" — the whole point of an IP-keyed rate limit — is not
    expressible through it. Everything else matches `client`.
    """
    from contextlib import AsyncExitStack

    from httpx import ASGITransport

    from app.core import db as db_module
    from app.main import create_app

    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)  # type: ignore[arg-type]

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as s:
            try:
                yield s
            except Exception:
                await s.rollback()
                raise
            else:
                await s.commit()

    app = create_app()
    app.dependency_overrides[db_module.get_db] = override_get_db

    async with AsyncExitStack() as stack:
        await stack.enter_async_context(app.router.lifespan_context(app))

        async def build(ip: str) -> AsyncClient:
            transport = ASGITransport(app=app, client=(ip, 40000))
            return await stack.enter_async_context(
                AsyncClient(transport=transport, base_url="http://test")
            )

        yield build


@pytest.fixture(autouse=True)
async def _clear_rate_limits() -> AsyncGenerator[None, None]:
    """Rate-limit counters live in Redis and would leak between tests.

    Only this run's counters. The pattern used to be `ratelimit:*`, which also
    reset the dev API's and any Playwright run's — so a browser suite sweeping
    on a timer could clear the budget a login test was mid-way through
    asserting, and the failure landed wherever the timer happened to fall.
    """
    import redis.asyncio as aioredis

    from app.core.config import get_settings

    settings = get_settings()
    redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    keys = [k async for k in redis.scan_iter(f"{settings.rate_limit_prefix}:*")]
    if keys:
        await redis.delete(*keys)
    yield
    await redis.aclose()


@pytest.fixture
async def staff_user(session: AsyncSession) -> User:
    from app.core.security import hash_password
    from app.core.tenancy import tenancy_disabled

    with tenancy_disabled():
        user = User(
            email=f"organizer-{uuid.uuid4().hex[:8]}@example.com",
            name="Ada Organizer",
            password_hash=hash_password("correct horse battery staple"),
            # The default staff fixture is a fully set-up organizer, so it can
            # send and publish. Tests that care about the unverified state build
            # their own user; see test_auth_verification.py.
            email_verified_at=datetime.now(UTC),
        )
        session.add(user)
        await session.commit()
    return user


@pytest.fixture
async def two_orgs(session: AsyncSession) -> tuple[Organization, Organization]:
    """Two organizations, one event each. The fixture every leak test builds on."""
    from app.core.tenancy import tenancy_disabled

    suffix = uuid.uuid4().hex[:8]
    with tenancy_disabled():
        org_a = Organization(name="Alpha Conf", slug=f"alpha-{suffix}")
        org_b = Organization(name="Beta Conf", slug=f"beta-{suffix}")
        session.add_all([org_a, org_b])
        await session.flush()

        session.add_all(
            [
                # A wide window on purpose. Event days are now bounded by it, and
                # the program tests place days across a fortnight — a three-day
                # fixture would make them fail for a reason that has nothing to
                # do with what they are testing. May 2027 matches the dates the
                # rest of the suite already builds its own events around.
                # Named for its month as well as its year: `test_tenancy` builds
                # a second org_a event called "Alpha 2027" to prove event-level
                # scoping, and a fixture sharing that slug collides with it.
                Event(
                    org_id=org_a.id,
                    name="Alpha May 2027",
                    slug="alpha-may-2027",
                    timezone="America/Los_Angeles",
                    starts_on=date(2027, 5, 10),
                    ends_on=date(2027, 5, 22),
                    status=EventStatus.CFP_OPEN,
                ),
                Event(
                    org_id=org_b.id,
                    name="Beta 2026",
                    slug="beta-2026",
                    timezone="Europe/Berlin",
                    starts_on=date(2026, 10, 1),
                    ends_on=date(2026, 10, 2),
                    status=EventStatus.CFP_OPEN,
                ),
            ]
        )
        # Committed, not flushed: the API client runs on its own session and would
        # not otherwise see this data.
        await session.commit()

    return org_a, org_b
