"""The background worker.

A loop and a sleep, not a task queue. The only recurring work this product has is
a nightly sweep over deliverables, and a broker plus a scheduler plus their
supervision is a lot of moving parts to run one function once a day — the kind of
plumbing complexity the architecture rules say to refuse.

`make dev` starts this alongside the API and the web app, so it has to survive a
database that is not up yet and shut down cleanly on Ctrl-C.
"""

from __future__ import annotations

import asyncio
import contextlib
import signal
from datetime import UTC, datetime

from app.core.config import get_settings
from app.core.db import session_factory
from app.jobs import tasks

#: Long, because the work is a daily sweep and the floor inside it is 24 hours.
#: Shorter ticks would only re-read the same rows and skip them again.
INTERVAL_SECONDS = 3600
#: The first pass runs immediately so a developer sees output rather than
#: wondering whether the process is alive.
FIRST_RUN_DELAY = 2


async def run_once(*, remind: bool = True) -> tasks.SweepResult:
    async with session_factory() as session:
        result = await tasks.sweep(session, remind=remind)
        await session.commit()
    return result


async def loop(stop: asyncio.Event, *, interval: int = INTERVAL_SECONDS) -> None:
    await asyncio.sleep(FIRST_RUN_DELAY)
    while not stop.is_set():
        stamp = datetime.now(UTC).isoformat(timespec="seconds")
        try:
            result = await run_once()
            print(
                f"[worker {stamp}] {result.events} events · {result.overdue} overdue · "
                f"{result.reminded} reminded · {result.skipped} inside the 24h floor"
            )
        except Exception as error:  # noqa: BLE001 - a bad pass must not kill the worker
            # Printed rather than raised: the next tick may well succeed, and a
            # worker that exits on a transient database blip is worse than one
            # that says so and carries on.
            print(f"[worker {stamp}] sweep failed: {type(error).__name__}: {error}")

        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)


async def main() -> None:
    settings = get_settings()
    print(f"[worker] started, sweeping every {INTERVAL_SECONDS}s (env={settings.env})")

    stop = asyncio.Event()
    running = asyncio.get_running_loop()
    for name in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            running.add_signal_handler(name, stop.set)

    await loop(stop)
    print("[worker] stopped")


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(main())
