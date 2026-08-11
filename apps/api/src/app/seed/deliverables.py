"""Uploaded deliverables, and the conversations about them.

Without this the demo has 244 speaker tasks and zero files, so the upload,
versioning and comment features all render empty — and an empty screen teaches
an organiser nothing about what the product does.

Deliberately small: a handful of files, not one per task. The point is that
every state is *reachable* on screen — a first version, a replacement, an
unanswered request, and a thread that survived the re-upload it asked for.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import tenant_scope
from app.features.files import service as files
from app.models import (
    CommentAuthorKind,
    Event,
    FileComment,
    Speaker,
    SpeakerTask,
    TaskFile,
    TaskKind,
    TaskStatus,
    TaskTemplate,
    User,
)

#: A one-page PDF. Real bytes, so downloading one from the demo opens a reader
#: rather than a corrupt-file dialog.
_PDF = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n%%EOF\n"
)

_TASK = "Slide deck"

#: The account the demo's one-click speaker sign-in lands on. The richest thread
#: goes to them, because a judge who signs in as a speaker and finds an empty
#: Feedback tab has been shown nothing.
_DEMO_SPEAKER = "sbek-speaker@example.com"

#: (filename, replaced?, [(who, message)]) — one resolved thread, one waiting on
#: the speaker, one file with nothing said about it.
_PLAN: list[tuple[str, bool, list[tuple[CommentAuthorKind, str]]]] = [
    (
        "keynote-deck.pdf",
        True,
        [
            (
                CommentAuthorKind.STAFF,
                "Slide 12 has the old sponsor logo on it — could you swap it for the "
                "one in the speaker pack and re-upload?",
            ),
            (CommentAuthorKind.SPEAKER, "Good catch. Replaced it, v2 is up now."),
            (
                CommentAuthorKind.STAFF,
                "Perfect, that's the right one. Thanks for the quick turnaround.",
            ),
        ],
    ),
    (
        "platform-teams-deck.pdf",
        False,
        [
            (
                CommentAuthorKind.STAFF,
                "This is 94 slides for a 30-minute slot. Can you cut it to about 35, "
                "or would you rather we moved you to a 45-minute room?",
            ),
        ],
    ),
    ("observability-deck.pdf", False, []),
]


async def fill(session: AsyncSession, event: Event) -> int:
    """Attach files and threads to a few already-complete upload tasks."""
    if await session.scalar(select(func.count(TaskFile.id))):
        return 0

    organiser = await session.scalar(select(User).order_by(User.created_at).limit(1))
    organiser_name = organiser.name if organiser else "Programme team"

    rows = (
        (
            await session.execute(
                select(SpeakerTask, Speaker)
                .join(TaskTemplate, TaskTemplate.id == SpeakerTask.task_template_id)
                .join(Speaker, Speaker.id == SpeakerTask.speaker_id)
                .where(TaskTemplate.kind == TaskKind.UPLOAD, TaskTemplate.name == _TASK)
                .order_by(Speaker.email != _DEMO_SPEAKER, Speaker.name)
            )
        )
        .tuples()
        .all()
    )
    if not rows:
        return 0

    now = datetime.now(UTC)
    written = 0
    for (task, speaker), (filename, replaced, script) in zip(rows, _PLAN, strict=False):
        # The rest of the seed runs under `tenancy_disabled()`, but `files.store`
        # reads the tenant to stamp `event_id`. Scoping just this call keeps the
        # seeded rows identical to ones an upload would produce.
        with tenant_scope(event.org_id, event.id):
            record = await files.store(
                session,
                data=_PDF,
                filename=filename,
                content_type="application/pdf",
                uploaded_by_speaker_id=speaker.id,
            )
            if replaced:
                newer = await files.store(
                    session,
                    data=_PDF + b"%v2\n",
                    filename=filename,
                    content_type="application/pdf",
                    version_group_id=record.version_group_id,
                    uploaded_by_speaker_id=speaker.id,
                )

        # Ids are explicit because the seed runs with automatic tenancy off.
        links = [record.id, newer.id] if replaced else [record.id]
        for file_id in links:
            session.add(
                TaskFile(
                    org_id=event.org_id,
                    event_id=event.id,
                    speaker_task_id=task.id,
                    file_id=file_id,
                )
            )
        task.status = TaskStatus.COMPLETE
        task.completed_at = now - timedelta(days=4)

        for index, (author, body) in enumerate(script):
            from_staff = author is CommentAuthorKind.STAFF
            session.add(
                FileComment(
                    org_id=event.org_id,
                    version_group_id=record.version_group_id,
                    # The first two messages sit on v1 even where a v2 now
                    # exists — that is the whole point of keeping the version
                    # per message rather than per thread.
                    file_version=1 if index < 2 else 2,
                    body=body,
                    author_kind=author,
                    author_name=organiser_name if from_staff else speaker.name,
                    author_user_id=organiser.id if from_staff and organiser else None,
                    author_speaker_id=None if from_staff else speaker.id,
                    created_at=now - timedelta(days=3) + timedelta(hours=index * 5),
                )
            )
        written += 1

    await session.flush()
    return written
