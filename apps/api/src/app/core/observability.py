"""Error reporting.

Sentry is optional and absent by default, the same shape as GitHub OAuth: with
no DSN the SDK is never initialised, the process opens no socket and reports
nothing, and `make setup && make dev` stays credential-free.

Two processes report, and they report for different reasons. The API's is the
ordinary one — an unhandled 500 is a stack trace nobody is standing next to.
The worker's is the reason this exists at all: its sweep failure path is a
`print` inside a loop deliberately written not to die, so a nightly job can fail
every night in a container nobody tails and look exactly like one that ran.
"""

from __future__ import annotations

import sentry_sdk
from sentry_sdk.types import Event, Hint

from app.core.config import Settings, get_settings

#: Headers that carry a credential. `send_default_pii=False` already withholds
#: bodies and user identity, and the SDK scrubs a denylist of its own — this
#: states the guarantee locally anyway, because "the default is safe" is a claim
#: about a dependency's behaviour, and dependencies change theirs.
_SCRUBBED_HEADERS = frozenset({"authorization", "cookie", "set-cookie", "x-api-key"})


def _scrub(event: Event, _hint: Hint) -> Event | None:
    request = event.get("request")
    if isinstance(request, dict):
        headers = request.get("headers")
        if isinstance(headers, dict):
            for name in list(headers):
                if name.lower() in _SCRUBBED_HEADERS:
                    headers[name] = "[redacted]"
    return event


def init_sentry(component: str, settings: Settings | None = None) -> bool:
    """Start error reporting for one process. Returns whether it started.

    `component` tags every event with the process that raised it. The API and
    the worker run the same image against the same DSN, and "this came from the
    sweep, not from a request" is the first thing worth knowing and the last
    thing a stack trace says.
    """
    resolved = settings if settings is not None else get_settings()
    if not resolved.sentry_dsn:
        return False

    sentry_sdk.init(
        dsn=resolved.sentry_dsn,
        environment=resolved.env,
        # This app stores speaker names, addresses, session tokens and the
        # contents of proposals under review. None of it belongs in a
        # third-party service to debug a stack trace, so the switch that would
        # send request bodies and user identity stays off, and stays written
        # down next to the reason.
        send_default_pii=False,
        traces_sample_rate=resolved.sentry_traces_sample_rate,
        before_send=_scrub,
    )
    sentry_sdk.set_tag("component", component)
    return True
