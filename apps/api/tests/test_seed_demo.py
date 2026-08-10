"""The demo data itself, which is a deliverable rather than a convenience.

Every property here broke at least once while the generator was being written,
each time because a value it *wrote* was later read back as input. That is the
failure mode these tests exist to catch.
"""

from __future__ import annotations

from app.seed import demo


def test_a_session_slug_is_unique_at_the_tail_not_the_prefix() -> None:
    """UUIDv7 is time-ordered, so ids minted in the same millisecond share a
    prefix. Slugs sliced from the front collided and violated a unique index."""
    first = demo.slugify("The Cache Key", unique="019feb84-55c4-7000-b11a-1432bbf087e2")
    second = demo.slugify("The Cache Key", unique="019feb84-55c4-7000-b11a-99999999aaaa")

    assert first != second
    assert first.startswith("the-cache-key-")


def test_a_slug_survives_punctuation_and_never_ends_up_empty() -> None:
    assert demo.slugify("Serving LLMs; on spot fleets, without tears!", unique="abc-def123") == (
        "serving-llms-on-spot-fleets-without-tears-def123"
    )
    assert demo.slugify("!!!", unique="abc-def123") == "session-def123"


def test_decisions_are_recorded_but_never_marked_sent() -> None:
    """A seeded demo that had already emailed 214 people would misrepresent the
    single most important rule in the product."""
    seen = {demo._decision(index, accepted_so_far=999)[1] for index in range(50)}
    seen |= {demo._decision(index, accepted_so_far=0)[1] for index in range(50)}

    assert all(value.value != "sent" for value in seen)


def test_enough_acceptances_to_fill_the_programme() -> None:
    accepted = 0
    for index in range(demo.TARGET_SUBMISSIONS):
        status, _decision = demo._decision(index, accepted)
        if status.value == "accepted":
            accepted += 1

    assert accepted == demo.TARGET_SESSIONS
