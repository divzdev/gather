"""Demo-scale data on top of the hand-written fixtures.

An empty app teaches nobody anything. The hand-written proposals in `__init__`
are the ones a human reads closely; this fills in the volume around them so the
agenda has something to drag, the task dashboard has somebody who is late, and
the review queue is long enough to be worth a keyboard.

Everything here is **deterministic** — one seeded `Random`, no clock reads for
content — so two people running `make seed` get the same conference, and a
screenshot taken today still matches tomorrow. It is also **idempotent**: it
counts what exists and tops up rather than appending a second conference.
"""

from __future__ import annotations

import random
import re
from datetime import UTC, datetime, time, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ContentStatus,
    DecisionStatus,
    Event,
    EventDay,
    EventSpeaker,
    Room,
    Session,
    SessionSpeaker,
    SessionStatus,
    Speaker,
    SpeakerStatus,
    SpeakerTask,
    Submission,
    SubmissionSpeaker,
    SubmissionStatus,
    TaskKind,
    TaskStatus,
    TaskTemplate,
)

TARGET_SPEAKERS = 80
TARGET_SUBMISSIONS = 214
TARGET_SESSIONS = 61
#: Eleven sessions stay in the tray so the agenda has something to place.
TARGET_PLACED = 50

SEED = 20270512

FIRST = [
    "Amara",
    "Bjorn",
    "Chen",
    "Divya",
    "Elif",
    "Farid",
    "Greta",
    "Hugo",
    "Ines",
    "Jonas",
    "Kaia",
    "Liam",
    "Mira",
    "Noor",
    "Oskar",
    "Priya",
    "Quinn",
    "Rosa",
    "Sami",
    "Tomas",
    "Ulla",
    "Viktor",
    "Wren",
    "Xiulan",
    "Yusuf",
    "Zara",
    "Anton",
    "Beatriz",
    "Cato",
    "Dilara",
]
LAST = [
    "Lindqvist",
    "Okafor",
    "Raman",
    "Eriksen",
    "Nakamura",
    "Haddad",
    "Moreau",
    "Silva",
    "Kowalski",
    "Byrne",
    "Petrov",
    "Alvarez",
    "Nguyen",
    "Osei",
    "Fontaine",
    "Bergman",
    "Duarte",
    "Halvorsen",
    "Marchetti",
    "Sandoval",
]
COMPANIES = [
    "Northbound Systems",
    "Harbour Labs",
    "Latticework",
    "Cloudreach",
    "Foundry Nine",
    "Kestrel Data",
    "Bright Anvil",
    "Meridian Tools",
    "Quarry Software",
    "Tidewater AI",
]
ROLES = [
    "Staff Engineer",
    "Principal Engineer",
    "Engineering Manager",
    "Developer Advocate",
    "Platform Lead",
    "Head of Data",
    "Site Reliability Engineer",
    "Founding Engineer",
]

TOPICS = [
    "Cutting {n} Minutes Off Every Build",
    "What {n} Incidents Taught Us About Rollbacks",
    "Running Agents in Production Without Losing Sleep",
    "The Cache Key That Was Never Stable",
    "Migrating {n} Services Off a Shared Database",
    "Observability When Everything Is Async",
    "Why Our Test Suite Got Slower Every Sprint",
    "Schema Changes at {n} Requests a Second",
    "Retrieval That Survives Real Documents",
    "Paying Down a Decade of Build Debt",
    "Feature Flags as a Deployment Strategy",
    "The Queue Is Not Your Database",
    "Evaluating Models Without a Benchmark",
    "From Monolith to {n} Modules, Carefully",
    "Making the Slow Path Obvious",
]
ABSTRACT = (
    "A working account of {topic_lower}, drawn from a team that got it wrong twice before "
    "it worked. Covers the decision we made, the one we reversed, and what we would "
    "measure first if we started again."
)


def slugify(value: str, *, unique: str) -> str:
    """A readable public URL, made unique by a tail rather than a prefix.

    UUIDv7 is time-ordered, so the *first* characters of two ids minted in the
    same millisecond are identical — slicing the front produces collisions. The
    tail is the random part.
    """
    stem = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:80] or "session"
    return f"{stem}-{unique.replace('-', '')[-6:]}"


def _people(rng: random.Random, count: int, taken: set[str]) -> list[tuple[str, str, str, str]]:
    """(name, email, company, role), all distinct and none already used."""
    out: list[tuple[str, str, str, str]] = []
    while len(out) < count:
        name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        handle = name.lower().replace(" ", ".")
        email = f"{handle}@{rng.choice(['example.com', 'example.org', 'example.net'])}"
        if email in taken:
            continue
        taken.add(email)
        out.append((name, email, rng.choice(COMPANIES), rng.choice(ROLES)))
    return out


