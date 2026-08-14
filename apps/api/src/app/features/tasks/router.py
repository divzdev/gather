"""The organiser's side of speaker deliverables.

The dashboard is one flat list of speaker-by-task, because that is the question
an organiser actually has ten days out — "who still owes me what" — and grouping
by either axis is a client-side sort of the same rows.
"""

from __future__ import annotations

import io
import uuid
import zipfile
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.core import storage
from app.core.deps import DbSession, bind_tenant, get_verified_user, require_role
from app.core.errors import ConflictError, NotFoundError
from app.features.tasks import service
from app.models import (
    File,
    Role,
    SpeakerTask,
    TaskFile,
    TaskKind,
    TaskStatus,
    TaskTemplate,
    User,
)

router = APIRouter(
    prefix="/v1/events/{event_id}",
    tags=["tasks"],
    dependencies=[Depends(bind_tenant)],
)

READ = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)
WRITE = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)


class TemplateRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    kind: TaskKind
    external_url: str | None
    is_required: bool
    due_rule: dict[str, Any]
    applies_to: dict[str, Any]
    accepted_file_types: dict[str, Any]
    max_file_mb: int | None
    sort_order: int
    assigned_count: int = 0


class TemplateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    kind: TaskKind
    external_url: str | None = Field(default=None, max_length=500)
    is_required: bool = True
    due_rule: dict[str, Any] = Field(default_factory=dict)
    applies_to: dict[str, Any] = Field(default_factory=lambda: {"scope": "all"})
    accepted_file_types: dict[str, Any] = Field(default_factory=dict)
    max_file_mb: int | None = Field(default=None, ge=1, le=200)
    sort_order: int = 0


class TemplateUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    external_url: str | None = Field(default=None, max_length=500)
    is_required: bool | None = None
    due_rule: dict[str, Any] | None = None
    applies_to: dict[str, Any] | None = None
    accepted_file_types: dict[str, Any] | None = None
    max_file_mb: int | None = Field(default=None, ge=1, le=200)
    sort_order: int | None = None


class TaskRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    speaker_id: uuid.UUID
    speaker_name: str
    speaker_email: str
    task_template_id: uuid.UUID
    task_name: str
    kind: TaskKind
    is_required: bool
    due_at: datetime | None
    status: TaskStatus
    completed_at: datetime | None
    last_nudged_at: datetime | None
    file_count: int


class TaskUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: TaskStatus


class NudgeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    speaker_ids: list[uuid.UUID] | None = None


class NudgeResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sent: int
    skipped: int


class AssignResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assigned: int


def _row(
    task: SpeakerTask, template: TaskTemplate, speaker: Any, *, file_count: int, now: datetime
) -> TaskRow:
    return TaskRow(
        id=task.id,
        speaker_id=speaker.id,
        speaker_name=speaker.name,
        speaker_email=speaker.email,
        task_template_id=template.id,
        task_name=template.name,
        kind=template.kind,
        is_required=template.is_required,
        due_at=task.due_at,
        status=service.derive_status(task, now),
        completed_at=task.completed_at,
        last_nudged_at=task.last_nudged_at,
        file_count=file_count,
    )


async def _templates(session: DbSession) -> list[TemplateRead]:
    rows = (
        (await session.execute(select(TaskTemplate).order_by(TaskTemplate.sort_order)))
        .scalars()
        .all()
    )
    counts: dict[uuid.UUID, int] = defaultdict(int)
    for template_id in (
        (await session.execute(select(SpeakerTask.task_template_id))).scalars().all()
    ):
        counts[template_id] += 1
    return [
        TemplateRead.model_validate(row).model_copy(update={"assigned_count": counts[row.id]})
        for row in rows
    ]


@router.get("/task-templates", response_model=list[TemplateRead])
async def list_templates(
    session: DbSession, _: User = Depends(require_role(*READ))
) -> list[TemplateRead]:
    return await _templates(session)


@router.post("/task-templates", response_model=TemplateRead, status_code=201)
async def create_template(
    body: TemplateCreate, session: DbSession, _: User = Depends(require_role(*WRITE))
) -> TemplateRead:
    template = TaskTemplate(**body.model_dump())
    session.add(template)
    await session.flush()
    return TemplateRead.model_validate(template)


@router.patch("/task-templates/{template_id}", response_model=TemplateRead)
async def update_template(
    template_id: uuid.UUID,
    body: TemplateUpdate,
    session: DbSession,
    _: User = Depends(require_role(*WRITE)),
) -> TemplateRead:
    template = await session.get(TaskTemplate, template_id)
    if template is None:
        raise NotFoundError(f"No task template with id {template_id}.")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(template, key, value)
    await session.flush()
    return TemplateRead.model_validate(template)


@router.post("/task-templates/{template_id}/assign", response_model=AssignResult)
async def assign_template(
    template_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*WRITE))
) -> AssignResult:
    template = await session.get(TaskTemplate, template_id)
    if template is None:
        raise NotFoundError(f"No task template with id {template_id}.")
    return AssignResult(assigned=await service.assign(session, template))


