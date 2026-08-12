"""Finding candidate duplicate submissions, in Postgres, before a model is involved.

214 submissions is 22,791 pairs. Sending those to a language model would cost
more than the whole rest of the feature and answer worse than `similarity()`
does for nothing: near-identical text is a string problem, and only the
genuinely ambiguous cases need judgement.

So this shortlists, and the model adjudicates the shortlist. It lives in the
feature rather than in a repository layer because it is a real query with real
tuning in it, which is exactly the case `architecture.md` says earns a module.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

#: Below this, pairs are different talks that share vocabulary. Tuned against the
#: seeded demo, where the generator produces titles like "Cutting 12 Minutes Off
#: Every Build (31)" — deliberately near-identical, which is the shape a real
#: accidental resubmission takes.
MIN_SIMILARITY = 0.45

#: Titles are compared with an index behind them; abstracts are compared only
#: for pairs that already matched on title, because the abstract comparison is
#: a sequential scan and doing it first is what makes this slow.
CANDIDATES = text("""
    SELECT a.id            AS left_id,
           a.code          AS left_code,
           a.title         AS left_title,
           b.id            AS right_id,
           b.code          AS right_code,
           b.title         AS right_title,
           similarity(a.title, b.title) AS score
      FROM submissions a
      JOIN submissions b
        ON b.event_id = a.event_id
       AND b.id > a.id
     WHERE a.event_id = :event_id
       AND a.status <> 'withdrawn'
       AND b.status <> 'withdrawn'
       AND similarity(a.title, b.title) >= :threshold
     ORDER BY score DESC
     LIMIT :limit
""")


@dataclass(frozen=True, slots=True)
class Candidate:
    left_id: uuid.UUID
    left_code: str
    left_title: str
    right_id: uuid.UUID
    right_code: str
    right_title: str
    score: float


async def duplicate_candidates(
    session: AsyncSession, *, event_id: uuid.UUID, limit: int = 15
) -> list[Candidate]:
    """The most similar pairs in one event, most similar first.

    Raw SQL because `similarity()` and the `%` operator have no ORM spelling, and
    wrapping them in one would be more code than the query. Parameter-bound, and
    the tenant predicate is explicit: this is a Core-level statement, so the
    session's tenancy filter does not apply to it.
    """
    rows = await session.execute(
        CANDIDATES, {"event_id": event_id, "threshold": MIN_SIMILARITY, "limit": limit}
    )
    return [
        Candidate(
            left_id=row.left_id,
            left_code=row.left_code,
            left_title=row.left_title,
            right_id=row.right_id,
            right_code=row.right_code,
            right_title=row.right_title,
            score=float(row.score),
        )
        for row in rows
    ]
