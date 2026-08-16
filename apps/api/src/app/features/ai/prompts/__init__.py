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
#: The event assistant's two calls (spec 0005): choose the queries, then write
#: prose about what they returned. Two files because they are two different
#: jobs asked of the model, and the planner's rules have nothing to say about
#: prose style.
#: v2 adds the write catalog (spec 0008): the planner may now return *actions*
#: as well as queries, and the rules about never inventing a value and never
#: deleting live here rather than in code.
ASK_PLAN = "ask_plan.v2"
ASK_PROSE = "ask_prose.v2"
#: The second call on the ambiguous path only: the organiser's own words plus the
#: names that exist, in, one name or nothing out. Small on purpose — it is spent
#: to avoid interrupting somebody, so it must cost less than interrupting them.
ASK_RESOLVE = "ask_resolve.v1"


@lru_cache(maxsize=8)
def load(version: str) -> str:
    """Read a prompt by version name, e.g. `load(SCORE)`."""
    path = DIRECTORY / f"{version}.md"
    if not path.is_file():
        raise FileNotFoundError(f"no prompt file for version: {version!r}")
    return path.read_text().strip()
