"""The contract between the model and the program: what it may *propose*.

Sibling of `catalog.py`, which holds the reads. The difference between them is
the whole of spec 0008: an entry here does not execute. It produces a description
of a change, which becomes a row in `ai_proposals` and a card on a screen, and
stays inert until a human presses a button.

Three properties are load-bearing, and each one is a test in
`test_ai_write_catalog.py`:

**Eight entries, create and update only.** No delete exists to be reached. That
is a stronger guarantee than a confirmation dialog, because there is no code path
to talk anybody past.

**The resource describes itself.** Fields, bounds and defaults come from
`RoomCreate` and its siblings — the same schemas the setup screens post to — so
the prompt cannot advertise a column the writer would refuse, and a field added
to a resource needs no edit here.

**No primary key ever reaches the model.** An update names its target with a
string the organiser typed; resolving that string to a row happens here, in the
request's tenancy, and the candidate list offered back to the model is names.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ValidationError
from sqlalchemy import Text, cast, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import ResourceSpec
from app.features.ai.catalog import arg_spec
from app.features.program.resources import EVENT_DAY, ROOM, SESSION_FORMAT, TRACK

__all__ = [
    "ACTIONS",
    "Action",
    "BadArgsError",
    "Parsed",
    "Resolution",
    "UnknownActionError",
    "describe",
    "offer",
    "parse",
    "resolve",
]

#: How many existing rows are ever named back — in a refusal, or in the list the
#: resolution call chooses from. A conference has a handful of rooms and a dozen
#: tracks; a list longer than this is a sign the question was not about one row.
MAX_CANDIDATES = 25


class UnknownActionError(ValueError):
    """The model named an action that does not exist. Dropped, never attempted."""


class BadArgsError(ValueError):
    """The model's arguments do not fit the resource. Dropped, never attempted."""


@dataclass(frozen=True, slots=True)
class Action:
    """One proposable change: what it is called, what it does, what it touches."""

    name: str
    verb: Literal["create", "update"]
    spec: ResourceSpec
    #: Written for the planner prompt, which is the only thing telling the model
    #: when this action is the right one. Write it for a reader who cannot see
    #: the code.
    purpose: str

    @property
    def schema(self) -> type[BaseModel]:
        return self.spec.create_schema if self.verb == "create" else self.spec.update_schema


def _actions() -> dict[str, Action]:
    """Create and update for each resource, built from the specs themselves so a
    fifth resource is one line in `resources.py` and nothing here."""
    built: dict[str, Action] = {}
    for spec, noun in (
        (ROOM, "room"),
        (TRACK, "track"),
        (SESSION_FORMAT, "session format"),
        (EVENT_DAY, "event day"),
    ):
        built[f"create_{_slug(noun)}"] = Action(
            name=f"create_{_slug(noun)}",
            verb="create",
            spec=spec,
            purpose=f"Add a new {noun} to this event.",
        )
        built[f"update_{_slug(noun)}"] = Action(
            name=f"update_{_slug(noun)}",
            verb="update",
            spec=spec,
            purpose=(
                f"Change an existing {noun}. `target` is the {noun}'s "
                f"{'date' if spec.label_column == 'day_date' else 'name'} as the organiser said it."
            ),
        )
    return built


def _slug(noun: str) -> str:
    return noun.replace(" ", "_")


ACTIONS: dict[str, Action] = _actions()


def describe() -> list[dict[str, Any]]:
    """The catalog as the planner prompt sees it.

    Built from the same registry the applier uses, so the prompt cannot come to
    advertise an action that is not there, or miss one that is.
    """
    described: list[dict[str, Any]] = []
    for action in ACTIONS.values():
        entry: dict[str, Any] = {
            "name": action.name,
            "purpose": action.purpose,
            "values": arg_spec(action.schema),
        }
        if action.verb == "update":
            entry["target"] = "string — the existing row, named the way the organiser named it"
        described.append(entry)
    return described


@dataclass(frozen=True, slots=True)
class Parsed:
    """One validated action, before anything has been resolved or written."""

    action: Action
    values: BaseModel
    #: Only for an update: the string the organiser used for the row.
    target: str | None = None


