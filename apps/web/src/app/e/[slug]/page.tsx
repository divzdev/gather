import type { Metadata } from "next";

import {
  Card,
  Chip,
  Cta,
  Dot,
  INK,
  Initials,
  MONO,
  SANS,
  Section,
  display,
  trackHue,
} from "./chrome";
import { PublicShell, calendarDate, eventTime, getPublic, getPublicOptional } from "./public";
import type { EventInfo } from "./public";

export const dynamic = "force-dynamic";

type Form = {
  event_name: string;
  event_description: string | null;
  event_starts_on: string;
  event_ends_on: string;
  event_location: string | null;
  event_timezone: string;
  is_open: boolean;
  closes_at: string | null;
};

type Schedule = {
  event: EventInfo;
  tracks: { id: string; name: string; hue_index: number }[];
  days: { id: string; date: string; label: string | null; starts_at_local: string | null }[];
  sessions: {
    id: string;
    slug: string;
    title: string;
    track: string | null;
    room: string | null;
    starts_at: string | null;
    duration_minutes: number;
    speakers: { id: string; name: string }[];
  }[];
};

type Gallery = {
  speakers: { id: string; name: string; company: string | null; job_title: string | null }[];
};

/** One of three conference photographs, chosen by slug so two events do not
 *  look like the same page. Not per-event artwork — the data model has no place
 *  for one yet — but a great deal better than a flat panel, and self-hosted so
 *  it works with no network. */
function heroPhoto(slug: string): string {
  const photos = ["audience", "keynote-hall", "backstage"];
  const seed = [...slug].reduce((total, character) => total + character.charCodeAt(0), 0);
  return `/design/photos/${photos[seed % photos.length] ?? "audience"}.webp`;
}

function countdown(closesAt: string): number {
  return Math.ceil((new Date(closesAt).getTime() - Date.now()) / 86_400_000);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const form = await getPublic<Form>(slug, "/cfp-form");
  const when = `${calendarDate(form.event_starts_on, { day: "numeric", month: "long" })} – ${calendarDate(form.event_ends_on, { day: "numeric", month: "long", year: "numeric" })}`;
  return {
    title: form.event_name,
    description:
      form.event_description ??
      `${form.event_name}, ${when}${form.event_location === null ? "" : `, ${form.event_location}`}.`,
  };
}

export default async function EventHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [form, schedule, gallery] = await Promise.all([
    getPublic<Form>(slug, "/cfp-form"),
    getPublicOptional<Schedule>(slug, "/schedule"),
    getPublicOptional<Gallery>(slug, "/gallery"),
  ]);

  const event: EventInfo = {
    name: form.event_name,
    slug,
    description: form.event_description,
    location: form.event_location,
    starts_on: form.event_starts_on,
    ends_on: form.event_ends_on,
    timezone: form.event_timezone,
  };

  const sessions = schedule?.sessions ?? [];
  const published = schedule !== null && sessions.length > 0;
  // Days the programme actually runs, not days the organiser configured. An
  // event can hold a third day open and schedule nothing on it, and counting
  // those made the strip say "3 days" directly above a section headed "2 days".
  const days = new Set(sessions.map((session) => session.starts_at?.slice(0, 10)).filter(Boolean))
    .size;
  const speakers = gallery?.speakers ?? [];
  const daysToClose = form.closes_at === null ? null : countdown(form.closes_at);

  return (
    <PublicShell
      event={event}
      slug={slug}
      active="About"
      hero={{ photo: heroPhoto(slug) }}
      banner={
        <Hero
          event={event}
          isOpen={form.is_open}
          daysToClose={daysToClose}
          published={published}
          slug={slug}
        />
      }
    >
      {published ? (
        <>
          <Stats
            sessions={sessions.length}
            speakers={speakers.length}
            tracks={schedule?.tracks.length ?? 0}
            days={days}
          />
          <Programme schedule={schedule} timezone={event.timezone} slug={slug} />
          <Tracks schedule={schedule} slug={slug} />
          <Faces speakers={speakers} slug={slug} />
          <Closing slug={slug} />
        </>
      ) : (
        <Coming isOpen={form.is_open} daysToClose={daysToClose} slug={slug} />
      )}
    </PublicShell>
  );
}

