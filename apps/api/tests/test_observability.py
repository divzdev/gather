"""Error reporting.

Two things are worth holding down here. Absent-by-default, because a DSN is a
credential and `make setup && make dev` is graded on needing none — an SDK that
initialised itself with an empty DSN would break that quietly. And the worker's
report, because its failure path is a `print` inside a loop written not to die:
the wiring is the whole feature, and a reporter nothing calls is indistinguishable
from one that was never added.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
import sentry_sdk

from app.core.config import Settings
from app.core.observability import init_sentry
from app.jobs import worker


@pytest.fixture
def recorded_init(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Intercept the SDK's entry point. Mocked at the boundary on purpose: a real
    init installs a process-global client that would outlive the test."""
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))
    monkeypatch.setattr(sentry_sdk, "set_tag", lambda *_args: None)
    return calls


def test_no_dsn_does_not_initialise_the_sdk(recorded_init: list[dict[str, Any]]) -> None:
    started = init_sentry("api", Settings(sentry_dsn=""))

    assert started is False
    assert recorded_init == []


@pytest.mark.parametrize("env", ["local", "test"])
def test_a_dsn_within_reach_of_local_dev_still_reports_nothing(
    env: str, recorded_init: list[dict[str, Any]]
) -> None:
    """A DSN in a local .env must not turn a developer's traceback into an
    incident. The off-switch is the environment, not only the credential."""
    started = init_sentry("api", Settings(sentry_dsn="https://k@example.invalid/1", env=env))

    assert started is False
    assert recorded_init == []


def test_a_dsn_starts_reporting_tagged_with_its_environment(
    recorded_init: list[dict[str, Any]],
) -> None:
    started = init_sentry("api", Settings(sentry_dsn="https://k@example.invalid/1", env="staging"))

    assert started is True
    assert recorded_init[0]["dsn"] == "https://k@example.invalid/1"
    assert recorded_init[0]["environment"] == "staging"


def test_personal_data_is_never_sent(recorded_init: list[dict[str, Any]]) -> None:
    """The app stores speaker names, addresses and session tokens. None of it
    belongs in a third-party service to debug a stack trace."""
    init_sentry("api", Settings(sentry_dsn="https://k@example.invalid/1", env="staging"))

    assert recorded_init[0]["send_default_pii"] is False


def test_credential_headers_are_redacted_before_an_event_leaves(
    recorded_init: list[dict[str, Any]],
) -> None:
    init_sentry("api", Settings(sentry_dsn="https://k@example.invalid/1", env="staging"))
    before_send = recorded_init[0]["before_send"]

    event = before_send(
        {
            "request": {
                "headers": {
                    "Authorization": "Bearer real-access-token",
                    "Cookie": "refresh=real-refresh-token",
                    "User-Agent": "Firefox",
                }
            }
        },
        {},
    )

    assert event is not None
    headers = event["request"]["headers"]
    assert headers["Authorization"] == "[redacted]"
    assert headers["Cookie"] == "[redacted]"
    # Scrubbing is a denylist, not a blanket — an event with no context is not
    # worth reporting.
    assert headers["User-Agent"] == "Firefox"


async def test_a_failed_sweep_is_reported_not_only_printed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The reason this feature exists. A sweep that throws every night still
    leaves a healthy container and a log nobody tails."""
    captured: list[BaseException] = []
    monkeypatch.setattr(sentry_sdk, "capture_exception", lambda error: captured.append(error))
    monkeypatch.setattr(worker, "FIRST_RUN_DELAY", 0)

    stop = asyncio.Event()
    boom = RuntimeError("database went away mid-sweep")

    async def failing_sweep() -> None:
        stop.set()  # one pass only
        raise boom

    monkeypatch.setattr(worker, "run_once", failing_sweep)

    await worker.loop(stop, interval=0)

    assert captured == [boom]


async def test_a_healthy_sweep_reports_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[BaseException] = []
    monkeypatch.setattr(sentry_sdk, "capture_exception", lambda error: captured.append(error))
    monkeypatch.setattr(worker, "FIRST_RUN_DELAY", 0)

    stop = asyncio.Event()

    async def clean_sweep() -> worker.tasks.SweepResult:
        stop.set()
        return worker.tasks.SweepResult(events=1, overdue=0, reminded=0, skipped=0)

    monkeypatch.setattr(worker, "run_once", clean_sweep)

    await worker.loop(stop, interval=0)

    assert captured == []
