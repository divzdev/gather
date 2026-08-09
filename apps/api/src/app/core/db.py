from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Importing this module is what registers the tenancy event listeners. It lives
# here, not in main.py, so that holding a session and having tenant filtering are
# the same act — an entrypoint that forgot the import would otherwise run with
# multi-tenancy silently disabled.
from app.core import tenancy as _tenancy  # noqa: F401
from app.core.config import get_settings

_settings = get_settings()

engine = create_async_engine(
    _settings.database_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=10,
    echo=False,
)

session_factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """One transaction per request: commit on clean exit, roll back on any exception.

    SSE routes must NOT depend on this. A `yield` dependency tears down only after
    the response completes, which for a StreamingResponse means after the final
    token — pinning a connection for the whole model call and exhausting the pool.
    Those routes open short-lived sessions from `session_factory` instead.
    Streaming routes open short-lived sessions from `session_factory` instead.
    """
    async with session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        else:
            await session.commit()