@router.delete("/task-templates/{template_id}", status_code=204)
async def delete_template(
    template_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*WRITE))
) -> None:
    """Remove a deliverable that was never handed out.

    `SpeakerTask.task_template_id` cascades, so deleting an assigned template
    would take every speaker's row with it — including the completed ones, and
    the record of the file they uploaded against it. That is not a delete an
    organiser can mean, so it is refused rather than performed: unassign is a
    different operation and nobody has asked for one.
    """
    template = await session.get(TaskTemplate, template_id)
    if template is None:
        raise NotFoundError(f"No task template with id {template_id}.")
    # The mapped attribute, not `select_from(SpeakerTask)`: tenancy filters ORM
    # entities, and a bare count has no entity to hang the predicate on — the
    # guard in core/tenancy.py refuses it rather than letting it read every org.
    assigned = await session.scalar(
        select(func.count(SpeakerTask.id)).where(SpeakerTask.task_template_id == template_id)
    )
    if assigned:
        raise ConflictError(
            f"“{template.name}” is assigned to {assigned} speaker"
            f"{'' if assigned == 1 else 's'}. Deleting it would erase their progress on it.",
            details={"blocked": True, "assigned": assigned},
        )
    await session.delete(template)


@router.get("/tasks/summary", response_model=list[TaskRow])
async def task_summary(session: DbSession, _: User = Depends(require_role(*READ))) -> list[TaskRow]:
    rows = await service.load_rows(session)
    files = await service.file_ids_by_task(session, [task.id for task, _t, _s in rows])
    now = datetime.now(UTC)
    return [
        _row(task, template, speaker, file_count=len(files.get(task.id, [])), now=now)
        for task, template, speaker in rows
    ]


@router.patch("/speaker-tasks/{task_id}", response_model=TaskRow)
async def update_task(
    task_id: uuid.UUID,
    body: TaskUpdate,
    session: DbSession,
    user: User = Depends(require_role(*WRITE)),
) -> TaskRow:
    """An organiser accepting a deliverable, or reopening one.

    `overdue` is refused: it is derived from the clock, and letting a caller set
    it would make the field mean two different things.
    """
    task = await session.get(SpeakerTask, task_id)
    if task is None:
        raise NotFoundError(f"No speaker task with id {task_id}.")
    if body.status is TaskStatus.OVERDUE:
        raise NotFoundError("Overdue is derived from the due date, not set directly.")

    task.status = body.status
    if body.status is TaskStatus.COMPLETE:
        task.completed_at = datetime.now(UTC)
        task.completed_by_user_id = user.id
    else:
        task.completed_at = None
        task.completed_by_user_id = None
    await session.flush()

    rows = await service.load_rows(session, speaker_id=task.speaker_id)
    files = await service.file_ids_by_task(session, [task.id])
    found = next((row for row in rows if row[0].id == task.id), None)
    if found is None:  # pragma: no cover - it was loaded a moment ago
        raise NotFoundError(f"No speaker task with id {task_id}.")
    return _row(*found, file_count=len(files.get(task.id, [])), now=datetime.now(UTC))


@router.post(
    "/tasks/nudge",
    response_model=NudgeResult,
    dependencies=[Depends(get_verified_user)],
)
async def nudge(
    body: NudgeRequest, session: DbSession, _: User = Depends(require_role(*WRITE))
) -> NudgeResult:
    sent, skipped = await service.nudge_outstanding(session, speaker_ids=body.speaker_ids)
    # Committed here, not on teardown. `get_db` commits after the response is
    # sent, so a second press arriving fast enough read `last_nudged_at` from
    # before the first press and re-sent every reminder — the 24-hour floor
    # held in the code and not in the database. Mail has already left; making
    # the record of it durable before reporting it is the only honest order.
    await session.commit()
    return NudgeResult(sent=sent, skipped=skipped)


@router.get("/tasks/download.zip")
async def download_deliverables(
    session: DbSession, _: User = Depends(require_role(*READ))
) -> Response:
    """Every current deliverable, one folder per speaker.

    Only the newest version of each file goes in — an organiser downloading the
    pack wants what they would look at today, not four drafts of one slide deck.
    """
    rows = await service.load_rows(session)
    by_task = {task.id: (template.name, speaker.name) for task, template, speaker in rows}
    links = (
        (
            (
                await session.execute(
                    select(TaskFile.speaker_task_id, File)
                    .join(File, File.id == TaskFile.file_id)
                    .where(TaskFile.speaker_task_id.in_(list(by_task)))
                    .order_by(File.version)
                )
            )
            .tuples()
            .all()
        )
        if by_task
        else []
    )

    newest: dict[uuid.UUID, tuple[uuid.UUID, File]] = {}
    for task_id, record in links:
        current = newest.get(record.version_group_id)
        if current is None or record.version > current[1].version:
            newest[record.version_group_id] = (task_id, record)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for task_id, record in newest.values():
            task_name, speaker_name = by_task[task_id]
            folder = storage.safe_filename(speaker_name)
            archive.writestr(
                f"{folder}/{storage.safe_filename(task_name)}-{record.filename}",
                await storage.read(record.s3_key),
            )
        if not newest:
            archive.writestr("README.txt", "No deliverables have been uploaded yet.\n")

    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="deliverables.zip"'},
    )


@router.get("/files/{file_id}/download")
async def download_file(
    file_id: uuid.UUID, session: DbSession, _: User = Depends(require_role(*READ))
) -> Response:
    """Tenancy filters this query, so a file from another event is simply absent."""
    record = await session.get(File, file_id)
    if record is None:
        raise NotFoundError(f"No file with id {file_id}.")
    return Response(
        content=await storage.read(record.s3_key),
        media_type=record.content_type,
        headers={"Content-Disposition": f'attachment; filename="{record.filename}"'},
    )
