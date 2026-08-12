"""Prompts are files with a version in the name, never inline strings.

The version is recorded on every proposal row. When a score looks wrong three
weeks later, the question is always "what were we asking it?", and a prompt
edited in place makes that unanswerable.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

DIRECTORY = Path(__file__).parent

#: Bump by adding a file, never by editing one that has run.
SCORE = "score.v1"
DUPLICATES = "duplicates.v1"


@lru_cache(maxsize=8)
def load(version: str) -> str:
    """Read a prompt by version name, e.g. `load(SCORE)`."""
    path = DIRECTORY / f"{version}.md"
    if not path.is_file():
        raise FileNotFoundError(f"no prompt file for version: {version!r}")
    return path.read_text().strip()