def parse(name: str, args: dict[str, Any]) -> Parsed:
    """Turn one entry of a model's plan into something safe to reason about.

    Both failure modes are ordinary rather than exceptional — a model naming an
    action that does not exist, or passing values that do not fit, is Tuesday.
    The caller drops that entry and keeps the rest.
    """
    action = ACTIONS.get(name)
    if action is None:
        raise UnknownActionError(name)

    raw_values = args.get("values")
    if not isinstance(raw_values, dict):
        raise BadArgsError(f"{name} needs a `values` object, got {type(raw_values).__name__}.")

    target: str | None = None
    if action.verb == "update":
        raw_target = args.get("target")
        if not isinstance(raw_target, str) or raw_target.strip() == "":
            # Applying an edit to an unnamed row is the one mistake with no
            # visible symptom, so it is refused rather than resolved (story 20).
            raise BadArgsError(f"{name} needs a `target` naming which one to change.")
        target = raw_target.strip()

    try:
        values = action.schema.model_validate(raw_values)
    except ValidationError as error:
        raise BadArgsError(f"{name} rejected its values: {error.errors()[:2]}") from error

    if not values.model_dump(exclude_unset=True):
        raise BadArgsError(f"{name} was given nothing to set.")

    return Parsed(action=action, values=values, target=target)


@dataclass(frozen=True, slots=True)
class Candidate:
    """One existing row, as the organiser would name it. Carries an id for us and
    a label for everyone else — `offer()` is what a prompt ever sees."""

    id: Any
    label: str


@dataclass(frozen=True, slots=True)
class Resolution:
    """What a target string turned out to mean."""

    target: Candidate | None
    candidates: list[Candidate] = field(default_factory=list)

    @property
    def is_exact(self) -> bool:
        return self.target is not None


def _label(spec: ResourceSpec, row: Any) -> str:
    value = getattr(row, spec.label_column)
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


async def resolve(session: AsyncSession, spec: ResourceSpec, wanted: str) -> Resolution:
    """Find the one row this string means, or report what there was to choose from.

    Matching is exact on the resource's label column, ignoring case and
    surrounding whitespace — and deliberately no cleverer than that. Substring
    matching looks helpful until "Studio" silently wins an edit aimed at
    "Studio B". Anything less than an exact match is handed upward, where a model
    gets one chance to choose between the candidates and a human is asked if it
    cannot.

    Runs inside the request's tenancy, so the rows considered are the caller's.

    **The exact match is its own query, over every row.** It used to be a Python
    filter over the same 25 rows fetched for the candidate list, which meant the
    26th room — alphabetically — could not be edited by typing its exact name.
    The candidate list is a prompt-sized sample and is allowed to be truncated;
    matching is not.

    **Both sides are folded by the same implementation.** The first version of
    that query compared Postgres `lower()` against Python `str.casefold()`, which
    are not the same function: `casefold("Straße")` is `"strasse"` and
    `lower('Straße')` is `'straße'`. A card would be drawn (the ladder matches on
    labels in Python) and then fail to apply, blaming a rename that never
    happened. Folding the needle in the database too costs nothing and removes
    the whole class.
    """
    column = getattr(spec.model, spec.label_column)

    needle = wanted.strip()
    matches = list(
        (
            await session.execute(
                # Cast to text so a date column answers to "2027-05-12", and
                # `lower()` on *both* sides so one folding implementation decides.
                select(spec.model).where(
                    func.lower(cast(column, Text)) == func.lower(cast(literal(needle), Text))
                )
            )
        )
        .scalars()
        .all()
    )

    rows = list(
        (await session.execute(select(spec.model).order_by(column).limit(MAX_CANDIDATES)))
        .scalars()
        .all()
    )
    candidates = [
        Candidate(id=row.id, label=_label(spec, row))  # type: ignore[attr-defined]
        for row in rows
    ]

    # Exactly one, not "the first": two rows a case-fold apart is a real
    # ambiguity and belongs on the ladder, not silently resolved to whichever
    # sorted first.
    if len(matches) == 1:
        row = matches[0]
        return Resolution(
            target=Candidate(id=row.id, label=_label(spec, row)),  # type: ignore[attr-defined]
            candidates=candidates,
        )
    return Resolution(target=None, candidates=candidates)


def offer(candidates: list[Candidate]) -> list[str]:
    """The candidate list as a prompt may see it: names, and nothing else.

    A separate function rather than a comprehension at the call site, because
    "what goes in the prompt" is a security boundary and boundaries deserve a
    name and a test (story 32).
    """
    return [candidate.label for candidate in candidates]
