"""Server-side answer validation against a form schema.

The clone spec calls out validation twice: the customer caught the incumbent
accepting invalid input on camera. Client validation is convenience; this is the
decision. Errors come back per-field so the UI can focus the first failure.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.features.forms.schema import CHOICE_TYPES, FieldType, FormField, FormSchema, resolve

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
URL_RE = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class FieldError:
    field: str
    message: str


def _check_one(field: FormField, value: Any) -> str | None:
    if field.type in {FieldType.SECTION, FieldType.STATIC_CONTENT}:
        return None

    if field.type in CHOICE_TYPES:
        allowed = {c.value for c in field.choices}
        values = value if isinstance(value, list) else [value]
        unknown = [v for v in values if v not in allowed]
        if unknown:
            return f"{unknown[0]!r} is not one of the available options"
        if field.type in {FieldType.SELECT, FieldType.RADIO} and isinstance(value, list):
            return "Choose a single option"
        return None

    if field.type == FieldType.EMAIL:
        if not isinstance(value, str) or not EMAIL_RE.match(value):
            return "Enter a valid email address"
        return None

    if field.type == FieldType.URL:
        if not isinstance(value, str) or not URL_RE.match(value):
            return "Enter a URL starting with http:// or https://"
        return None

    if field.type in {FieldType.NUMBER, FieldType.RATING}:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return "Enter a number"
        if field.min_value is not None and number < field.min_value:
            return f"Must be {field.min_value:g} or more"
        if field.max_value is not None and number > field.max_value:
            return f"Must be {field.max_value:g} or less"
        return None

    if field.type in {FieldType.CHECKBOX, FieldType.CONSENT}:
        if not isinstance(value, bool):
            return "Must be true or false"
        return None

    if field.type in {FieldType.SHORT_TEXT, FieldType.LONG_TEXT, FieldType.DATE}:
        if not isinstance(value, str):
            return "Must be text"
        if field.min_length is not None and len(value) < field.min_length:
            return f"Must be at least {field.min_length} characters"
        if field.max_length is not None and len(value) > field.max_length:
            return f"Must be {field.max_length} characters or fewer"
        return None

    return None


def validate_answers(
    schema: FormSchema, answers: dict[str, Any], *, partial: bool = False
) -> list[FieldError]:
    """Validate answers against the schema.

    `partial=True` skips required checks, for a draft save where the speaker is
    mid-way through and must never lose input.
    """
    resolution = resolve(schema, answers)
    errors: list[FieldError] = []

    known = {f.key for f in schema.all_fields()}
    for key in answers:
        if key not in known:
            errors.append(FieldError(key, "Unknown field"))

    for field in schema.all_fields():
        if field.key not in resolution.visible:
            continue
        value = answers.get(field.key)

        missing = value is None or (isinstance(value, str) and not value.strip())
        if missing:
            if field.key in resolution.required and not partial:
                errors.append(FieldError(field.key, "This is required"))
            continue

        message = _check_one(field, value)
        if message is not None:
            errors.append(FieldError(field.key, message))

    return errors
