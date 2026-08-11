import Link from "next/link";

import { NotPublished, PublicShell, getPublic, type EventInfo } from "../public";

export const dynamic = "force-dynamic";

type Session = {
  id: string; slug: string; title: string; abstract: string | null;
  starts_at: string | null; room: string | null; track: string | null;
  duration_minutes: number; speakers: { id: string; name: string }[];
  tags?: string[]; expertise_level?: string | null; language?: string | null;
};
type Payload = { event: EventInfo; sessions: Session[]; tracks: { id: string; name: string }[] };

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
  if (filters.level !== undefined && (session.expertise_level ?? "") !== filters.level) return false;
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
  display: "inline-block",
  padding: "5px 11px",
  borderRadius: 999,
  border: `1px solid ${on ? "var(--sg)" : "var(--ln)"}`,
  background: on ? "var(--sw)" : "var(--cd)",
  color: on ? "var(--sg)" : "var(--i2)",
  font: "500 12.5px var(--font-plex-sans)",
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
    <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
      <span
        style={{
          font: "600 10px var(--font-plex-sans)",
          letterSpacing: "0.08em",
          color: "var(--i4)",
          minWidth: 44,
        }}
      >
        {label}
      </span>
      <Link href={href(slug, filters, name, undefined) as never} style={chip(filters[name] === undefined)}>
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

  let data: Payload | null = null;
  try {
    data = await getPublic<Payload>(slug, "/schedule");
  } catch {
    data = null;
  }
  if (data === null) {
    const form = await getPublic<{ event_name: string; event_description: string | null }>(slug, "/cfp-form");
    return (
      <PublicShell
        event={{ name: form.event_name, slug, description: form.event_description, location: null, starts_on: new Date().toISOString(), ends_on: new Date().toISOString() }}
        slug={slug}
        active="Sessions"
      >
        <NotPublished what="schedule" />
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
              height: 36,
              padding: "0 12px",
              borderRadius: 999,
              border: "1px solid var(--ln)",
              background: "var(--cd)",
              color: "var(--ik)",
              font: "400 13.5px var(--font-plex-sans)",
            }}
          />
          <button
            type="submit"
            style={{
              height: 36,
              padding: "0 16px",
              borderRadius: 999,
              border: "none",
              background: "var(--sg)",
              color: "#FFFFFF",
              font: "600 12.5px var(--font-plex-sans)",
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

      <p style={{ color: "var(--i3)", margin: "0 0 16px", fontSize: 14 }}>
        {narrowed
          ? `${shown.length} of ${data.sessions.length} sessions`
          : `${data.sessions.length} sessions`}
        {narrowed && (
          <>
            {" · "}
            <Link href={`/e/${slug}/schedule` as never} style={{ color: "var(--sg)" }}>
              Clear filters
            </Link>
          </>
        )}
      </p>

      {shown.length === 0 ? (
        <p
          style={{
            font: "400 14px var(--font-plex-sans)",
            color: "var(--i3)",
            background: "var(--cd)",
            border: "1px solid var(--ln)",
            borderRadius: 14,
            padding: 24,
            margin: 0,
          }}
        >
          No sessions match that. <Link href={`/e/${slug}/schedule` as never} style={{ color: "var(--sg)" }}>Show all {data.sessions.length}</Link>.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {shown.map((session) => (
            <article
              key={session.id}
              style={{
                background: "var(--cd)",
                border: "1px solid var(--ln)",
                borderRadius: 14,
                borderLeft: "3px solid var(--sg)",
                padding: 20,
              }}
            >
              <h2 style={{ font: "600 17px var(--font-plex-sans)", color: "var(--ik)", margin: "0 0 6px" }}>
                <Link href={`/e/${slug}/schedule/${session.slug}` as never} style={{ color: "inherit", textDecoration: "none" }}>
                  {session.title}
                </Link>
              </h2>
              <p className="tabular" style={{ font: "400 12.5px var(--font-plex-mono)", color: "var(--i3)", margin: "0 0 8px" }}>
                {session.track ?? "Unassigned"} · {session.duration_minutes} min
                {session.room !== null ? ` · ${session.room}` : ""}
              </p>
              {session.abstract !== null && (
                <p style={{ font: "400 14px var(--font-plex-sans)", color: "var(--i2)", margin: "0 0 8px", lineHeight: 1.55 }}>
                  {session.abstract.length > 240 ? `${session.abstract.slice(0, 240)}…` : session.abstract}
                </p>
              )}
              <p style={{ font: "500 13px var(--font-plex-sans)", color: "var(--i2)", margin: 0 }}>
                {session.speakers.map((s) => s.name).join(", ")}
              </p>
            </article>
          ))}
        </div>
      )}
    </PublicShell>
  );
}
