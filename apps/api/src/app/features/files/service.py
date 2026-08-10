"""Storing an upload as a versioned file.

Nothing is ever overwritten. Replacing a headshot or a slide deck writes a new
row at `version + 1` inside the same `version_group_id`, so "the latest one" and
"the one you sent in March" are both answerable — which is the whole reason the
`abstract_final_v3_revised_EDITED.docx` problem exists in the first place.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.errors import ApiError
from app.core.tenancy import current_tenant
from app.models import File


def _reject(message: str) -> ApiError:
    return ApiError(message, code="VALIDATION_FAILED", status_code=422, field="file")


def check_upload(
    *,
    filename: str,
    content_type: str,
    byte_size: int,
    accepted_extensions: list[str] | None = None,
    max_bytes: int = storage.MAX_UPLOAD_BYTES,
) -> None:
    """Refuse the upload before any bytes are stored, naming what was wrong."""
    if byte_size == 0:
        raise _reject("That file is empty.")
    if byte_size > max_bytes:
        raise _reject(
            f"That file is {byte_size // 1_048_576}MB; the limit is {max_bytes // 1_048_576}MB."
        )
    if not content_type:
        raise _reject("That upload arrived with no content type.")

    if accepted_extensions:
        suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        allowed = [ext.lstrip(".").lower() for ext in accepted_extensions]
        if suffix not in allowed:
            raise _reject(f"This task accepts {', '.join(allowed)} files, not .{suffix or '?'}.")


async def latest_version(session: AsyncSession, version_group_id: uuid.UUID) -> int:
    highest = await session.scalar(
        select(func.max(File.version)).where(File.version_group_id == version_group_id)
    )
    return int(highest or 0)


async def store(
    session: AsyncSession,
    *,
    data: bytes,
    filename: str,
    content_type: str,
    version_group_id: uuid.UUID | None = None,
    uploaded_by_user_id: uuid.UUID | None = None,
    uploaded_by_speaker_id: uuid.UUID | None = None,
) -> File:
    """Write the bytes, then the row. A group id makes this a new version of an
    existing file; its absence starts a new group at version 1."""
    group = version_group_id or uuid.uuid4()
    version = (await latest_version(session, group)) + 1 if version_group_id else 1
    key = storage.build_key(version_group_id=group, version=version, filename=filename)

    await storage.write(key, data)

    tenant = current_tenant()
    record = File(
        event_id=tenant.event_id,
        version_group_id=group,
        version=version,
        s3_key=key,
        filename=storage.safe_filename(filename),
        content_type=content_type,
        byte_size=len(data),
        uploaded_by_user_id=uploaded_by_user_id,
        uploaded_by_speaker_id=uploaded_by_speaker_id,
    )
    session.add(record)
    await session.flush()
    return record