function Hero({
  event,
  isOpen,
  daysToClose,
  published,
  slug,
}: {
  event: EventInfo;
  isOpen: boolean;
  daysToClose: number | null;
  published: boolean;
  slug: string;
}) {
  const from = calendarDate(event.starts_on, { day: "numeric", month: "short" });
  const to = calendarDate(event.ends_on, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 max(22px,4vw)" }}>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 12.5,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: INK.muted,
          marginBottom: 18,
        }}
      >
        {from} – {to}
        {event.location === null ? "" : ` · ${event.location}`}
      </div>
      <h1 style={{ ...display("clamp(2.6rem,6.4vw,5.2rem)"), color: INK.text, maxWidth: "13em" }}>
        {event.name}
      </h1>
      {event.description === null ? null : (
        <p
          style={{
            fontFamily: SANS,
            fontSize: "clamp(1.05rem,1.5vw,1.3rem)",
            fontWeight: 500,
            lineHeight: 1.6,
            color: "#C9CDDA",
            margin: "26px 0 0",
            maxWidth: "40em",
          }}
        >
          {event.description}
        </p>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "28px 0 0" }}>
        {isOpen ? (
          <Chip hue={INK.accent}>
            <Dot hue={INK.accent} />
            {daysToClose === null
              ? "Call for papers open"
              : daysToClose <= 0
                ? "Call for papers closes today"
                : `Call for papers closes in ${daysToClose} ${daysToClose === 1 ? "day" : "days"}`}
          </Chip>
        ) : (
          <Chip>The call for papers has closed</Chip>
        )}
        {published ? (
          <Chip hue="#63BC85">
            <Dot hue="#63BC85" />
            Programme published
          </Chip>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 32 }}>
        {published ? <Cta href={`/e/${slug}/schedule`}>See the programme</Cta> : null}
        {isOpen ? (
          <Cta href={`/e/${slug}/cfp`} tone={published ? "outline" : "solid"}>
            Submit a talk
          </Cta>
        ) : null}
        {published ? (
          <Cta href={`/e/${slug}/itinerary`} tone="outline">
            Build your schedule
          </Cta>
        ) : null}
      </div>
    </div>
  );
}

function Stats(counts: { sessions: number; speakers: number; tracks: number; days: number }) {
  const items = [
    ["sessions", counts.sessions],
    ["speakers", counts.speakers],
    ["tracks", counts.tracks],
    ["days", counts.days],
  ] as const;

  return (
    <Section tight>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
          gap: 18,
          borderTop: `1px solid ${INK.edge}`,
          borderBottom: `1px solid ${INK.edge}`,
          padding: "34px 0",
        }}
      >
        {items
          .filter(([, value]) => value > 0)
          .map(([label, value]) => (
            <div key={label}>
              <div
                style={{
                  ...display("clamp(2rem,3.4vw,2.9rem)"),
                  color: INK.text,
                  fontVariantNumeric: "tabular-nums",
                }}
                data-count={value}
              >
                {value}
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 12,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: INK.faint,
                  marginTop: 8,
                }}
              >
                {label}
              </div>
            </div>
          ))}
      </div>
    </Section>
  );
}

function Programme({
  schedule,
  timezone,
  slug,
}: {
  schedule: Schedule | null;
  timezone: string;
  slug: string;
}) {
  if (schedule === null) return null;
  const byDay = new Map<string, Schedule["sessions"]>();
  for (const session of schedule.sessions) {
    if (session.starts_at === null) continue;
    const key = session.starts_at.slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), session]);
  }
  const ordered = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (ordered.length === 0) return null;

  return (
    <Section
      eyebrow="The programme"
      title={ordered.length === 1 ? "One day, planned to the minute." : `${ordered.length} days.`}
      lede="Every talk, when it runs and who is giving it. Pick the ones you want and the schedule builds itself."
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          gap: 18,
        }}
      >
        {ordered.map(([date, daySessions], index) => {
          const times = daySessions
            .map((session) => session.starts_at)
            .filter((value): value is string => value !== null)
            .sort();
          const opens = times[0];
          const closes = times[times.length - 1];
          const label = schedule.days.find((day) => day.date === date)?.label;
          return (
            <Card key={date} hue={trackHue(index)}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 12,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: trackHue(index),
                }}
              >
                {label ?? `Day ${index + 1}`}
              </div>
              <div style={{ ...display("1.5rem", 700), color: INK.text, margin: "10px 0 14px" }}>
                {calendarDate(date, { weekday: "long", day: "numeric", month: "long" })}
              </div>
              <div style={{ fontFamily: SANS, fontSize: 14.5, color: INK.muted, fontWeight: 500 }}>
                {daySessions.length} {daySessions.length === 1 ? "session" : "sessions"}
                {opens === undefined || closes === undefined
                  ? ""
                  : ` · ${eventTime(opens, timezone)}–${eventTime(closes, timezone)}`}
              </div>
              <a
                href={`/e/${slug}/schedule?day=${date}`}
                style={{
                  display: "inline-block",
                  marginTop: 18,
                  fontFamily: SANS,
                  fontSize: 14,
                  fontWeight: 700,
                  color: INK.text,
                  textDecoration: "none",
                  borderBottom: `1px solid ${INK.edgeStrong}`,
                  paddingBottom: 2,
                }}
              >
                See this day →
              </a>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}

function Tracks({ schedule, slug }: { schedule: Schedule | null; slug: string }) {
  if (schedule === null || schedule.tracks.length === 0) return null;
  const count = (name: string) =>
    schedule.sessions.filter((session) => session.track === name).length;

  return (
    <Section eyebrow="Tracks" title="Follow one thread, or wander.">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
          gap: 18,
        }}
      >
        {schedule.tracks.map((track) => {
          const hue = trackHue(track.hue_index);
          return (
            <a
              key={track.id}
              href={`/e/${slug}/schedule?track=${encodeURIComponent(track.name)}`}
              style={{ textDecoration: "none" }}
            >
              <Card hue={hue}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Dot hue={hue} />
                  <span style={{ ...display("1.25rem", 700), color: INK.text }}>{track.name}</span>
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 12.5,
                    color: INK.faint,
                    marginTop: 12,
                    letterSpacing: ".08em",
                  }}
                >
                  {count(track.name)} SESSIONS
                </div>
              </Card>
            </a>
          );
        })}
      </div>
    </Section>
  );
}