async def _fill_speakers(session: AsyncSession, event: Event, rng: random.Random) -> list[Speaker]:
    existing = list(
        (await session.execute(select(Speaker).where(Speaker.org_id == event.org_id)))
        .scalars()
        .all()
    )
    missing = TARGET_SPEAKERS - len(existing)
    if missing <= 0:
        return existing

    taken = {person.email for person in existing}
    for name, email, company, role in _people(rng, missing, taken):
        speaker = Speaker(
            org_id=event.org_id,
            name=name,
            email=email,
            company=company,
            job_title=role,
            bio=(
                f"{name} is a {role.lower()} at {company}. They write about the parts of "
                "the job that do not fit in a diagram."
            ),
            tags=rng.sample(["keynote", "workshop", "returning", "local"], k=rng.randint(0, 2)),
            crm_status=rng.choice(["prospect", "invited", "confirmed", "alum"]),
        )
        session.add(speaker)
        await session.flush()
        session.add(
            EventSpeaker(
                org_id=event.org_id,
                event_id=event.id,
                speaker_id=speaker.id,
                status=SpeakerStatus.PROSPECTIVE,
            )
        )
        existing.append(speaker)
    await session.flush()
    return existing


def _decision(index: int, accepted_so_far: int) -> tuple[SubmissionStatus, DecisionStatus]:
    """A realistic spread, with enough acceptances to fill a programme.

    Decided rows are left `pending_send`: deciding is not sending, and a seeded
    demo that has already emailed 214 people would misrepresent the product's
    single most important rule.
    """
    if accepted_so_far < TARGET_SESSIONS:
        return SubmissionStatus.ACCEPTED, DecisionStatus.PENDING_SEND
    if index % 7 == 0:
        return SubmissionStatus.WAITLISTED, DecisionStatus.PENDING_SEND
    if index % 3 == 0:
        return SubmissionStatus.REJECTED, DecisionStatus.PENDING_SEND
    if index % 2 == 0:
        return SubmissionStatus.IN_REVIEW, DecisionStatus.NONE
    return SubmissionStatus.SUBMITTED, DecisionStatus.NONE


async def _fill_submissions(
    session: AsyncSession,
    event: Event,
    form: Any,
    program: dict[str, Any],
    people: list[Speaker],
    rng: random.Random,
) -> None:
    have = await session.scalar(
        select(func.count(Submission.id)).where(Submission.event_id == event.id)
    )
    missing = TARGET_SUBMISSIONS - int(have or 0)
    if missing <= 0:
        return

    tracks = list(program["tracks"].items())
    formats = list(program["formats"].items())
    accepted = 0
    opened = datetime.now(UTC) - timedelta(days=45)

    for index in range(missing):
        topic = TOPICS[index % len(TOPICS)].format(n=rng.choice([3, 9, 12, 40, 200, 1000]))
        title = f"{topic} ({index + 1})" if index >= len(TOPICS) else topic
        track_name, track = tracks[index % len(tracks)]
        format_name, session_format = formats[index % len(formats)]
        status, decision = _decision(index, accepted)
        if status is SubmissionStatus.ACCEPTED:
            accepted += 1

        submission = Submission(
            org_id=event.org_id,
            event_id=event.id,
            form_id=form.id,
            code=f"D{index + 100:05d}"[:6],
            title=title,
            answers={
                "title": title,
                "abstract": ABSTRACT.format(topic_lower=topic.lower()),
                "track": track_name,
                "format": format_name,
                "audience_level": rng.choice(["Beginner", "Intermediate", "Advanced"]),
                "key_takeaway": "One decision you can copy on Monday morning.",
            },
            track_id=track.id,
            session_format_id=session_format.id,
            requested_duration_minutes=session_format.default_duration_minutes,
            status=status,
            decision_status=decision,
            submitted_at=opened + timedelta(hours=index * 3),
            decided_at=None if decision is DecisionStatus.NONE else datetime.now(UTC),
        )
        session.add(submission)
        await session.flush()
        session.add(
            SubmissionSpeaker(
                org_id=event.org_id,
                event_id=event.id,
                submission_id=submission.id,
                speaker_id=people[index % len(people)].id,
                is_primary=True,
            )
        )
    await session.flush()


