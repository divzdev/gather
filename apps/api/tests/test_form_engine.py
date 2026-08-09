"""The form engine: shared logic fixtures plus server-side validation.

The fixture cases are the contract between this evaluator and the browser's — if
you change one, change the JSON, not just the code.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.features.forms.schema import FormSchema, resolve
from app.features.forms.validation import validate_answers

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "form-logic-cases.json"
_DATA = json.loads(FIXTURES.read_text())
_SCHEMA = FormSchema.model_validate(_DATA["schema"])


@pytest.mark.parametrize("case", _DATA["cases"], ids=lambda c: c["name"])
def test_shared_logic_fixture(case: dict[str, object]) -> None:
    result = resolve(_SCHEMA, dict(case["answers"]))  # type: ignore[arg-type]

    assert sorted(result.visible) == sorted(case["expected_visible"])  # type: ignore[arg-type]
    assert sorted(result.required) == sorted(case["expected_required"])  # type: ignore[arg-type]


def test_required_field_missing_is_reported() -> None:
    errors = validate_answers(_SCHEMA, {"format": "talk"})

    assert [e.field for e in errors] == ["title"]
    assert errors[0].message == "This is required"


def test_draft_save_does_not_enforce_required() -> None:
    """A speaker mid-way through must never lose input to a validation error."""
    assert validate_answers(_SCHEMA, {"format": "talk"}, partial=True) == []


def test_unknown_field_is_rejected() -> None:
    errors = validate_answers(_SCHEMA, {"title": "x", "format": "talk", "is_admin": True})

    assert any(e.field == "is_admin" for e in errors)


def test_choice_outside_the_options_is_rejected() -> None:
    errors = validate_answers(_SCHEMA, {"title": "x", "format": "keynote"})

    assert [e.field for e in errors] == ["format"]


def test_hidden_required_field_does_not_block_submission() -> None:
    """`prerequisites` is required only for workshops; a talk must still submit."""
    assert validate_answers(_SCHEMA, {"title": "x", "format": "talk"}) == []


def test_conditionally_required_field_does_block() -> None:
    errors = validate_answers(_SCHEMA, {"title": "x", "format": "workshop"})

    assert [e.field for e in errors] == ["prerequisites"]


def test_number_bounds_are_enforced() -> None:
    schema = FormSchema.model_validate(
        {
            "sections": [
                {
                    "key": "s",
                    "title": "s",
                    "fields": [
                        {
                            "key": "seats",
                            "type": "number",
                            "label": "Seats",
                            "min_value": 1,
                            "max_value": 500,
                        }
                    ],
                }
            ],
            "logic": [],
        }
    )

    assert validate_answers(schema, {"seats": 0})[0].message == "Must be 1 or more"
    assert validate_answers(schema, {"seats": 501})[0].message == "Must be 500 or less"
    assert validate_answers(schema, {"seats": 250}) == []


def test_min_greater_than_max_is_rejected_at_build_time() -> None:
    """The exact bug the customer hit live with the incumbent."""
    with pytest.raises(ValueError, match="exceeds max_length"):
        FormSchema.model_validate(
            {
                "sections": [
                    {
                        "key": "s",
                        "title": "s",
                        "fields": [
                            {
                                "key": "bio",
                                "type": "long_text",
                                "label": "Bio",
                                "min_length": 500,
                                "max_length": 100,
                            }
                        ],
                    }
                ],
                "logic": [],
            }
        )


def test_choice_field_without_choices_is_rejected() -> None:
    with pytest.raises(ValueError, match="needs choices"):
        FormSchema.model_validate(
            {
                "sections": [
                    {
                        "key": "s",
                        "title": "s",
                        "fields": [{"key": "track", "type": "select", "label": "Track"}],
                    }
                ],
                "logic": [],
            }
        )


def test_logic_referencing_an_unknown_field_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown field"):
        FormSchema.model_validate(
            {
                "sections": [
                    {
                        "key": "s",
                        "title": "s",
                        "fields": [{"key": "a", "type": "short_text", "label": "A"}],
                    }
                ],
                "logic": [
                    {
                        "field": "ghost",
                        "operator": "is",
                        "value": 1,
                        "action": "show",
                        "target": "a",
                    }
                ],
            }
        )


def test_duplicate_field_keys_are_rejected() -> None:
    with pytest.raises(ValueError, match="duplicate field keys"):
        FormSchema.model_validate(
            {
                "sections": [
                    {
                        "key": "s",
                        "title": "s",
                        "fields": [
                            {"key": "a", "type": "short_text", "label": "A"},
                            {"key": "a", "type": "long_text", "label": "A again"},
                        ],
                    }
                ],
                "logic": [],
            }
        )


def test_email_and_url_formats_are_checked() -> None:
    schema = FormSchema.model_validate(
        {
            "sections": [
                {
                    "key": "s",
                    "title": "s",
                    "fields": [
                        {"key": "email", "type": "email", "label": "Email"},
                        {"key": "site", "type": "url", "label": "Site"},
                    ],
                }
            ],
            "logic": [],
        }
    )

    errors = {e.field for e in validate_answers(schema, {"email": "nope", "site": "example.com"})}
    assert errors == {"email", "site"}
    assert validate_answers(schema, {"email": "a@b.co", "site": "https://example.com"}) == []
