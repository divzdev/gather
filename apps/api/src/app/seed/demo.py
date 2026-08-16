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
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.publishing import snapshot
from app.features.review import service as review_service
from app.models import (
    ContentStatus,
    DecisionStatus,
    Event,
    EventDay,
    EventSpeaker,
    ExpertiseLevel,
    Form,
    FormKind,
    FormStatus,
    Message,
    MessageBatch,
    MessageStatus,
    OrgMember,
    Review,
    ReviewerAssignment,
    ReviewRound,
    ReviewScore,
    ReviewStatus,
    Role,
    Room,
    RubricCriterion,
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
    User,
)
from app.seed import deliverables

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
                # The CFP marks this required, and the bulk seed left it out —
                # so every proposal a judge opened showed a required question
                # blank. It is also the field flagged `identity_bearing`, which
                # means a blind round now visibly strips something other than
                # the speakers array.
                "speaker_bio": people[index % len(people)].bio,
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


#: The CFP's wording for a level, and the enum the schedule filters on.
LEVELS = {
    "Beginner": ExpertiseLevel.BEGINNER,
    "Intermediate": ExpertiseLevel.INTERMEDIATE,
    "Advanced": ExpertiseLevel.ADVANCED,
}

#: Two or three tags a real programme would carry, derived from the track and
#: the title rather than sprinkled at random — a filter is only convincing if
#: the sessions behind it actually belong together.
TRACK_TAGS = {
    "AI Engineering": ["agents", "evaluation"],
    "Platform & Infra": ["infrastructure", "cost"],
    "Developer Experience": ["tooling", "developer experience"],
}

TITLE_TAGS = [
    ("incident", "war story"),
    ("migrat", "migration"),
    ("cach", "caching"),
    ("test", "testing"),
    ("build", "build systems"),
    ("observab", "observability"),
    ("schema", "databases"),
    ("queue", "databases"),
    ("flag", "release engineering"),
]


