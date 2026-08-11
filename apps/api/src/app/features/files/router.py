from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends

from app.core.deps import DbSession, PortalSpeaker, bind_tenant, require_role
from app.features.files import comments
from app.features.files.schemas import CommentCreate, CommentRead, FileThread
from app.models import CommentAuthorKind, Role, Speaker, User

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
    for record, task_name, speaker_name in await comments.deliverables(
        session, speaker_id=speaker_id
    ):
        messages = await comments.thread(session, record.version_group_id)
        threads.append(
            FileThread(
                file_id=record.id,
                filename=record.filename,
                version=record.version,
                task_name=task_name,
                speaker_name=speaker_name,
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
