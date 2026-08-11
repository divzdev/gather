"""Comments on a deliverable.

Separate from `service.py`, which stores bytes — this is about the conversation
around a file. Both audiences live here rather than split across `tasks` and
`portal`, because one rule — who may read a thread — must exist exactly once.

A thread is scoped to a `version_group_id`, so replacing a file carries the
conversation forward instead of stranding it on the superseded row.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.models import (
    CommentAuthorKind,
    File,
    FileComment,
    Speaker,
    SpeakerTask,
    TaskFile,
    TaskTemplate,
)

_MISSING = "No file with id {file_id}."


async def load_file(session: AsyncSession, file_id: uuid.UUID) -> File:
    """Tenancy filters this, so another org's file is simply absent."""
    record = await session.get(File, file_id)
    if record is None:
        raise NotFoundError(_MISSING.format(file_id=file_id))
    return record


async def load_own_file(session: AsyncSession, file_id: uuid.UUID, speaker_id: uuid.UUID) -> File:
    """The speaker's half of the gate.

    Ownership is either "they uploaded it" or "it hangs off one of their tasks";
    the second case matters because an organiser can upload on a speaker's
    behalf. Anything else is reported as missing rather than forbidden — a
    speaker has no business learning that another speaker's file exists.
    """
    record = await load_file(session, file_id)
    if record.uploaded_by_speaker_id == speaker_id:
        return record

    theirs = await session.scalar(
        select(TaskFile.id)
        .join(SpeakerTask, SpeakerTask.id == TaskFile.speaker_task_id)
        .where(TaskFile.file_id == file_id, SpeakerTask.speaker_id == speaker_id)
    )
    if theirs is None:
        raise NotFoundError(_MISSING.format(file_id=file_id))
    return record


async def thread(session: AsyncSession, version_group_id: uuid.UUID) -> list[FileComment]:
    rows = await session.execute(
        select(FileComment)
        .where(FileComment.version_group_id == version_group_id)
        .order_by(FileComment.created_at)
    )
    return list(rows.scalars())


async def add(
    session: AsyncSession,
    *,
    file: File,
    body: str,
    author_kind: CommentAuthorKind,
    author_name: str,
    author_user_id: uuid.UUID | None = None,
    author_speaker_id: uuid.UUID | None = None,
) -> FileComment:
    comment = FileComment(
        org_id=file.org_id,
        version_group_id=file.version_group_id,
        file_version=file.version,
        body=body,
        author_kind=author_kind,
        author_name=author_name,
        author_user_id=author_user_id,
        author_speaker_id=author_speaker_id,
    )
    session.add(comment)
    await session.flush()
    return comment


@dataclass(frozen=True, slots=True)
class Deliverable:
    """One logical file: every version of it, plus who and what it answers.

    `versions` is newest first, so `versions[0]` is the current one. Keeping the
    whole group rather than only the newest is what lets an organiser see that a
    deck was replaced — and get at the version it replaced.
    """

    versions: list[File]
    task_name: str
    speaker_name: str

    @property
    def current(self) -> File:
        return self.versions[0]


async def deliverables(
    session: AsyncSession, *, speaker_id: uuid.UUID | None = None
) -> list[Deliverable]:
    """Every deliverable in scope, each with its full version history.

    Both sides read this. Passing `speaker_id` is the portal; omitting it is the
    organiser, and the event scope comes from tenancy filtering `SpeakerTask`
    rather than from a predicate here.

    One payload on purpose — a speaker is on a phone, and an organiser opening a
    files panel should not pay a request per file, nor a second per version.
    """
    query = (
        select(File, TaskTemplate.name, Speaker.name)
        .join(TaskFile, TaskFile.file_id == File.id)
        .join(SpeakerTask, SpeakerTask.id == TaskFile.speaker_task_id)
        .join(TaskTemplate, TaskTemplate.id == SpeakerTask.task_template_id)
        .join(Speaker, Speaker.id == SpeakerTask.speaker_id)
        .order_by(File.version.desc())
    )
    if speaker_id is not None:
        query = query.where(SpeakerTask.speaker_id == speaker_id)
    rows = await session.execute(query)

    groups: dict[uuid.UUID, Deliverable] = {}
    for record, task_name, speaker_name in rows.tuples():
        found = groups.get(record.version_group_id)
        if found is None:
            groups[record.version_group_id] = Deliverable([record], task_name, speaker_name)
        else:
            found.versions.append(record)
    return list(groups.values())
