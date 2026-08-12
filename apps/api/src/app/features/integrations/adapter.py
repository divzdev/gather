"""The Accelevents side of the push.

There is one implementation and it talks to nobody. That is deliberate: the
brief asks for a one-way push to Accelevents, and `make setup && make dev` has
to produce a working, demonstrable app with **zero credentials**. A deterministic
adapter satisfies both — every operator surface (test the connection, read the
remote event name, dry run, execute, push again and watch it update rather than
duplicate) is exercisable end to end, against stable ids, with no account.

No Protocol wraps this yet. One implementation behind an interface is a rename,
not polymorphism; the seam to add when a live HTTP adapter exists is right here,
and adding it before that is the abstraction this codebase says not to build.
"""

from __future__ import annotations

import hashlib


def remote_id(kind: str, local_id: str) -> str:
    """A stable remote id for a local row.

    Derived rather than random so a dry run and the execute that follows it
    agree, and so re-running either is idempotent — which is the whole property
    the "push twice, get one record" test is checking.
    """
    digest = hashlib.sha256(f"accelevents:{kind}:{local_id}".encode()).hexdigest()
    return f"AE-{kind[:3].upper()}-{digest[:10].upper()}"


def describe_event(remote_event_id: str | None) -> dict[str, str]:
    """What "test connection" shows the operator.

    It returns the remote event's *name*, not just an OK, because the mistake
    this is guarding against is pushing a programme into the wrong event — and
    an operator can only catch that if they are shown what they are aimed at.
    """
    target = remote_event_id or "unconfigured"
    digest = hashlib.sha256(f"accelevents:event:{target}".encode()).hexdigest()
    return {
        "remote_event_id": target,
        "remote_event_name": f"DevFlow Conf 2027 (workspace {digest[:6].upper()})",
        "adapter": "deterministic",
    }
