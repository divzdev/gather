from __future__ import annotations

import uuid
from datetime import date, time

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Read(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    #: How many sessions point at this row. Present on every program resource so
    #: a screen can say what removing it would cost *before* it is clicked —
    #: the delete guard refuses afterwards, which is enforcement, not a warning.
    session_count: int = 0


# --- tracks ------------------------------------------------------------------


class TrackCreate(Strict):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    hue_index: int | None = Field(default=None, ge=1, le=8)
    is_public: bool = True
    sort_order: int = 0


class TrackUpdate(Strict):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    hue_index: int | None = Field(default=None, ge=1, le=8)
    is_public: bool | None = None
    sort_order: int | None = None


class TrackRead(Read):
    id: uuid.UUID
    name: str
    description: str | None
    hue_index: int
    is_public: bool
    sort_order: int


# --- session formats ---------------------------------------------------------


class SessionFormatCreate(Strict):
    name: str = Field(min_length=1, max_length=120)
    default_duration_minutes: int = Field(default=30, ge=5, le=600)
    icon_key: str | None = Field(default=None, max_length=60)
    sort_order: int = 0


class SessionFormatUpdate(Strict):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    default_duration_minutes: int | None = Field(default=None, ge=5, le=600)
    icon_key: str | None = Field(default=None, max_length=60)
    sort_order: int | None = None


class SessionFormatRead(Read):
    id: uuid.UUID
    name: str
    default_duration_minutes: int
    icon_key: str | None
    sort_order: int


# --- rooms -------------------------------------------------------------------


class RoomCreate(Strict):
    name: str = Field(min_length=1, max_length=120)
    capacity: int | None = Field(default=None, ge=1, le=100_000)
    av_notes: str | None = Field(default=None, max_length=2000)
    sort_order: int = 0
    is_active: bool = True


class RoomUpdate(Strict):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    capacity: int | None = Field(default=None, ge=1, le=100_000)
    av_notes: str | None = Field(default=None, max_length=2000)
    sort_order: int | None = None
    is_active: bool | None = None


class RoomRead(Read):
    id: uuid.UUID
    name: str
    capacity: int | None
    av_notes: str | None
    sort_order: int
    is_active: bool


# --- event days --------------------------------------------------------------


class EventDayCreate(Strict):
    day_date: date
    starts_at_local: time = time(9, 0)
    ends_at_local: time = time(18, 0)
    label: str | None = Field(default=None, max_length=100)
    sort_order: int = 0

    @model_validator(mode="after")
    def _ordered(self) -> EventDayCreate:
        if self.starts_at_local >= self.ends_at_local:
            raise ValueError("starts_at_local must be before ends_at_local")
        return self


class EventDayUpdate(Strict):
    day_date: date | None = None
    starts_at_local: time | None = None
    ends_at_local: time | None = None
    label: str | None = Field(default=None, max_length=100)
    sort_order: int | None = None

    @model_validator(mode="after")
    def _ordered(self) -> EventDayUpdate:
        """Only when the edit carries both. One-sided edits are checked against
        the stored row in the router, where the other half is known."""
        both = self.starts_at_local is not None and self.ends_at_local is not None
        if both and self.starts_at_local >= self.ends_at_local:  # type: ignore[operator]
            raise ValueError("starts_at_local must be before ends_at_local")
        return self


class EventDayRead(Read):
    id: uuid.UUID
    day_date: date
    starts_at_local: time
    ends_at_local: time
    label: str | None
    sort_order: int
