"""Turning an approved proposal into rows — the one place AI output reaches a table.

And it does not, quite: by the time anything is written, the model's output has
been through `write_catalog.parse` twice — once when the card was drawn, once
here — and what actually runs is `create_resource` / `update_resource`, the same
functions the setup screens run, in this request's transaction, under this
caller's identity and tenancy.

Two rules shape everything below.

**The stored proposal is untrusted input.** It has been sitting in a database
since it was written; that we generated it does not make it safe to replay. It is
re-validated against the resource's real schema, and an update's target is
resolved again, so a proposal for a row that has since been renamed fails rather
than landing on whatever now answers to that name.

**Every action succeeds or fails alone.** A batch of three where the middle name
is already taken applies the other two — anything else would make a one-line
mistake cost the whole reply.
"""

from __future__ import annotations

import uuid
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import crud
from app.core.errors import ApiError
from app.features.ai import write_catalog
from app.features.ai.schemas import AppliedAction
from app.models import AiProposal, AiProposalKind, AiProposalStatus

__all__ = ["Applied", "apply"]


#: One action's outcome. The API schema is the return type — there is no second
#: shape to keep in step.
Applied = AppliedAction


def _actions(proposal: AiProposal) -> list[dict[str, Any]]:
    """The stored actions, **deep-copied**, which is load-bearing rather than tidy.

    JSONB is not tracked for in-place mutation. Editing the stored dicts and then
    reassigning `output` leaves SQLAlchemy comparing the new value against a
    committed snapshot that shares those same objects — so the two are equal, no
    UPDATE is emitted, and every status written here is silently lost. Copying
    first keeps the snapshot as it was loaded, so the reassignment is a real
    change. (Found by a test that applied the same action twice and got two rooms.)
    """
    stored = proposal.output.get("actions")
    if not isinstance(stored, list):
        raise ApiError(
            "That suggestion has no changes to apply.", code="AI_NOT_APPLICABLE", status_code=422
        )
    return [deepcopy(action) for action in stored if isinstance(action, dict)]


async def _apply_one(session: AsyncSession, action: dict[str, Any], index: int) -> Applied:
    """One action, re-validated and written. Its own failure, nobody else's."""
    try:
        parsed = write_catalog.parse(
            str(action.get("name", "")),
            {"target": action.get("target"), "values": action.get("values") or {}},
        )
    except (write_catalog.UnknownActionError, write_catalog.BadArgsError) as bad:
        return Applied(index=index, status="failed", error=str(bad))

    spec = parsed.action.spec
    try:
        # A SAVEPOINT per action, and this is what makes "fails alone" true
        # rather than aspirational. A duplicate name raises `IntegrityError`,
        # which aborts the *whole* Postgres transaction — without this, the
        # second of three creates would take the first one down with it and
        # every action after it would fail on a poisoned transaction.
        async with session.begin_nested():
            if parsed.action.verb == "create":
                row = await crud.create_resource(session, spec, parsed.values)
            else:
                assert parsed.target is not None  # `parse` refuses an update without one
                found = await write_catalog.resolve(session, spec, parsed.target)
                if found.target is None:
                    # Re-resolved rather than trusted: the row may have been
                    # renamed or removed since the card was drawn.
                    raise ApiError(
                        f"No {spec.singular} called {parsed.target!r} any more — "
                        "it may have been renamed since this was suggested.",
                        code="AI_TARGET_GONE",
                        status_code=422,
                    )
                row = await crud.update_resource(
                    session,
                    spec,
                    await crud.get_resource(session, spec, found.target.id),
                    parsed.values,
                )
    except ApiError as refusal:
        # The resource's own sentence — a duplicate name, a day outside the
        # event — which is exactly what the setup screen would have said.
        return Applied(index=index, status="failed", error=refusal.message)

    return Applied(
        index=index,
        status="applied",
        id=row.id,
        label=str(getattr(row, spec.label_column)),
    )


def _resolution(actions: list[dict[str, Any]]) -> AiProposalStatus:
    """`accepted` only when nothing is left to press.

    A proposal with two of three applied is not finished and not abandoned, and
    `partially_accepted` is the status this table already had for exactly that.
    """
    states = {str(action.get("status")) for action in actions}
    if states == {"applied"}:
        return AiProposalStatus.ACCEPTED
    if "applied" in states:
        return AiProposalStatus.PARTIALLY_ACCEPTED
    return AiProposalStatus.READY


async def apply(
    session: AsyncSession, *, proposal: AiProposal, indexes: list[int]
) -> list[Applied]:
    """Apply the named actions of one proposal. The only caller is the route."""
    if proposal.kind is not AiProposalKind.PROGRAM_CHANGE:
        raise ApiError(
            "That suggestion is not a program change.",
            code="AI_NOT_APPLICABLE",
            status_code=422,
        )
    if proposal.status is AiProposalStatus.DISCARDED:
        # Discarding is what "no, not that" means. Checking only `kind` left a
        # thrown-away suggestion fully appliable, which is the opposite of what
        # pressing Discard promises.
        raise ApiError(
            "That suggestion was discarded.",
            code="AI_DISCARDED",
            status_code=409,
        )

    actions = _actions(proposal)
    unknown = [index for index in indexes if not 0 <= index < len(actions)]
    if unknown:
        raise ApiError(
            f"This suggestion has {len(actions)} change(s); there is no change {unknown[0]}.",
            code="AI_NO_SUCH_ACTION",
            status_code=422,
        )

    # Two presses of the same button land as two requests, and the idempotency
    # check below is read-then-write. Without this both read `proposed` and both
    # try to create; the second gets the duplicate-name error rather than the
    # "already done" it should. Transaction-scoped, released on commit, and
    # keyed on this proposal, so it blocks nothing else.
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext('ai_apply'), hashtext(:proposal))"),
        {"proposal": str(proposal.id)},
    )
    await session.refresh(proposal)
    actions = _actions(proposal)

    results: list[Applied] = []
    for index in indexes:
        action = actions[index]
        if action.get("status") == "applied":
            # Idempotent by design (story 25): a double-click, or a retry on a
            # flaky connection, must not make a second room.
            applied_id = action.get("applied_id")
            results.append(
                Applied(
                    index=index,
                    status="applied",
                    id=uuid.UUID(str(applied_id)) if applied_id else None,
                    label=action.get("applied_label"),
                )
            )
            continue

        outcome = await _apply_one(session, action, index)
        action["status"] = outcome.status
        action["applied_id"] = None if outcome.id is None else str(outcome.id)
        action["applied_label"] = outcome.label
        action["error"] = outcome.error
        results.append(outcome)

    # Reassigned, never mutated in place — see `_actions` for why both halves of
    # that are necessary.
    proposal.output = {**proposal.output, "actions": actions}
    proposal.status = _resolution(actions)
    if proposal.status is AiProposalStatus.ACCEPTED:
        proposal.resolved_at = datetime.now(UTC)
    await session.flush()
    return results
