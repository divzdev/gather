import Link from "next/link";

import { PublicShell, getPublic, getPublicOptional, type EventInfo } from "../public";
import { Card, Chip, Dot, INK, MONO, SANS, display, trackHue } from "../chrome";
import { NotPublished } from "../chrome";
import { calendarDate, eventTime } from "../public";

export const dynamic = "force-dynamic";

type Session = {
  id: string;
  slug: string;
  title: string;
  abstract: string | null;
  starts_at: string | null;
  room: string | null;
  track: string | null;
  duration_minutes: number;
  /** Role and employer come down in the published snapshot and were dropped on
   *  the floor here, so a card said "Beatriz Fontaine" where the payload said
   *  "Beatriz Fontaine, Head of Data at Harbour Labs". Who someone is is most of
   *  why an attendee picks one talk over another in the same slot. */
  speakers: { id: string; name: string; job_title?: string | null; company?: string | null }[];
  tags?: string[];
  expertise_level?: string | null;
  language?: string | null;
};
type Payload = {
  event: EventInfo;
  sessions: Session[];
  tracks: { id: string; name: string; hue_index: number }[];
};

/** Narrowing lives in the query string, so this page stays a Server Component,
 *  works with JavaScript off, and a filtered view is a link someone can send.
 *  Sixty sessions across two days is unreadable as one flat list. */
type Filters = {
  day?: string;
  track?: string;
  room?: string;
  q?: string;
  tag?: string;
  level?: string;
  language?: string;
};

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

function dayOf(session: Session): string | null {
  return session.starts_at === null ? null : session.starts_at.slice(0, 10);
}

