from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.features.forms.schema import FormSchema
from app.models import FormKind, FormStatus


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FormCreate(Strict):
    name: str = Field(min_length=1, max_length=200)
    kind: FormKind = FormKind.CFP
    schema_: FormSchema = Field(default_factory=FormSchema, alias="schema")
    opens_at: datetime | None = None
    closes_at: datetime | None = None

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class FormUpdate(Strict):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    #: Editable until the form locks. The builder's first step offers the choice
    #: and says it holds "until the first submission arrives" — without this the
    #: picker was decorative, because the PATCH refused the field outright.
    kind: FormKind | None = None
    schema_: FormSchema | None = Field(default=None, alias="schema")
    status: FormStatus | None = None
    opens_at: datetime | None = None
    closes_at: datetime | None = None

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class FormRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    name: str
    kind: FormKind
    schema_: FormSchema = Field(alias="schema", serialization_alias="schema")
    status: FormStatus
    is_locked: bool
    opens_at: datetime | None
    closes_at: datetime | None


class PublicFormRead(BaseModel):
    """What an anonymous speaker sees. No internal flags, no lock state."""

    model_config = ConfigDict(extra="forbid")

    event_name: str
    event_slug: str
    event_description: str | None
    #: The public shell draws its header from this endpoint, because it is the
    #: only public one that answers before a schedule is published. Without
    #: these it printed `new Date()` — today's date, twice, on every event.
    event_starts_on: date
    event_ends_on: date
    event_location: str | None
    form_id: uuid.UUID
    form_name: str
    schema_: FormSchema = Field(alias="schema", serialization_alias="schema")
    closes_at: datetime | None
    #: `closes_at` is an instant in UTC, so a deadline shown without this is a
    #: different deadline for every reader. The client renders both in this zone.
    event_timezone: str
    #: What the API will actually enforce on submit. The form used to print a
    #: limit that was a literal string, on an event that had none.
    submission_limit_per_speaker: int | None
    is_open: bool
    closed_reason: str | None = None