async def _promote(session: AsyncSession, event: Event) -> list[Session]:
    """Accepted submissions become sessions, which is the explicit second step."""
    have = list(
        (await session.execute(select(Session).where(Session.event_id == event.id))).scalars().all()
    )
    if len(have) >= TARGET_SESSIONS:
        return have

    accepted = (
        (
            await session.execute(
                select(Submission)
                .where(
                    Submission.event_id == event.id,
                    Submission.status == SubmissionStatus.ACCEPTED,
                )
                .order_by(Submission.created_at)
            )
        )
        .scalars()
        .all()
    )
    promoted = {row.submission_id for row in have}

    for submission in accepted:
        if len(have) >= TARGET_SESSIONS:
            break
        if submission.id in promoted:
            continue
        talk = Session(
            org_id=event.org_id,
            event_id=event.id,
            submission_id=submission.id,
            title=submission.title,
            abstract=str(submission.answers.get("abstract") or ""),
            slug=slugify(submission.title, unique=str(submission.id)),
            # Workshops run in their own room and are billed by format, not by
            # track. Deciding this here rather than at placement keeps it a
            # property of the session instead of a side effect of the grid.
            track_id=None
            if "Workshop" in (submission.answers.get("format") or "")
            else submission.track_id,
            session_format_id=submission.session_format_id,
            duration_minutes=submission.requested_duration_minutes or 30,
            status=SessionStatus.UNSCHEDULED,
            content_status=ContentStatus.APPROVED,
        )
        session.add(talk)
        await session.flush()

        speakers = (
            (
                await session.execute(
                    select(SubmissionSpeaker.speaker_id).where(
                        SubmissionSpeaker.submission_id == submission.id
                    )
                )
            )
            .scalars()
            .all()
        )
        for speaker_id in speakers:
            session.add(
                SessionSpeaker(
                    org_id=event.org_id,
                    event_id=event.id,
                    session_id=talk.id,
                    speaker_id=speaker_id,
                )
            )
        have.append(talk)
    await session.flush()
    return have