function matches(session: Session, filters: Filters): boolean {
  if (filters.day !== undefined && dayOf(session) !== filters.day) return false;
  if (filters.track !== undefined && (session.track ?? "") !== filters.track) return false;
  if (filters.room !== undefined && (session.room ?? "") !== filters.room) return false;
  // `?? []` throughout: a snapshot published before these fields existed is
  // still served, and must filter to nothing rather than throw.
  if (filters.tag !== undefined && !(session.tags ?? []).includes(filters.tag)) return false;
  if (filters.level !== undefined && (session.expertise_level ?? "") !== filters.level)
    return false;
  if (filters.language !== undefined && (session.language ?? "") !== filters.language) return false;
  if (filters.q !== undefined && filters.q.trim() !== "") {
    const needle = filters.q.trim().toLowerCase();
    const hay = [session.title, session.abstract ?? "", ...session.speakers.map((s) => s.name)]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

/** A filter link that keeps whatever else is already narrowed. */
function href(slug: string, filters: Filters, key: keyof Filters, value: string | undefined) {
  const next = new URLSearchParams();
  for (const [name, current] of Object.entries({ ...filters, [key]: value })) {
    if (current !== undefined && current !== "") next.set(name, current);
  }
  const query = next.toString();
  return `/e/${slug}/schedule${query === "" ? "" : `?${query}`}`;
}

const chip = (on: boolean) => ({
  display: "inline-flex",
  alignItems: "center" as const,
  minHeight: "var(--control-h-sm)",
  padding: "0 14px",
  borderRadius: 999,
  border: `1px solid ${on ? "var(--e-accent, #FF6B6B)" : "var(--e-edge, rgba(255,255,255,.10))"}`,
  background: on
    ? "color-mix(in srgb, var(--e-accent, #FF6B6B) 15%, transparent)"
    : "var(--e-raised, #101018)",
  color: on ? "var(--e-accent, #FF6B6B)" : "var(--e-muted, #9A9FB1)",
  font: "500 12.5px var(--font-manrope), sans-serif",
  textDecoration: "none",
  whiteSpace: "nowrap" as const,
});

function Row({
  label,
  options,
  slug,
  filters,
  name,
}: {
  label: string;
  options: string[];
  slug: string;
  filters: Filters;
  name: keyof Filters;
}) {
  if (options.length < 2) return null;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span
        style={{
          font: "600 10px var(--font-manrope), sans-serif",
          letterSpacing: "0.08em",
          color: "var(--e-faint, #7C8093)",
          minWidth: 44,
        }}
      >
        {label}
      </span>
      <Link
        href={href(slug, filters, name, undefined) as never}
        style={chip(filters[name] === undefined)}
      >
        All
      </Link>
      {options.map((option) => (
        <Link
          key={option}
          href={href(slug, filters, name, option) as never}
          style={chip(filters[name] === option)}
        >
          {name === "day" ? DAY.format(new Date(`${option}T12:00:00`)) : option}
        </Link>
      ))}
    </div>
  );
}

export default async function SessionsList({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const one = (key: string): string | undefined => {
    const value = query[key];
    const text = Array.isArray(value) ? value[0] : value;
    return text === undefined || text === "" ? undefined : text;
  };
  const filters: Filters = {
    day: one("day"),
    track: one("track"),
    tag: one("tag"),
    level: one("level"),
    language: one("language"),
    room: one("room"),
    q: one("q"),
  };

  const data = await getPublicOptional<Payload>(slug, "/schedule");
  if (data === null) {
    const form = await getPublic<{
      event_name: string;
      event_description: string | null;
      event_starts_on: string;
      event_ends_on: string;
      event_location: string | null;
      event_timezone: string;
    }>(slug, "/cfp-form");
    return (
      <PublicShell
        event={{
          name: form.event_name,
          slug,
          description: form.event_description,
          location: form.event_location,
          starts_on: form.event_starts_on,
          ends_on: form.event_ends_on,
          timezone: form.event_timezone,
        }}
        slug={slug}
        active="Sessions"
        programmePublished={false}
      >
        <NotPublished what="schedule" slug={slug} />
      </PublicShell>
    );
  }

  const unique = (values: (string | null)[]) =>
    [...new Set(values.filter((value): value is string => value !== null && value !== ""))].sort();
  const days = unique(data.sessions.map(dayOf));
  const tracks = unique(data.sessions.map((session) => session.track));
  const tags = unique(data.sessions.flatMap((session) => session.tags ?? []));
  const languages = unique(data.sessions.map((session) => session.language ?? null));
  // Ordered by difficulty. Alphabetical would read advanced, beginner,
  // intermediate, which is sorted and still wrong.
  const levels = ["beginner", "intermediate", "advanced"].filter((level) =>
    data.sessions.some((session) => session.expertise_level === level),
  );
  const rooms = unique(data.sessions.map((session) => session.room));

  const shown = data.sessions.filter((session) => matches(session, filters));
  const narrowed = Object.values(filters).some((value) => value !== undefined);

  return (
    <PublicShell event={data.event} slug={slug} active="Sessions">
      <div style={{ display: "grid", gap: 10, margin: "0 0 18px" }}>
        <form action={`/e/${slug}/schedule`} method="get" style={{ display: "flex", gap: 6 }}>
          {/* Carried through so searching does not silently drop the chips. */}
          {(["day", "track", "room"] as const).map((key) =>
            filters[key] === undefined ? null : (
              <input key={key} type="hidden" name={key} value={filters[key]} />
            ),
          )}
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            aria-label="Search sessions and speakers"
            placeholder="Search a talk or a speaker"
            style={{
              flex: 1,
              minWidth: 0,
              height: 44,
              padding: "0 18px",
              borderRadius: 999,
              border: `1px solid ${INK.edge}`,
              background: INK.raised,
              color: INK.text,
              fontFamily: SANS,
              fontSize: 14.5,
              outline: "none",
            }}
          />
          <button
            type="submit"
            style={{
              height: 44,
              padding: "0 24px",
              borderRadius: 999,
              border: "none",
              background: INK.text,
              color: "#0A0B12",
              fontFamily: SANS,
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            Search
          </button>
        </form>

        <Row label="DAY" options={days} slug={slug} filters={filters} name="day" />
        <Row label="TRACK" options={tracks} slug={slug} filters={filters} name="track" />
        <Row label="LEVEL" options={levels} slug={slug} filters={filters} name="level" />
        <Row label="TAG" options={tags} slug={slug} filters={filters} name="tag" />
        <Row label="LANG" options={languages} slug={slug} filters={filters} name="language" />
        <Row label="ROOM" options={rooms} slug={slug} filters={filters} name="room" />
      </div>

      <p style={{ color: "var(--e-muted, #9A9FB1)", margin: "0 0 16px", fontSize: 14 }}>
        {narrowed
          ? `${shown.length} of ${data.sessions.length} sessions`
          : `${data.sessions.length} sessions`}
        {narrowed && (
          <>
            {" · "}
            <Link
              href={`/e/${slug}/schedule` as never}
              style={{ color: "var(--e-accent, #FF6B6B)" }}
            >
              Clear filters
            </Link>
          </>
        )}
      </p>

      {shown.length === 0 ? (
        <p
          style={{
            font: "400 14px var(--font-manrope), sans-serif",
            color: "var(--e-muted, #9A9FB1)",
            background: "var(--e-raised, #101018)",
            border: "1px solid var(--e-edge, rgba(255,255,255,.10))",
            borderRadius: 14,
            padding: 24,
            margin: 0,
          }}
        >
          No sessions match that.{" "}
          <Link href={`/e/${slug}/schedule` as never} style={{ color: "var(--e-accent, #FF6B6B)" }}>
            Show all {data.sessions.length}
          </Link>
          .
        </p>
      ) : (
        <Grouped sessions={shown} tracks={data.tracks} slug={slug} timezone={data.event.timezone} />
      )}
    </PublicShell>
  );
}

/** Sixty-one talks as one flat list is a wall. Grouped by the day they run, in
 *  the order they run, so scanning it answers "what is on Wednesday morning"
 *  rather than "what exists". */
function Grouped({
  sessions,
  tracks,
  slug,
  timezone,
}: {
  sessions: Session[];
  tracks: { id: string; name: string; hue_index: number }[];
  slug: string;
  timezone: string;
}) {
  const hueOf = (track: string | null): string => {
    const found = tracks.find((candidate) => candidate.name === track);
    return found === undefined ? INK.muted : trackHue(found.hue_index);
  };

  const byDay = new Map<string, Session[]>();
  for (const session of sessions) {
    const key = dayOf(session) ?? "unscheduled";
    byDay.set(key, [...(byDay.get(key) ?? []), session]);
  }
  const ordered = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [, group] of ordered) {
    group.sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? ""));
  }

  return (
    <div style={{ display: "grid", gap: 40 }}>
      {ordered.map(([date, group]) => (
        <section key={date}>
          <h2
            style={{
              ...display("1.4rem", 700),
              color: INK.text,
              paddingBottom: 12,
              marginBottom: 18,
              borderBottom: `1px solid ${INK.edge}`,
              display: "flex",
              alignItems: "baseline",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            {date === "unscheduled"
              ? "Not scheduled yet"
              : calendarDate(date, { weekday: "long", day: "numeric", month: "long" })}
            <span
              style={{
                fontFamily: MONO,
                fontSize: 12,
                fontWeight: 400,
                letterSpacing: ".1em",
                color: INK.faint,
              }}
            >
              {group.length} {group.length === 1 ? "SESSION" : "SESSIONS"}
            </span>
          </h2>

          <div style={{ display: "grid", gap: 12 }}>
            {group.map((session) => {
              const hue = hueOf(session.track);
              return (
                <Card key={session.id} hue={hue} padding={20}>
                  <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 78 }}>
                      <div
                        style={{
                          fontFamily: MONO,
                          fontSize: 17,
                          color: INK.text,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {session.starts_at === null ? "—" : eventTime(session.starts_at, timezone)}
                      </div>
                      <div
                        style={{ fontFamily: MONO, fontSize: 11.5, color: INK.faint, marginTop: 4 }}
                      >
                        {session.duration_minutes} MIN
                      </div>
                    </div>

                    <div style={{ flex: 1, minWidth: 220 }}>
                      <h3 style={{ ...display("1.15rem", 700), color: INK.text, margin: 0 }}>
                        <Link
                          href={`/e/${slug}/schedule/${session.slug}` as never}
                          style={{ color: "inherit", textDecoration: "none" }}
                        >
                          {session.title}
                        </Link>
                      </h3>
                      {session.speakers.length === 0 ? null : (
                        <p
                          style={{
                            fontFamily: SANS,
                            fontSize: 14,
                            fontWeight: 600,
                            color: INK.muted,
                            margin: "8px 0 0",
                          }}
                        >
                          {session.speakers
                            .map((speaker) => {
                              const role = [speaker.job_title, speaker.company]
                                .filter(Boolean)
                                .join(", ");
                              return role === "" ? speaker.name : `${speaker.name}, ${role}`;
                            })
                            .join(" · ")}
                        </p>
                      )}
                      {session.abstract === null ? null : (
                        <p
                          style={{
                            fontFamily: SANS,
                            fontSize: 14.5,
                            color: INK.muted,
                            fontWeight: 500,
                            lineHeight: 1.55,
                            margin: "10px 0 0",
                          }}
                        >
                          {session.abstract.length > 190
                            ? `${session.abstract.slice(0, 190)}…`
                            : session.abstract}
                        </p>
                      )}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                        {session.track === null ? null : (
                          <Chip hue={hue}>
                            <Dot hue={hue} />
                            {session.track}
                          </Chip>
                        )}
                        {session.room === null ? null : <Chip>{session.room}</Chip>}
                        {session.expertise_level === null ||
                        session.expertise_level === undefined ? null : (
                          <Chip>{session.expertise_level}</Chip>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
