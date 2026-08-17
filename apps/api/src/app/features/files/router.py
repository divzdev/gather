from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from app.core.deps import DbSession, PortalSpeaker, bind_tenant, require_role
from app.features.files import comments
from app.features.files.schemas import CommentCreate, CommentRead, FileThread, FileVersion
from app.models import (
    CommentAuthorKind,
    Role,
    Session,
    SessionSpeaker,
    Speaker,
    SpeakerTask,
    TaskFile,
    TaskTemplate,
    User,
)
from app.models.file import File as FileRecord

# Reviewers are deliberately absent: deliverables are post-acceptance work and
# a reviewer's console stops at the submission.
READ = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)
WRITE = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)

staff_router = APIRouter(
    prefix="/v1/events/{event_id}",
    tags=["files"],
    dependencies=[Depends(bind_tenant)],
)
portal_router = APIRouter(prefix="/v1/portal", tags=["portal"])


@staff_router.get("/files/{file_id}/comments", response_model=list[CommentRead])
async def list_comments(
    file_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*READ))
) -> list[CommentRead]:
    record = await comments.load_file(session, file_id)
    return [
        CommentRead.model_validate(c)
        for c in await comments.thread(session, record.version_group_id)
    ]


@staff_router.post("/files/{file_id}/comments", response_model=CommentRead, status_code=201)
async def add_comment(
    file_id: uuid.UUID,
    body: CommentCreate,
    session: DbSession,
    user: User = Depends(require_role(*WRITE)),
) -> CommentRead:
    """The speaker reads this. It is a conversation, not an internal note —
    `SubmissionNote` is where staff-only commentary belongs."""
    record = await comments.load_file(session, file_id)
    comment = await comments.add(
        session,
        file=record,
        body=body.body,
        author_kind=CommentAuthorKind.STAFF,
        author_name=user.name,
        author_user_id=user.id,
    )
    return CommentRead.model_validate(comment)


@portal_router.get("/files/{file_id}/comments", response_model=list[CommentRead])
async def list_own_comments(
    file_id: uuid.UUID, session: DbSession, speaker: PortalSpeaker
) -> list[CommentRead]:
    record = await comments.load_own_file(session, file_id, speaker.speaker_id)
    return [
        CommentRead.model_validate(c)
        for c in await comments.thread(session, record.version_group_id)
    ]


@portal_router.post("/files/{file_id}/comments", response_model=CommentRead, status_code=201)
async def add_own_comment(
    file_id: uuid.UUID, body: CommentCreate, session: DbSession, speaker: PortalSpeaker
) -> CommentRead:
    record = await comments.load_own_file(session, file_id, speaker.speaker_id)
    person = await session.get(Speaker, speaker.speaker_id)
    comment = await comments.add(
        session,
        file=record,
        body=body.body,
        author_kind=CommentAuthorKind.SPEAKER,
        author_name=person.name if person else "Speaker",
        author_speaker_id=speaker.speaker_id,
    )
    return CommentRead.model_validate(comment)


async def _threads(session: DbSession, *, speaker_id: uuid.UUID | None = None) -> list[FileThread]:
    threads = []
    for item in await comments.deliverables(session, speaker_id=speaker_id):
        current = item.current
        messages = await comments.thread(session, current.version_group_id)
        threads.append(
            FileThread(
                file_id=current.id,
                filename=current.filename,
                version=current.version,
                task_name=item.task_name,
                speaker_name=item.speaker_name,
                versions=[
                    # `uploaded_at` rather than the row's `created_at`: the name
                    # an organiser reads should say what the date means.
                    FileVersion(
                        id=v.id,
                        version=v.version,
                        byte_size=v.byte_size,
                        uploaded_at=v.created_at,
                    )
                    for v in item.versions
                ],
                comments=[CommentRead.model_validate(m) for m in messages],
            )
        )
    return threads


@portal_router.get("/file-comments", response_model=list[FileThread])
async def my_threads(session: DbSession, speaker: PortalSpeaker) -> list[FileThread]:
    """Every deliverable of theirs with its conversation, in one payload.

    A speaker visits the portal two or three times on a phone, so feedback that
    only appears once you open the right task is feedback nobody reads.
    """
    return await _threads(session, speaker_id=speaker.speaker_id)


@staff_router.get("/file-comments", response_model=list[FileThread])
async def event_threads(
    session: DbSession, _: User = Depends(require_role(*READ))
) -> list[FileThread]:
    """Every deliverable in the event with its conversation."""
    return await _threads(session)


class LibraryEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    filename: str
    content_type: str
    byte_size: int
    uploaded_at: datetime
    #: How many versions this logical file has. A deliverable that came back
    #: three times is the interesting row on this screen, and the count is the
    #: only place that shows without opening it.
    versions: int
    version_group_id: uuid.UUID
    speaker_name: str | None
    speaker_id: uuid.UUID | None
    #: What it was uploaded *for* — the task's name, or "Headshot".
    label: str
    session_title: str | None


@staff_router.get("/files", response_model=list[LibraryEntry])
async def files_library(
    session: DbSession, _: User = Depends(require_role(*READ))
) -> list[LibraryEntry]:
    """Every file anyone has uploaded to this event, newest first.

    Chasing slides meant opening eighty speaker drawers: uploads were reachable
    one person at a time and nowhere together. Only the latest version of each
    group is listed — a deliverable replaced three times is one row that says
    so, not three rows competing to be the current one.
    """
    latest = (
        select(
            FileRecord.version_group_id.label("group_id"),
            func.max(FileRecord.version).label("top"),
            func.count(FileRecord.id).label("versions"),
        )
        .group_by(FileRecord.version_group_id)
        .subquery()
    )

    rows = (
        (
            await session.execute(
                select(FileRecord, latest.c.versions, Speaker, TaskTemplate.name, Session.title)
                .join(
                    latest,
                    (latest.c.group_id == FileRecord.version_group_id)
                    & (latest.c.top == FileRecord.version),
                )
                .outerjoin(TaskFile, TaskFile.file_id == FileRecord.id)
                .outerjoin(SpeakerTask, SpeakerTask.id == TaskFile.speaker_task_id)
                .outerjoin(TaskTemplate, TaskTemplate.id == SpeakerTask.task_template_id)
                .outerjoin(
                    Speaker,
                    Speaker.id
                    == func.coalesce(SpeakerTask.speaker_id, FileRecord.uploaded_by_speaker_id),
                )
                .outerjoin(SessionSpeaker, SessionSpeaker.speaker_id == Speaker.id)
                .outerjoin(Session, Session.id == SessionSpeaker.session_id)
                .order_by(FileRecord.created_at.desc())
            )
        )
        .tuples()
        .all()
    )

    seen: set[uuid.UUID] = set()
    entries: list[LibraryEntry] = []
    for record, versions, speaker, task_name, session_title in rows:
        # The session join fans out for a speaker on two talks; the file is
        # still one file.
        if record.id in seen:
            continue
        seen.add(record.id)
        entries.append(
            LibraryEntry(
                id=record.id,
                filename=record.filename,
                content_type=record.content_type,
                byte_size=record.byte_size,
                uploaded_at=record.created_at,
                versions=int(versions),
                version_group_id=record.version_group_id,
                speaker_name=speaker.name if speaker is not None else None,
                speaker_id=speaker.id if speaker is not None else None,
                label=task_name
                or ("Headshot" if record.content_type.startswith("image/") else "Upload"),
                session_title=session_title,
            )
        )
    return entries
