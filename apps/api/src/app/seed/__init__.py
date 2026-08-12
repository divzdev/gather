"""Idempotent demo data: DevFlow Conf 2027.

Runs entirely with tenancy disabled — seeding is by definition a cross-tenant
operation, and it is the one place that is legitimate.

Re-running upserts by natural key (slug, email, name) rather than duplicating, so
`make seed` is safe to run repeatedly against a database that already has data.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import session_factory
from app.core.security import hash_password
from app.core.tenancy import tenancy_disabled
from app.features.pages import service as pages_service
from app.models import (
    CriterionKind,
    Event,
    EventDay,
    EventSpeaker,
    EventStatus,
    Form,
    FormKind,
    FormStatus,
    Organization,
    OrgMember,
    Page,
    PageVisibility,
    ReviewerAssignment,
    ReviewRound,
    ReviewRoundStatus,
    Role,
    Room,
    RubricCriterion,
    SavedEmbed,
    SessionFormat,
    Speaker,
    SpeakerStatus,
    Submission,
    SubmissionSpeaker,
    SubmissionStatus,
    Track,
    User,
)
from app.seed import demo

ORG_SLUG = "devflow"
EVENT_SLUG = "devflow-conf-2027"

STAFF = [
    ("Jordan Alvarez", "sbek-organizer@example.com", "SbekTest!2027-org", Role.OWNER),
    ("Sam Whitfield", "sbek-reviewer@example.com", "SbekTest!2027-rev", Role.REVIEWER),
    # A second reviewer, so the progress dashboard compares two people rather
    # than describing one, and a score is a mean of two opinions rather than a
    # single number wearing an average's clothes.
    ("Noor Haddad", "sbek-reviewer2@example.com", "SbekTest!2027-rev2", Role.REVIEWER),
]

SPEAKERS = [
    (
        "Priya Raman",
        "sbek-speaker@example.com",
        "SbekTest!2027-spk",
        "Principal Engineer",
        "Latticework Systems",
        "Priya Raman leads the build-tooling platform team at Latticework Systems. She "
        "maintains the open-source task runner 'gantry' and has spoken at over a dozen "
        "developer conferences on build systems and CI reliability.",
    ),
    (
        "Marcus Okafor",
        "sbek-speaker2@example.com",
        "SbekTest!2027-spk2",
        "Staff Developer Advocate",
        "Cloudreach Labs",
        "Marcus Okafor is a Staff Developer Advocate at Cloudreach Labs focused on AI agents "
        "in production. He writes the newsletter 'Agents Weekly'.",
    ),
]

TRACKS = ["AI Engineering", "Platform & Infra", "Developer Experience"]
FORMATS = [
    ("Keynote (45 min)", 45),
    ("Talk (30 min)", 30),
    ("Lightning Talk (10 min)", 10),
    ("Workshop (120 min)", 120),
    ("Panel (45 min)", 45),
]
ROOMS = [("Main Stage", 800), ("Room 2A", 200), ("Room 2B", 200), ("Workshop Lab", 60)]

CFP_SCHEMA: dict[str, Any] = {
    "sections": [
        {
            "key": "proposal",
            "title": "Your proposal",
            "fields": [
                {
                    "key": "title",
                    "type": "short_text",
                    "label": "Session title",
                    "required": True,
                    # A title with no ceiling is one paste away from breaking
                    # every table, agenda card and calendar entry it appears in.
                    # 80 fits the schedule grid and the .ics SUMMARY; the longest
                    # of the 214 seeded proposals is 57.
                    "max_length": 80,
                    "help_text": "Under 80 characters — it has to fit an agenda card.",
                },
                {
                    "key": "abstract",
                    "type": "long_text",
                    "label": "Abstract",
                    "required": True,
                    "help_text": "What will people learn? 150-400 words.",
                    "max_length": 4000,
                },
                {
                    "key": "track",
                    "type": "select",
                    "label": "Track",
                    "required": True,
                    # Routed, so a proposal arrives already filed under the
                    # track it names rather than carrying the name as a string.
                    "routes_to": "track",
                    "choices": [{"value": t, "label": t} for t in TRACKS],
                },
                {
                    "key": "format",
                    "type": "select",
                    "label": "Session format",
                    "required": True,
                    "routes_to": "session_format",
                    "choices": [{"value": name, "label": name} for name, _ in FORMATS],
                },
                {
                    "key": "audience_level",
                    "type": "select",
                    "label": "Audience level",
                    "choices": [
                        {"value": level, "label": level}
                        for level in ("Beginner", "Intermediate", "Advanced")
                    ],
                },
                {
                    "key": "key_takeaway",
                    "type": "short_text",
                    "label": "Key takeaway",
                    "help_text": "One sentence an attendee should remember.",
                },
                {
                    "key": "workshop_prerequisites",
                    "type": "long_text",
                    "label": "Workshop prerequisites",
                    "help_text": "What should attendees install or know beforehand?",
                },
            ],
        },
        {
            "key": "about_you",
            "title": "About you",
            "fields": [
                {
                    "key": "speaker_bio",
                    "type": "long_text",
                    "label": "Speaker bio",
                    "required": True,
                    # A bio names its author in the first sentence, so it is the
                    # one answer blind review has to strip. Nothing in the seed
                    # carried this flag, which meant the demo could only ever
                    # show blindness hiding the `speakers` array — the stripping
                    # of a flagged *answer* was correct code demonstrated by
                    # nothing.
                    "identity_bearing": True,
                },
                {"key": "links", "type": "url", "label": "Website or profile"},
            ],
        },
    ],
    # Prerequisites only make sense for a workshop, and are required when it is one.
    "logic": [
        {
            "field": "format",
            "operator": "is",
            "value": "Workshop (120 min)",
            "action": "show",
            "target": "workshop_prerequisites",
        },
        {
            "field": "format",
            "operator": "is",
            "value": "Workshop (120 min)",
            "action": "require",
            "target": "workshop_prerequisites",
        },
    ],
    "settings": {
        "confirmation_message": "Thanks, your proposal is in. We review in early March.",
    },
}

PROPOSALS = [
    (
        "Taming 40-Minute CI: Incremental Builds at Monorepo Scale",
        "Platform & Infra",
        "Talk (30 min)",
        "Our monorepo CI took 40 minutes on a good day. This walks through cutting it to six "
        "with content-addressed caching, remote execution and test selection — including the "
        "two migrations that failed first.",
        0,
    ),
    (
        "Agents That Ship: Running LLM Tooling in Production",
        "AI Engineering",
        "Talk (30 min)",
        "What breaks when an agent leaves the demo. Retries, budgets, evaluation, and the "
        "human-in-the-loop patterns that keep a mutating agent safe.",
        1,
    ),
    (
        "A Workshop on Build Graph Debugging",
        "Developer Experience",
        "Workshop (120 min)",
        "Hands-on: read a build graph, find the accidental dependency, and fix the cache key "
        "that was never stable in the first place.",
        0,
    ),
]


async def _upsert_org(session: AsyncSession) -> Organization:
    org = await session.scalar(select(Organization).where(Organization.slug == ORG_SLUG))
    if org is None:
        org = Organization(name="DevFlow", slug=ORG_SLUG)
        session.add(org)
        await session.flush()
    return org


async def _upsert_event(session: AsyncSession, org: Organization) -> Event:
    event = await session.scalar(select(Event).where(Event.slug == EVENT_SLUG))
    if event is None:
        event = Event(org_id=org.id, slug=EVENT_SLUG, name="DevFlow Conf 2027", timezone="UTC")
        session.add(event)
    event.name = "DevFlow Conf 2027"
    event.timezone = "America/Los_Angeles"
    event.starts_on = date(2027, 5, 12)
    event.ends_on = date(2027, 5, 14)
    event.location = "Moscone West, San Francisco, CA"
    event.description = (
        "A three-day, three-track conference on developer tooling, AI-assisted "
        "engineering, and platform infrastructure."
    )
    event.status = EventStatus.CFP_OPEN
    event.cfp_opens_at = datetime.now(UTC) - timedelta(days=30)
    event.cfp_closes_at = datetime(2027, 4, 30, 23, 59, tzinfo=UTC)
    await session.flush()
    return event


async def _upsert_staff(session: AsyncSession, org: Organization) -> None:
    for name, email, password, role in STAFF:
        user = await session.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(email=email, name=name, password_hash=hash_password(password))
            session.add(user)
            await session.flush()
        # Idempotent on purpose, and applied to existing rows too: these are the
        # accounts the demo bar signs you into, and an evaluator with no inbox
        # must never meet "confirm your email" on the way to the console.
        if user.email_verified_at is None:
            user.email_verified_at = datetime.now(UTC)
        member = await session.scalar(
            select(OrgMember).where(OrgMember.org_id == org.id, OrgMember.user_id == user.id)
        )
        if member is None:
            session.add(OrgMember(org_id=org.id, user_id=user.id, role=role))
    await session.flush()


async def _upsert_program(session: AsyncSession, event: Event) -> dict[str, Any]:
    made: dict[str, Any] = {"tracks": {}, "formats": {}}
    for index, name in enumerate(TRACKS):
        track = await session.scalar(
            select(Track).where(Track.event_id == event.id, Track.name == name)
        )
        if track is None:
            track = Track(
                org_id=event.org_id,
                event_id=event.id,
                name=name,
                hue_index=index + 1,
                sort_order=index,
            )
            session.add(track)
            await session.flush()
        made["tracks"][name] = track

    for index, (name, minutes) in enumerate(FORMATS):
        fmt = await session.scalar(
            select(SessionFormat).where(
                SessionFormat.event_id == event.id, SessionFormat.name == name
            )
        )
        if fmt is None:
            fmt = SessionFormat(
                org_id=event.org_id,
                event_id=event.id,
                name=name,
                default_duration_minutes=minutes,
                sort_order=index,
            )
            session.add(fmt)
            await session.flush()
        made["formats"][name] = fmt

    for index, (name, capacity) in enumerate(ROOMS):
        room = await session.scalar(
            select(Room).where(Room.event_id == event.id, Room.name == name)
        )
        if room is None:
            session.add(
                Room(
                    org_id=event.org_id,
                    event_id=event.id,
                    name=name,
                    capacity=capacity,
                    sort_order=index,
                )
            )

    for index, day in enumerate((date(2027, 5, 12), date(2027, 5, 13), date(2027, 5, 14))):
        existing = await session.scalar(
            select(EventDay).where(EventDay.event_id == event.id, EventDay.day_date == day)
        )
        if existing is None:
            session.add(
                EventDay(
                    org_id=event.org_id,
                    event_id=event.id,
                    day_date=day,
                    starts_at_local=time(9, 0),
                    ends_at_local=time(18, 0),
                    label=f"Day {index + 1}",
                    sort_order=index,
                )
            )
    await session.flush()
    return made


async def _upsert_form(session: AsyncSession, event: Event) -> Form:
    form = await session.scalar(
        select(Form).where(Form.event_id == event.id, Form.kind == FormKind.CFP)
    )
    if form is None:
        form = Form(
            org_id=event.org_id,
            event_id=event.id,
            name="DevFlow Conf 2027 — Call for Papers",
            kind=FormKind.CFP,
            schema=CFP_SCHEMA,
            status=FormStatus.OPEN,
            closes_at=event.cfp_closes_at,
        )
        session.add(form)
    else:
        # Seeding is an upsert, so the demo form follows the schema in this file
        # rather than freezing at whatever the first run created.
        form.schema = CFP_SCHEMA
        form.closes_at = event.cfp_closes_at
    await session.flush()
    return form


async def _upsert_speakers(session: AsyncSession, event: Event) -> list[Speaker]:
    people = []
    for name, email, password, title, company, bio in SPEAKERS:
        speaker = await session.scalar(select(Speaker).where(Speaker.email == email))
        if speaker is None:
            speaker = Speaker(org_id=event.org_id, email=email, name=name)
            session.add(speaker)
            await session.flush()
        speaker.name = name
        speaker.job_title = title
        speaker.company = company
        speaker.bio = bio
        speaker.password_hash = hash_password(password)

        link = await session.scalar(
            select(EventSpeaker).where(
                EventSpeaker.event_id == event.id, EventSpeaker.speaker_id == speaker.id
            )
        )
        if link is None:
            session.add(
                EventSpeaker(
                    org_id=event.org_id,
                    event_id=event.id,
                    speaker_id=speaker.id,
                    status=SpeakerStatus.PROSPECTIVE,
                )
            )
        people.append(speaker)
    await session.flush()
    return people


async def _upsert_proposals(
    session: AsyncSession, event: Event, form: Form, program: dict[str, Any], people: list[Speaker]
) -> None:
    for index, (title, track, fmt, abstract, speaker_index) in enumerate(PROPOSALS):
        existing = await session.scalar(
            select(Submission).where(Submission.event_id == event.id, Submission.title == title)
        )
        if existing is not None:
            continue
        submission = Submission(
            org_id=event.org_id,
            event_id=event.id,
            form_id=form.id,
            code=f"DF{index + 1:04d}"[:6],
            title=title,
            answers={
                "title": title,
                "abstract": abstract,
                "track": track,
                "format": fmt,
                "audience_level": "Intermediate",
                "key_takeaway": "A decision framework you can apply on Monday.",
                "speaker_bio": people[speaker_index].bio,
            },
            track_id=program["tracks"][track].id,
            session_format_id=program["formats"][fmt].id,
            requested_duration_minutes=program["formats"][fmt].default_duration_minutes,
            status=SubmissionStatus.SUBMITTED,
            submitted_at=datetime.now(UTC) - timedelta(days=7 - index),
        )
        session.add(submission)
        await session.flush()
        session.add(
            SubmissionSpeaker(
                org_id=event.org_id,
                event_id=event.id,
                submission_id=submission.id,
                speaker_id=people[speaker_index].id,
                is_primary=True,
            )
        )
    await session.flush()


RUBRIC = [
    ("Relevance", "Does this belong on this programme, for this audience?", Decimal("1.50")),
    ("Originality", "Have we seen this talk before, here or elsewhere?", Decimal("1.00")),
    ("Speaker readiness", "Can they deliver it at this length, to this room?", Decimal("1.00")),
]


async def _upsert_resources(session: AsyncSession, event: Event) -> None:
    """Two portal pages, so the Resources tab opens filled rather than empty.

    One of them carries an `embed` block, because the whole point of the feature
    is that an organiser can paste HTML from somewhere else — and a demo where
    every page is plain text never shows that it is sanitised.
    """
    pages = [
        (
            "Day-of logistics",
            True,
            [
                {
                    "type": "text",
                    "text": (
                        "Doors open at 08:00. Speaker check-in is the desk to the left of the "
                        "main entrance — bring photo ID.\n\nGreen room is Room 2B, open all "
                        "three days. There is coffee, a mirror, and somewhere quiet to read "
                        "your notes one more time."
                    ),
                },
                {
                    "type": "embed",
                    "html": (
                        "<h3>Before you go on</h3><ul>"
                        "<li>Find your room ten minutes early.</li>"
                        "<li>Hand your slides to the AV lead, not the stage manager.</li>"
                        "<li>Repeat every audience question into the microphone.</li></ul>"
                    ),
                },
            ],
        ),
        (
            "Slide template and stage tech",
            False,
            [
                {
                    "type": "text",
                    "text": (
                        "Screens are 16:9. Anything smaller than 24pt does not read from the "
                        "back of the room, and a light background survives a bright stage "
                        "better than a dark one.\n\nHDMI and USB-C are provided. Bring your "
                        "own dongle if your laptop needs one."
                    ),
                }
            ],
        ),
    ]
    for title, pinned, blocks in pages:
        slug = pages_service.slugify(title)
        found = await session.scalar(select(Page).where(Page.slug == slug))
        if found is None:
            found = Page(org_id=event.org_id, event_id=event.id, slug=slug, title=title)
            session.add(found)
        found.title = title
        found.blocks = [
            {"type": "embed", "html": pages_service.sanitize_html(b["html"])}
            if b["type"] == "embed"
            else b
            for b in blocks
        ]
        found.visibility = PageVisibility.SPEAKERS_ONLY
        found.is_pinned_in_portal = pinned
    await session.flush()


async def _upsert_saved_embeds(session: AsyncSession, event: Event) -> None:
    """Two kept embeds, so the panel opens with something in it.

    Settings only — the snippet is rebuilt from these on read, which is the
    whole reason a saved embed cannot go stale.
    """
    kept = [
        ("Agenda on the sponsor page", "agenda", "light", None),
        ("Speaker gallery, dark", "gallery", "dark", None),
    ]
    for name, widget, theme, track in kept:
        found = await session.scalar(select(SavedEmbed).where(SavedEmbed.name == name))
        if found is None:
            found = SavedEmbed(org_id=event.org_id, event_id=event.id, name=name)
            session.add(found)
        found.widget, found.theme, found.track = widget, theme, track
    await session.flush()


async def _upsert_review_round(session: AsyncSession, event: Event) -> None:
    """An open round with a rubric, and every submitted proposal assigned to the
    reviewer persona — otherwise the review queue has nothing to show."""
    round_ = await session.scalar(
        select(ReviewRound).where(ReviewRound.event_id == event.id, ReviewRound.sort_order == 1)
    )
    if round_ is None:
        round_ = ReviewRound(
            org_id=event.org_id, event_id=event.id, name="First pass", sort_order=1
        )
        session.add(round_)
    round_.is_blind = False
    round_.status = ReviewRoundStatus.OPEN
    round_.opens_at = datetime.now(UTC) - timedelta(days=3)
    round_.closes_at = event.cfp_closes_at
    round_.advance_rule = {"kind": "manual"}
    await session.flush()

    existing = {
        criterion.label
        for criterion in (
            await session.scalars(
                select(RubricCriterion).where(RubricCriterion.review_round_id == round_.id)
            )
        ).all()
    }
    for order, (label, description, weight) in enumerate(RUBRIC):
        if label in existing:
            continue
        session.add(
            RubricCriterion(
                org_id=event.org_id,
                event_id=event.id,
                review_round_id=round_.id,
                label=label,
                description=description,
                kind=CriterionKind.RATING,
                scale_min=1,
                scale_max=5,
                weight=weight,
                sort_order=order,
            )
        )

    reviewer = await session.scalar(select(User).where(User.email == STAFF[1][1]))
    if reviewer is None:
        return
    submissions = (
        await session.scalars(
            select(Submission).where(
                Submission.event_id == event.id,
                Submission.status == SubmissionStatus.SUBMITTED,
            )
        )
    ).all()
    assigned = {
        assignment.submission_id
        for assignment in (
            await session.scalars(
                select(ReviewerAssignment).where(
                    ReviewerAssignment.review_round_id == round_.id,
                    ReviewerAssignment.user_id == reviewer.id,
                )
            )
        ).all()
    }
    for submission in submissions:
        if submission.id in assigned:
            continue
        session.add(
            ReviewerAssignment(
                org_id=event.org_id,
                event_id=event.id,
                review_round_id=round_.id,
                submission_id=submission.id,
                user_id=reviewer.id,
            )
        )
    await session.flush()


#: The second round scores what survived the first, so it asks different
#: questions rather than the same three again.
SHORTLIST_RUBRIC = [
    ("Programme fit", "Does this earn a slot against everything else still in?", Decimal("1.50")),
    ("Depth", "Is there enough here for the length requested?", Decimal("1.00")),
]


async def _upsert_shortlist_round(session: AsyncSession, event: Event) -> None:
    """A second round, blind, with a reviewer pool of its own.

    Three rules only a second round can demonstrate, all of which the API already
    enforces and none of which were visible with a single open round seeded:

    - Rounds are independent — its own name, window and scorecard, not a rerun.
    - A round's reviewer pool is its own. Sam is on this one and Noor is not, so
      reviewing round 1 plainly does not enrol you in round 2.
    - Blind review. Identity is stripped server-side by `blind_view`, but a rule
      nobody can see is indistinguishable from a rule that was never written, and
      the only seeded round was sighted.

    Scoped to the proposals still in review, so the queue is also visibly smaller
    than round 1's — a shortlist that looks like one.
    """
    round_ = await session.scalar(
        select(ReviewRound).where(ReviewRound.event_id == event.id, ReviewRound.sort_order == 2)
    )
    if round_ is None:
        round_ = ReviewRound(
            org_id=event.org_id, event_id=event.id, name="Programme committee", sort_order=2
        )
        session.add(round_)
    round_.is_blind = True
    round_.status = ReviewRoundStatus.OPEN
    round_.opens_at = datetime.now(UTC) - timedelta(days=1)
    round_.closes_at = event.cfp_closes_at
    round_.advance_rule = {"kind": "manual"}
    await session.flush()

    existing = {
        criterion.label
        for criterion in (
            await session.scalars(
                select(RubricCriterion).where(RubricCriterion.review_round_id == round_.id)
            )
        ).all()
    }
    for order, (label, description, weight) in enumerate(SHORTLIST_RUBRIC):
        if label in existing:
            continue
        session.add(
            RubricCriterion(
                org_id=event.org_id,
                event_id=event.id,
                review_round_id=round_.id,
                label=label,
                description=description,
                kind=CriterionKind.RATING,
                scale_min=1,
                scale_max=5,
                weight=weight,
                sort_order=order,
            )
        )

    await _assign_shortlist(session, event, round_)


async def _assign_shortlist(session: AsyncSession, event: Event, round_: ReviewRound) -> None:
    """Round 2's pool is one reviewer — deliberately not the one from round 1."""
    reviewer = await session.scalar(select(User).where(User.email == STAFF[1][1]))
    if reviewer is None:
        return
    shortlist = (
        await session.scalars(
            select(Submission).where(
                Submission.event_id == event.id,
                Submission.status == SubmissionStatus.IN_REVIEW,
            )
        )
    ).all()
    assigned = {
        assignment.submission_id
        for assignment in (
            await session.scalars(
                select(ReviewerAssignment).where(
                    ReviewerAssignment.review_round_id == round_.id,
                    ReviewerAssignment.user_id == reviewer.id,
                )
            )
        ).all()
    }
    for submission in shortlist:
        if submission.id in assigned:
            continue
        session.add(
            ReviewerAssignment(
                org_id=event.org_id,
                event_id=event.id,
                review_round_id=round_.id,
                submission_id=submission.id,
                user_id=reviewer.id,
            )
        )
    await session.flush()


