from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import CommentAuthorKind


class CommentRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    body: str
    author_kind: CommentAuthorKind
    author_name: str
    file_version: int
    created_at: datetime


class CommentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=4000)

    @field_validator("body")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("A comment needs something in it.")
        return stripped


class FileThread(BaseModel):
    """A deliverable and everything said about it, newest version first."""

    model_config = ConfigDict(extra="forbid")

    file_id: uuid.UUID
    filename: str
    version: int
    task_name: str
    speaker_name: str
    comments: list[CommentRead]