function Faces({ speakers, slug }: { speakers: Gallery["speakers"]; slug: string }) {
  if (speakers.length === 0) return null;
  const shown = speakers.slice(0, 12);

  return (
    <Section
      eyebrow="Speakers"
      title={`${speakers.length} people are talking.`}
      lede="Engineers, maintainers and the occasional person who has been paged at 3am about the thing they are about to describe."
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))",
          gap: 14,
        }}
      >
        {shown.map((speaker) => (
          <div
            key={speaker.id}
            style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0" }}
          >
            <Initials name={speaker.name} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 15,
                  fontWeight: 700,
                  color: INK.text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {speaker.name}
              </div>
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 13,
                  color: INK.faint,
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {[speaker.job_title, speaker.company].filter(Boolean).join(" · ") || "Speaker"}
              </div>
            </div>
          </div>
        ))}
      </div>
      {speakers.length > shown.length ? (
        <div style={{ marginTop: 28 }}>
          <Cta href={`/e/${slug}/speakers`} tone="outline">
            All {speakers.length} speakers
          </Cta>
        </div>
      ) : null}
    </Section>
  );
}

function Closing({ slug }: { slug: string }) {
  return (
    <Section>
      <div
        style={{
          borderRadius: 24,
          padding: "clamp(36px,6vw,72px)",
          textAlign: "center",
          background: `radial-gradient(90% 130% at 50% 0%, rgba(255,107,107,.16), transparent 70%), ${INK.raised}`,
          border: `1px solid ${INK.edge}`,
        }}
      >
        <h2 style={{ ...display("clamp(1.7rem,3vw,2.6rem)"), color: INK.text }}>
          Decide what you are going to on the day you arrive.
        </h2>
        <p
          style={{
            fontFamily: SANS,
            fontSize: 15.5,
            color: INK.muted,
            fontWeight: 500,
            margin: "16px auto 30px",
            maxWidth: "34em",
            lineHeight: 1.6,
          }}
        >
          Tick the talks you want. Your picks survive a reload, warn you when two overlap, and
          download as a calendar file that keeps up when the schedule moves.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Cta href={`/e/${slug}/itinerary`}>Build your schedule</Cta>
          <Cta href={`/e/${slug}/speakers`} tone="outline">
            Browse the speakers
          </Cta>
        </div>
      </div>
    </Section>
  );
}

/** What an event looks like before anything is published — which is most of its
 *  life, and the state this page used to render as a single grey card holding
 *  one sentence. */
function Coming({
  isOpen,
  daysToClose,
  slug,
}: {
  isOpen: boolean;
  daysToClose: number | null;
  slug: string;
}) {
  const steps = [
    ["Proposals", isOpen ? "Open now" : "Closed", "Anyone can submit a talk. No account needed."],
    ["Review", "Next", "Every proposal is read and scored against a published rubric."],
    ["The programme", "Then", "Sessions, speakers, rooms and times, all at once."],
  ] as const;

  return (
    <Section
      eyebrow="What happens next"
      title="The programme is still being built."
      lede="Nothing is hidden — there is genuinely nothing to show yet. Here is the order it arrives in."
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
          gap: 18,
        }}
      >
        {steps.map(([title, when, body], index) => (
          <Card key={title} hue={trackHue(index)}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Dot hue={trackHue(index)} />
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 11.5,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: trackHue(index),
                }}
              >
                {when}
              </span>
            </div>
            <div style={{ ...display("1.3rem", 700), color: INK.text }}>{title}</div>
            <p
              style={{
                fontFamily: SANS,
                fontSize: 14.5,
                color: INK.muted,
                fontWeight: 500,
                lineHeight: 1.6,
                margin: "10px 0 0",
              }}
            >
              {body}
            </p>
          </Card>
        ))}
      </div>
      {isOpen ? (
        <div style={{ marginTop: 32, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Cta href={`/e/${slug}/cfp`}>Submit a talk</Cta>
          {daysToClose !== null && daysToClose > 0 ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                fontFamily: SANS,
                fontSize: 14,
                color: INK.faint,
                fontWeight: 600,
              }}
            >
              {daysToClose} {daysToClose === 1 ? "day" : "days"} left to send one
            </span>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}
