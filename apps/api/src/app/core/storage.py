"""Where uploaded bytes live.

Local disk, because `make setup` has to produce a working app with zero
credentials and an object-store adapter with one implementation is an interface
pretending to be polymorphism. The key format is already S3-shaped, so pointing
this at a bucket later is a read/write pair rather than a redesign.

Bytes are addressed by key and never overwritten: a replacement is a new version
with a new key, which is what makes `File.version` honest.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path

from anyio import to_thread

from app.core.config import get_settings
from app.core.errors import ApiError, NotFoundError

MAX_UPLOAD_BYTES = 25 * 1024 * 1024

_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


def safe_filename(filename: str) -> str:
    """Keep the name recognisable to the speaker who uploaded it, and inert.

    The result is only ever a path *segment* — traversal, separators and control
    characters are collapsed before it can reach the filesystem.
    """
    cleaned = _UNSAFE.sub("-", Path(filename).name).strip("-.")
    return (cleaned or "file")[:120]


def build_key(*, version_group_id: uuid.UUID, version: int, filename: str) -> str:
    return f"files/{version_group_id}/{version}/{safe_filename(filename)}"


def _path_for(key: str) -> Path:
    root = get_settings().storage_root.resolve()
    target = (root / key).resolve()
    if not target.is_relative_to(root):
        raise ApiError(
            f"Refusing to touch a path outside the store: {key!r}",
            code="VALIDATION_FAILED",
            status_code=422,
        )
    return target


def _write_sync(target: Path, data: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


async def write(key: str, data: bytes) -> None:
    await to_thread.run_sync(_write_sync, _path_for(key), data)


async def read(key: str) -> bytes:
    target = _path_for(key)
    if not target.is_file():
        raise NotFoundError("That file is no longer stored.")
    return await to_thread.run_sync(target.read_bytes)