async def _place(session: AsyncSession, event: Event, talks: list[Session]) -> None:
    """Lay most of the programme onto the grid, then break it in three places.

    The deliberate conflicts are the point: an agenda with nothing wrong on it
    demonstrates nothing about a conflict engine.
    """
    if any(talk.starts_at is not None for talk in talks):
        return

    days = (
        (
            await session.execute(
                select(EventDay).where(EventDay.event_id == event.id).order_by(EventDay.day_date)
            )
        )
        .scalars()
        .all()
    )
    rooms = (
        (
            await session.execute(
                select(Room).where(Room.event_id == event.id).order_by(Room.sort_order)
            )
        )
        .scalars()
        .all()
    )
    if not days or not rooms:
        return

    # Three tracks across four rooms repeats a track in every slot by pigeonhole,
    # and the agenda would open under a dozen accidental warnings that bury the
    # deliberate ones. So the last room takes the untracked workshops and the
    # other three take one session from each track, round-robin.
    #
    # Which sessions are untracked is decided at promotion from their format, not
    # here. Deciding it during placement wrote `track_id = None` back to the row,
    # so a second run saw a fourth bucket and behaved differently from the first.
    untracked = [talk for talk in talks if talk.track_id is None]
    buckets: dict[Any, list[Session]] = {}
    for talk in talks:
        if talk.track_id is not None:
            buckets.setdefault(talk.track_id, []).append(talk)

    last = len(rooms) - 1
    placed: list[Session] = []
    for slot in range(TARGET_PLACED):
        room_index = slot % len(rooms)
        if room_index == last:
            if not untracked:
                continue
            talk = untracked.pop(0)
        else:
            # Indexed by *room*, not by slot: room 0 always draws the first
            # track, room 1 the second, and so on, which is what makes the three
            # sessions sharing a time slot come from three different tracks.
            keys = list(buckets)
            queue = buckets[keys[room_index % len(keys)]]
            if not queue:
                queue = next((other for other in buckets.values() if other), [])
            if not queue:
                break
            talk = queue.pop(0)

        day = days[slot // (len(rooms) * 8) % len(days)]
        offset = (slot // len(rooms)) % 8
        talk.event_day_id = day.id
        talk.room_id = rooms[room_index].id
        talk.starts_at = datetime.combine(day.day_date, time(9, 0), tzinfo=UTC) + timedelta(
            minutes=60 * offset
        )
        talk.duration_minutes = 30
        talk.status = SessionStatus.SCHEDULED
        placed.append(talk)

    if len(placed) < 4:
        await session.flush()
        return

    first, second, third, fourth = placed[0], placed[1], placed[2], placed[3]
    # Narrowed once: `starts_at` is Optional on the model and every clash below
    # is expressed relative to this one.
    anchor = first.starts_at
    if anchor is None:  # pragma: no cover - just assigned above
        await session.flush()
        return

    # 1. Room double-booking: same room, overlapping by fifteen minutes.
    second.event_day_id = first.event_day_id
    second.room_id = first.room_id
    second.starts_at = anchor + timedelta(minutes=15)

    # 2. One speaker in two rooms at once.
    third.event_day_id = first.event_day_id
    third.starts_at = anchor
    third.room_id = rooms[1 % len(rooms)].id if first.room_id == rooms[0].id else rooms[0].id
    speaker_of_first = await session.scalar(
        select(SessionSpeaker.speaker_id).where(SessionSpeaker.session_id == first.id)
    )
    if speaker_of_first is not None:
        clash = await session.scalar(
            select(SessionSpeaker).where(
                SessionSpeaker.session_id == third.id,
                SessionSpeaker.speaker_id == speaker_of_first,
            )
        )
        if clash is None:
            session.add(
                SessionSpeaker(
                    org_id=event.org_id,
                    event_id=event.id,
                    session_id=third.id,
                    speaker_id=speaker_of_first,
                )
            )

    # 3. Track collision: same track, different rooms, overlapping — soft.
    fourth.event_day_id = first.event_day_id
    fourth.starts_at = anchor + timedelta(minutes=10)
    fourth.track_id = first.track_id
    fourth.room_id = rooms[-1].id

    await session.flush()


TEMPLATES = [
    ("Headshot", TaskKind.UPLOAD, 21, {"extensions": ["jpg", "jpeg", "png"]}),
    ("Slide deck", TaskKind.UPLOAD, 7, {"extensions": ["pdf", "key", "pptx"]}),
    ("Confirm your travel dates", TaskKind.ACKNOWLEDGE, 14, {}),
]


async def _tasks(session: AsyncSession, event: Event, rng: random.Random) -> None:
    """Deliverables, with a spread of states including some genuinely overdue.

    A task board where everything is done proves nothing; the overdue rows are
    what the chasing tools are for.
    """
    have = await session.scalar(
        select(func.count(TaskTemplate.id)).where(TaskTemplate.event_id == event.id)
    )
    if int(have or 0) > 0:
        return

    speaking = (
        (
            await session.execute(
                select(SessionSpeaker.speaker_id)
                .where(SessionSpeaker.event_id == event.id)
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    if not speaking:
        return

    now = datetime.now(UTC)
    for order, (name, kind, days_before, accepted) in enumerate(TEMPLATES):
        template = TaskTemplate(
            org_id=event.org_id,
            event_id=event.id,
            name=name,
            kind=kind,
            is_required=True,
            due_rule={"type": "relative", "days_before_event": days_before},
            applies_to={"scope": "all"},
            accepted_file_types=accepted,
            sort_order=order,
        )
        session.add(template)
        await session.flush()

        for index, speaker_id in enumerate(speaking):
            # A third done, a third outstanding, a third already past its date.
            bucket = (index + order) % 3
            due = now + timedelta(days=10) if bucket != 2 else now - timedelta(days=3)
            status = TaskStatus.COMPLETE if bucket == 0 else TaskStatus.NOT_STARTED
            session.add(
                SpeakerTask(
                    org_id=event.org_id,
                    event_id=event.id,
                    speaker_id=speaker_id,
                    task_template_id=template.id,
                    due_at=due,
                    status=status,
                    completed_at=now - timedelta(days=1) if status is TaskStatus.COMPLETE else None,
                )
            )
    await session.flush()


async def fill(
    session: AsyncSession, event: Event, form: Any, program: dict[str, Any]
) -> dict[str, int]:
    """Top up to demo scale. Safe to run repeatedly."""
    rng = random.Random(SEED)  # noqa: S311 - demo content, not security

    people = await _fill_speakers(session, event, rng)
    await _fill_submissions(session, event, form, program, people, rng)
    talks = await _promote(session, event)
    await _place(session, event, talks)
    await _tasks(session, event, rng)

    counts = {
        "speakers": len(people),
        "submissions": int(
            await session.scalar(
                select(func.count(Submission.id)).where(Submission.event_id == event.id)
            )
            or 0
        ),
        "sessions": len(talks),
        "placed": int(
            await session.scalar(
                select(func.count(Session.id)).where(
                    Session.event_id == event.id, Session.starts_at.is_not(None)
                )
            )
            or 0
        ),
        "tasks": int(
            await session.scalar(
                select(func.count(SpeakerTask.id)).where(SpeakerTask.event_id == event.id)
            )
            or 0
        ),
    }
    return counts