def _tags_for(track: str, title: str) -> list[str]:
    tags = list(TRACK_TAGS.get(track, []))
    lowered = title.lower()
    tags.extend(tag for needle, tag in TITLE_TAGS if needle in lowered)
    # Order kept, duplicates dropped, and capped: a card carrying nine tags is
    # noise, and the filter bar becomes unreadable long before that.
    seen: list[str] = []
    for tag in tags:
        if tag not in seen:
            seen.append(tag)
    return seen[:3]


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
            # The CFP already asked for a level; a session that dropped it on
            # promotion left the public schedule with a filter and no values.
            expertise_level=LEVELS.get(str(submission.answers.get("audience_level") or "")),
            language="English",
            tags=_tags_for(str(submission.answers.get("track") or ""), submission.title),
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

    # Fill slot by slot, never repeating a track within one slot. Three tracks
    # across four rooms repeats one by pigeonhole if you just deal them out, and
    # the agenda then opens under a dozen accidental warnings that bury the three
    # deliberate ones. The fourth room takes a session with no track where one is
    # available, and is otherwise left empty — an empty room reads as a gap in
    # the programme, which is honest; a phantom clash does not.
    pool = list(talks)
    placed: list[Session] = []
    slot = 0
    while pool and len(placed) < TARGET_PLACED:
        day = days[(slot // 8) % len(days)]
        offset = slot % 8
        # 09:00 is the hour the conference opens, which is a wall-clock time in
        # the room — so it is built in the event's zone and converted, not
        # stamped UTC. Stamped UTC it meant 02:00 in San Francisco: every
        # renderer was correct and every screen said the keynote was at two in
        # the morning, because storage is UTC and the client formats using
        # `event_timezone`. A timezone bug in seed data reads as a rendering bug
        # on six different screens.
        start = datetime.combine(
            day.day_date, time(9, 0), tzinfo=ZoneInfo(event.timezone)
        ).astimezone(UTC) + timedelta(minutes=60 * offset)

        used_tracks: set[Any] = set()
        for room in rooms:
            if len(placed) >= TARGET_PLACED:
                break
            # A tracked session whose track this slot has not used yet, and only
            # then an untracked one. Taking whatever fits first packs every
            # workshop into the opening slots and leaves the early grid with no
            # tracks on it at all.
            pick = next(
                (
                    item
                    for item in pool
                    if item.track_id is not None and item.track_id not in used_tracks
                ),
                None,
            ) or next((item for item in pool if item.track_id is None), None)
            if pick is None:
                continue
            pool.remove(pick)
            if pick.track_id is not None:
                used_tracks.add(pick.track_id)

            pick.event_day_id = day.id
            pick.room_id = room.id
            pick.starts_at = start
            pick.duration_minutes = 30
            pick.status = SessionStatus.SCHEDULED
            placed.append(pick)
        slot += 1

    if len(placed) < 4:
        await session.flush()
        return

    # Three deliberate clashes, one of each kind, as the brief asks for.
    #
    # Each is made by changing an attribute of a session already in place rather
    # than moving one into an occupied slot. Moving creates collateral: the grid
    # is nearly full, so anywhere you drop lands on something and you get two
    # clashes where you wanted one.
    by_slot: dict[Any, list[Session]] = {}
    for item in placed:
        by_slot.setdefault(item.starts_at, []).append(item)
    together = [rows for rows in by_slot.values() if len(rows) >= 3]
    if not together:
        await session.flush()
        return
    clashing = together[0]

    # 1. Room double-booking: two of them share a room.
    clashing[1].room_id = clashing[0].room_id

    # 2. One speaker in two rooms at once — a third session, still in its own
    #    room, gains the first one's speaker.
    speaker_of_first = await session.scalar(
        select(SessionSpeaker.speaker_id).where(SessionSpeaker.session_id == clashing[0].id)
    )
    if speaker_of_first is not None:
        already = await session.scalar(
            select(SessionSpeaker).where(
                SessionSpeaker.session_id == clashing[2].id,
                SessionSpeaker.speaker_id == speaker_of_first,
            )
        )
        if already is None:
            session.add(
                SessionSpeaker(
                    org_id=event.org_id,
                    event_id=event.id,
                    session_id=clashing[2].id,
                    speaker_id=speaker_of_first,
                )
            )

    # 3. Track collision, the soft one: a fourth session in the same slot takes
    #    the first one's track. Needs a session that has a track at all.
    anchor_track = next((item.track_id for item in clashing if item.track_id is not None), None)
    if anchor_track is not None:
        for item in clashing:
            if item.track_id != anchor_track:
                item.track_id = anchor_track
                break

    await session.flush()


#: name, kind, days before the event, accepted file types, requires_review,
#: sets_profile_photo.
#:
#: The last column is load-bearing, not decoration (spec 0007). `requires_review`
#: now decides whether a delivery completes on arrival or waits for an organiser,
#: so seeding it False everywhere would auto-complete every headshot and deck the
#: moment a speaker uploaded. "Waiting on you" would empty, the organiser Tasks
#: screen would have nothing to chase, and the deliverable-chasing flow — the
#: reason that screen exists — would be invisible to anyone evaluating the demo.
#:
#: An artefact a human has to look at is reviewed. A questionnaire answer is not:
#: nobody accepts "I need HDMI".
TEMPLATES = [
    ("Headshot", TaskKind.UPLOAD, 21, {"extensions": ["jpg", "jpeg", "png"]}, True, True),
    ("Slide deck", TaskKind.UPLOAD, 7, {"extensions": ["pdf", "key", "pptx"]}, True, False),
    ("Confirm your travel dates", TaskKind.ACKNOWLEDGE, 14, {}, False, False),
    ("Tell us about your setup", TaskKind.FORM, 10, {}, False, False),
]

#: The same JSON-schema engine that drives the CFP, pointed at a task. Seeded so
#: the portal shows a form task rather than only uploads — a claim the README
#: makes and the demo otherwise never demonstrates.
TASK_FORM_SCHEMA: dict[str, Any] = {
    "sections": [
        {
            "key": "setup",
            "title": "Your setup",
            "fields": [
                {
                    "key": "av_needs",
                    "type": "select",
                    "label": "What do you need on stage?",
                    "required": True,
                    "choices": [
                        {"value": "hdmi", "label": "HDMI from my laptop"},
                        {"value": "usbc", "label": "USB-C from my laptop"},
                        {"value": "provided", "label": "Use the provided machine"},
                    ],
                },
                {
                    "key": "adapter",
                    "type": "short_text",
                    "label": "Which adapter are you bringing?",
                    "required": False,
                },
                {
                    "key": "dietary",
                    "type": "long_text",
                    "label": "Anything we should know for the speaker dinner?",
                    "required": False,
                    "max_length": 500,
                },
            ],
        }
    ],
    # Asking about an adapter only makes sense if they are bringing a laptop.
    "logic": [
        {
            "field": "av_needs",
            "operator": "is_not",
            "value": "provided",
            "action": "show",
            "target": "adapter",
        }
    ],
    "settings": {},
}


async def _task_form(session: AsyncSession, event: Event) -> Form:
    """Idempotent, like the rest of the seed: re-running follows this file rather
    than freezing at whatever the first run wrote."""
    form = await session.scalar(
        select(Form).where(Form.event_id == event.id, Form.kind == FormKind.TASK)
    )
    if form is None:
        form = Form(
            org_id=event.org_id,
            event_id=event.id,
            name="Speaker setup",
            kind=FormKind.TASK,
            schema=TASK_FORM_SCHEMA,
            status=FormStatus.OPEN,
        )
        session.add(form)
    else:
        form.schema = TASK_FORM_SCHEMA
    await session.flush()
    return form


async def _tasks(session: AsyncSession, event: Event, rng: random.Random) -> None:
    """Deliverables, with a spread of states including some genuinely overdue.

    A task board where everything is done proves nothing; the overdue rows are
    what the chasing tools are for.
    """
    # Templates this file has grown since the last run are added; existing ones
    # are left alone, so re-seeding never re-issues work a speaker has already
    # done. A blanket "any template exists, do nothing" froze the demo at
    # whatever the first run created.
    existing = set(
        (await session.execute(select(TaskTemplate.name).where(TaskTemplate.event_id == event.id)))
        .scalars()
        .all()
    )
    wanted = [entry for entry in TEMPLATES if entry[0] not in existing]
    if not wanted:
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
    task_form = await _task_form(session, event)
    for order, (name, kind, days_before, accepted, reviewed, is_photo) in enumerate(
        wanted, start=len(existing)
    ):
        template = TaskTemplate(
            org_id=event.org_id,
            event_id=event.id,
            name=name,
            kind=kind,
            form_id=task_form.id if kind is TaskKind.FORM else None,
            is_required=True,
            due_rule={"type": "relative", "days_before_event": days_before},
            applies_to={"scope": "all"},
            accepted_file_types=accepted,
            requires_review=reviewed,
            sets_profile_photo=is_photo,
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


#: Scores that agree with the decisions already recorded. A demo where the
#: accepted talks score 2.1 and the rejected ones 4.6 teaches an organiser to
#: distrust the column, which is worse than an empty one.
BAND = {
    SubmissionStatus.ACCEPTED: (4, 5),
    SubmissionStatus.WAITLISTED: (3, 4),
    SubmissionStatus.REJECTED: (1, 3),
    SubmissionStatus.SUBMITTED: (2, 5),
    SubmissionStatus.IN_REVIEW: (2, 5),
}

#: How much of the demo reviewer's queue is left for them to do. Scoring all of
#: it would empty the screen the reviewer persona exists to demonstrate.
QUEUE_LEFT = 24

#: Named, not positional. Ordering the reviewers by email put the *other* one
#: first, so the account the demo signs in as was the one with nothing left.
DEMO_REVIEWER = "sbek-reviewer@example.com"

#: Every Nth proposal is withheld from one reviewer, offset per reviewer, so the
#: assignment sets overlap without being equal. 7 leaves roughly six in seven
#: proposals with two independent scores — enough that a mean stays a mean —
#: while still carving each queue down to a visibly proper subset.
ASSIGNMENT_STRIDE = 7


async def _reviews(session: AsyncSession, event: Event, rng: random.Random) -> int:
    """Assign the round, then actually score most of it.

    The round, its rubric and its assignments were seeded before the bulk
    submissions existed, so only the three hand-written proposals were ever
    assigned and nothing was ever scored: `score_avg` was null on all 214, and
    the review dashboard, the score column and the sort-by-score control all had
    nothing to show.
    """
    round_ = await session.scalar(
        select(ReviewRound).where(ReviewRound.event_id == event.id).order_by(ReviewRound.sort_order)
    )
    criteria = list(
        (
            await session.execute(
                select(RubricCriterion)
                .where(RubricCriterion.review_round_id == (round_.id if round_ else None))
                .order_by(RubricCriterion.sort_order)
            )
        )
        .scalars()
        .all()
    )
    reviewers = list(
        (
            await session.execute(
                select(User)
                .join(OrgMember, OrgMember.user_id == User.id)
                .where(OrgMember.org_id == event.org_id, OrgMember.role == Role.REVIEWER)
                .order_by(User.email)
            )
        )
        .scalars()
        .all()
    )
    if round_ is None or not criteria or not reviewers:
        return 0

    submissions = list(
        (
            await session.execute(
                select(Submission)
                .where(
                    Submission.event_id == event.id,
                    Submission.status != SubmissionStatus.DRAFT,
                )
                .order_by(Submission.code)
            )
        )
        .scalars()
        .all()
    )
    already = {
        (row.submission_id, row.user_id)
        for row in (
            await session.execute(select(Review).where(Review.review_round_id == round_.id))
        )
        .scalars()
        .all()
    }
    # The round seeds its own assignments for the hand-written proposals before
    # the bulk ones exist. Reused rather than skipped: a fresh row would trip the
    # unique index, and ignoring the existing one would leave it open forever
    # while its review says scored.
    assigned = {
        (row.submission_id, row.user_id): row
        for row in (
            await session.execute(
                select(ReviewerAssignment).where(ReviewerAssignment.review_round_id == round_.id)
            )
        )
        .scalars()
        .all()
    }

    scored = 0
    for index, submission in enumerate(submissions):
        for slot, reviewer in enumerate(reviewers):
            # Each reviewer sits out a different slice, so no two queues are the
            # same and neither equals the full pile.
            #
            # Assigning everyone everything is the obvious seed and the wrong
            # one: it makes assignment look like a no-op. A reviewer opening a
            # queue of 214 out of 214 submissions cannot tell whether the queue
            # is scoped to them or simply unfiltered, and neither can anyone
            # evaluating the app. Real programmes divide the pile; that division
            # is the entire point of assigning reviewers, so the demo data has to
            # show it. Most proposals still draw both reviewers, which keeps
            # `score_avg` a mean of two opinions rather than one number wearing
            # an average's clothes.
            if index % ASSIGNMENT_STRIDE == slot:
                continue
            if (submission.id, reviewer.id) in already:
                continue
            assignment = assigned.get((submission.id, reviewer.id))
            if assignment is None:
                assignment = ReviewerAssignment(
                    org_id=event.org_id,
                    event_id=event.id,
                    review_round_id=round_.id,
                    submission_id=submission.id,
                    user_id=reviewer.id,
                )
                session.add(assignment)
            # The demo reviewer keeps the tail of the list to work through; the
            # other has finished, so progress differs between them and the
            # dashboard has something to say.
            is_demo = reviewer.email == DEMO_REVIEWER
            leave_pending = is_demo and index >= len(submissions) - QUEUE_LEFT
            # One conflict of interest, so the rule that a COI review is excluded
            # from the mean rather than counted as zero is visible in the data.
            conflicted = not is_demo and index == 7

            done_at = None if leave_pending else datetime.now(UTC) - timedelta(days=2)
            assignment.completed_at = done_at

            review = Review(
                org_id=event.org_id,
                event_id=event.id,
                review_round_id=round_.id,
                submission_id=submission.id,
                user_id=reviewer.id,
                status=ReviewStatus.PENDING if leave_pending else ReviewStatus.SCORED,
                conflict_of_interest=conflicted,
                comment=None if leave_pending else rng.choice(COMMENTS),
                submitted_at=done_at,
            )
            session.add(review)
            await session.flush()
            if leave_pending:
                continue

            low, high = BAND.get(submission.status, (2, 5))
            for criterion in criteria:
                session.add(
                    ReviewScore(
                        org_id=event.org_id,
                        event_id=event.id,
                        review_id=review.id,
                        rubric_criterion_id=criterion.id,
                        value=rng.randint(low, high),
                    )
                )
            scored += 1

    await session.flush()
    for submission in submissions:
        await review_service.recompute_score(session, submission.id)
    await session.flush()
    return scored


COMMENTS = [
    "Clear thesis, and the failure story is the part people will remember.",
    "Strong for the track. I would ask for one more concrete number in the abstract.",
    "Good topic, thin on what is new. Overlaps two other proposals this year.",
    "Would land better as a lightning talk — one idea, well made.",
    "The prerequisites are realistic, which is rarer than it should be.",
]


async def _roster_states(session: AsyncSession, event: Event, rng: random.Random) -> None:
    """Move the people who are actually on the programme off `prospective`.

    Every seeded speaker used to sit at `prospective` regardless of whether their
    talk had been accepted, promoted, scheduled and given deliverables — so the
    roster contradicted every other screen. Promotion is what makes someone a
    speaker at this event, so it is what sets `accepted` here.

    A handful then answer for themselves, because `accepted` and `confirmed` mean
    different things and a demo where nobody has ever replied cannot show it.
    """
    on_programme = (
        (
            await session.execute(
                select(EventSpeaker)
                .join(SessionSpeaker, SessionSpeaker.speaker_id == EventSpeaker.speaker_id)
                .where(
                    EventSpeaker.event_id == event.id,
                    EventSpeaker.status == SpeakerStatus.PROSPECTIVE,
                )
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    if not on_programme:
        return

    answered = datetime.now(UTC) - timedelta(days=3)
    for index, link in enumerate(sorted(on_programme, key=lambda row: str(row.speaker_id))):
        link.status = SpeakerStatus.ACCEPTED
        # Two in three have replied; one of those says no. The rest are exactly
        # what an organiser is chasing on the tasks screen.
        if index % 3 == 0:
            continue
        if index % 9 == 4:
            link.status = SpeakerStatus.DECLINED
            link.decline_reason = rng.choice(
                [
                    "My employer pulled travel budget for the quarter.",
                    "I am on parental leave that week.",
                    "Clashes with a customer launch I cannot move.",
                ]
            )
        else:
            link.status = SpeakerStatus.CONFIRMED
        link.responded_at = answered
    await session.flush()


#: A first wave that has already gone out, so the outbox is not an empty screen
#: and the delivery states it exists to show have something to show. Kept small
#: on purpose: the queue that has *not* been sent is the thing the product is
#: making a point about, and it should stay the larger number by far.
SENT_WAVE = 18


async def _outbox(session: AsyncSession, event: Event) -> int:
    """One decision send that already happened, with real delivery outcomes.

    Nothing seeded the outbox, so the screen that records what actually left the
    building opened empty on a demo where 400 decisions were queued — and the
    resend path, which only offers itself on a failure, could never be shown.
    """
    if await session.scalar(select(func.count(Message.id)).where(Message.event_id == event.id)):
        return 0

    rows = list(
        (
            await session.execute(
                select(Submission, Speaker)
                .join(SubmissionSpeaker, SubmissionSpeaker.submission_id == Submission.id)
                .join(Speaker, Speaker.id == SubmissionSpeaker.speaker_id)
                .where(
                    Submission.event_id == event.id,
                    Submission.status == SubmissionStatus.ACCEPTED,
                    Submission.decision_status == DecisionStatus.PENDING_SEND,
                    SubmissionSpeaker.is_primary.is_(True),
                )
                .order_by(Submission.code)
                .limit(SENT_WAVE)
            )
        )
        .tuples()
        .all()
    )
    if not rows:
        return 0

    went = datetime.now(UTC) - timedelta(days=1)
    batch = MessageBatch(
        org_id=event.org_id,
        event_id=event.id,
        recipient_count=len(rows),
        segment_description="Decision notices · first wave",
        status=MessageStatus.SENT,
    )
    session.add(batch)
    await session.flush()

    for index, (submission, speaker) in enumerate(rows):
        # One hard bounce and one complaint in eighteen. Both states exist in the
        # model and neither is reachable on a demo where everything succeeded.
        bounced = index == 4
        complained = index == 11
        status = (
            MessageStatus.BOUNCED
            if bounced
            else MessageStatus.COMPLAINED
            if complained
            else MessageStatus.SENT
        )
        session.add(
            Message(
                org_id=event.org_id,
                event_id=event.id,
                batch_id=batch.id,
                to_email=speaker.email,
                to_speaker_id=speaker.id,
                subject=f"Your proposal for {event.name} was accepted",
                body_rendered=(
                    f"Hello {speaker.name},\n\n"
                    f"We would like to include \u201c{submission.title}\u201d at {event.name}."
                ),
                status=status,
                sent_at=went + timedelta(minutes=index),
                delivered_at=None if bounced else went + timedelta(minutes=index, seconds=40),
                bounced_at=went + timedelta(minutes=index, seconds=20) if bounced else None,
                error_detail=("550 5.1.1 recipient address does not exist" if bounced else None),
            )
        )
        submission.decision_status = DecisionStatus.SENT

    await session.flush()
    return len(rows)


async def _publish(session: AsyncSession, event: Event) -> int:
    """Put the programme on the public site.

    Without this a freshly seeded demo has a full console and a public half that
    returns 404 everywhere — every public page, every embed, the calendar feed —
    because they all read a snapshot that nobody had written yet. A conference
    that has already sent 18 acceptances has published its schedule; leaving that
    one step out made `make setup` produce an app whose front half did not exist.
    """
    if await snapshot.latest(session) is not None:
        return 0
    published = await snapshot.publish(
        session, event=event, user_id=None, note="Seeded demo programme"
    )
    return int(published.version)


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
    await deliverables.fill(session, event)
    await _roster_states(session, event, rng)
    scored = await _reviews(session, event, rng)
    sent = await _outbox(session, event)
    published = await _publish(session, event)

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
        "scored": scored,
        "sent": sent,
        "published": published,
        "tasks": int(
            await session.scalar(
                select(func.count(SpeakerTask.id)).where(SpeakerTask.event_id == event.id)
            )
            or 0
        ),
    }
    return counts
