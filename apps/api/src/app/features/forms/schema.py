"""The form schema and its conditional-logic evaluator.

One engine serves CFP forms and portal task forms. The same rules are evaluated
in the browser as the speaker types and again here on submit — the client is
convenience, the server decides. Both implementations are replayed against
`docs/fixtures/form-logic-cases.json` in CI so they cannot drift.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class FieldType(StrEnum):
    SHORT_TEXT = "short_text"
    LONG_TEXT = "long_text"
    SELECT = "select"
    MULTI_SELECT = "multi_select"
    RADIO = "radio"
    CHECKBOX = "checkbox"
    CHECKBOX_GROUP = "checkbox_group"
    FILE = "file"
    URL = "url"
    EMAIL = "email"
    DATE = "date"
    NUMBER = "number"
    RATING = "rating"
    SECTION = "section"
    SPEAKER_BLOCK = "speaker_block"
    STATIC_CONTENT = "static_content"
    CONSENT = "consent"


CHOICE_TYPES = frozenset(
    {
        FieldType.SELECT,
        FieldType.MULTI_SELECT,
        FieldType.RADIO,
        FieldType.CHECKBOX_GROUP,
    }
)

Operator = Literal["is", "is_not", "is_any_of", "is_empty", "is_not_empty", "gt", "lt"]
Action = Literal["show", "hide", "require"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Choice(Strict):
    value: str = Field(min_length=1, max_length=200)
    label: str = Field(min_length=1, max_length=200)


class FormField(Strict):
    key: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9_]+$")
    type: FieldType
    label: str = Field(min_length=1, max_length=300)
    help_text: str | None = Field(default=None, max_length=1000)
    required: bool = False
    choices: list[Choice] = Field(default_factory=list)

    min_length: int | None = Field(default=None, ge=0)
    max_length: int | None = Field(default=None, ge=1)
    min_value: float | None = None
    max_value: float | None = None

    accepted_file_types: list[str] = Field(default_factory=list)
    max_file_mb: int | None = Field(default=None, ge=1, le=100)

    # Strips this answer from reviewer-facing responses during a blind round.
    identity_bearing: bool = False
    # Set instead of deleting a field once the form has locked, so existing
    # answers keep their meaning.
    hidden_from_new: bool = False

    @model_validator(mode="after")
    def _check(self) -> FormField:
        if self.type in CHOICE_TYPES and not self.choices:
            raise ValueError(f"field '{self.key}' is type {self.type} and needs choices")
        # The exact bug the customer hit on camera with the incumbent.
        if None not in (self.min_length, self.max_length) and self.min_length > self.max_length:  # type: ignore[operator]
            raise ValueError(
                f"field '{self.key}': min_length {self.min_length} "
                f"exceeds max_length {self.max_length}"
            )
        if None not in (self.min_value, self.max_value) and self.min_value > self.max_value:  # type: ignore[operator]
            raise ValueError(
                f"field '{self.key}': min_value {self.min_value} exceeds max_value {self.max_value}"
            )
        return self


class LogicRule(Strict):
    field: str = Field(min_length=1, max_length=80)
    operator: Operator
    value: Any = None
    action: Action
    target: str = Field(min_length=1, max_length=80)


class FormSection(Strict):
    key: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9_]+$")
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    fields: list[FormField] = Field(default_factory=list)


class FormSettings(Strict):
    allow_drafts: bool = True
    allow_co_speakers: bool = True
    max_co_speakers: int = Field(default=4, ge=0, le=20)
    confirmation_message: str = "Thanks — your proposal is in."


class FormSchema(Strict):
    sections: list[FormSection] = Field(default_factory=list)
    logic: list[LogicRule] = Field(default_factory=list)
    settings: FormSettings = Field(default_factory=FormSettings)

    @model_validator(mode="after")
    def _check(self) -> FormSchema:
        keys = [f.key for s in self.sections for f in s.fields]
        duplicates = {k for k in keys if keys.count(k) > 1}
        if duplicates:
            raise ValueError(f"duplicate field keys: {sorted(duplicates)}")

        known = set(keys)
        for rule in self.logic:
            if rule.field not in known:
                raise ValueError(f"logic rule references unknown field '{rule.field}'")
            if rule.target not in known:
                raise ValueError(f"logic rule targets unknown field '{rule.target}'")
            if rule.field == rule.target:
                raise ValueError(f"logic rule on '{rule.field}' targets itself")
        return self

    def all_fields(self) -> list[FormField]:
        return [f for s in self.sections for f in s.fields]

    def field(self, key: str) -> FormField | None:
        return next((f for f in self.all_fields() if f.key == key), None)


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list | dict):
        return len(value) == 0
    return False


def _matches(rule: LogicRule, answer: Any) -> bool:
    match rule.operator:
        case "is":
            return bool(answer == rule.value)
        case "is_not":
            return bool(answer != rule.value)
        case "is_any_of":
            options = rule.value if isinstance(rule.value, list) else [rule.value]
            if isinstance(answer, list):
                return any(a in options for a in answer)
            return answer in options
        case "is_empty":
            return _is_empty(answer)
        case "is_not_empty":
            return not _is_empty(answer)
        case "gt" | "lt":
            try:
                left, right = float(answer), float(rule.value)
            except (TypeError, ValueError):
                return False
            return left > right if rule.operator == "gt" else left < right


class Resolution(BaseModel):
    """Which fields a given set of answers makes visible and required."""

    visible: set[str]
    required: set[str]


def resolve(schema: FormSchema, answers: dict[str, Any]) -> Resolution:
    """Apply logic rules in declaration order. Later rules win over earlier ones.

    A field that any rule targets with `show` starts hidden: "show Workshop
    prerequisites when format is Workshop" has to mean it is absent otherwise,
    not merely re-shown when it was already visible.
    """
    conditional = {r.target for r in schema.logic if r.action == "show"}
    live = [f for f in schema.all_fields() if not f.hidden_from_new]

    visible = {f.key for f in live if f.key not in conditional}
    required = {f.key for f in live if f.required}

    for rule in schema.logic:
        if not _matches(rule, answers.get(rule.field)):
            continue
        match rule.action:
            case "show":
                visible.add(rule.target)
            case "hide":
                visible.discard(rule.target)
            case "require":
                required.add(rule.target)

    # A hidden field is never required — the classic "form nobody can submit" bug.
    required &= visible
    return Resolution(visible=visible, required=required)