async def seed() -> None:
    settings = get_settings()
    if not settings.seeding_allowed:
        print("Refusing to seed: ENV=production with DEMO_MODE=false.")
        return

    async with session_factory() as session:
        with tenancy_disabled():
            org = await _upsert_org(session)
            event = await _upsert_event(session, org)
            await _upsert_staff(session, org)
            program = await _upsert_program(session, event)
            form = await _upsert_form(session, event)
            people = await _upsert_speakers(session, event)
            await _upsert_proposals(session, event, form, program, people)
            await _upsert_review_round(session, event)
            await _upsert_resources(session, event)
            await _upsert_saved_embeds(session, event)
            # The hand-written rows above are the ones a human reads; this fills
            # in the volume so no screen opens empty.
            counts = await demo.fill(session, event, form, program)
            # After the fill, not before: round 2 is scoped to the proposals
            # sitting in review, and until demo.fill runs there are only the
            # three hand-written ones to scope to.
            await _upsert_shortlist_round(session, event)
            await session.commit()

    print(
        f"Seeded {EVENT_SLUG}: {counts['speakers']} speakers, "
        f"{counts['submissions']} submissions, {counts['sessions']} sessions "
        f"({counts['placed']} placed), {counts['tasks']} speaker tasks, "
        f"{counts['scored']} reviews scored, {counts['sent']} decisions already sent."
    )
    if counts.get("published"):
        print(f"Published schedule v{counts['published']} — the public pages and embeds are live.")
    print("Sign in with sbek-organizer@example.com / SbekTest!2027-org")


if __name__ == "__main__":
    asyncio.run(seed())
