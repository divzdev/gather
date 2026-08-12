"use client";

/** Building a personal schedule without an account.
 *
 *  The picks live in the URL, which is the whole design: an attendee can bookmark
 *  their plan, send it to a colleague, or open it on their phone, and none of
 *  that needs a login or a cookie. localStorage would be private to one browser
 *  and a server-side list would need an account.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

type Session = {
  id: string;
  slug: string;
  title: string;
  starts_at: string | null;
  room: string | null;
  track: string | null;
  duration_minutes: number;
  speakers: { id: string; name: string }[];
};

/** Was pinned to UTC, so it disagreed with the agenda *and* with the event.
 *  Both pages read the event's own zone now, which is the invariant CLAUDE.md
 *  states and the one thing that makes two views of the same instant agree. */
const when = (timezone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  });

/** Sortable, in the event's zone. `en-CA` is the shortest way to a real
 *  `YYYY-MM-DD`; slicing the ISO string instead would group by UTC and put a
 *  09:00 Sydney talk on the previous day. */
const dayKey = (timezone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  });

const dayName = (timezone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timezone,
  });

const clock = (timezone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  });

const UNDATED = "zzzz";

export function Picker({
  slug,
  sessions,
  timezone,
}: {
  slug: string;
  sessions: Session[];
  timezone: string;
}) {
  const WHEN = when(timezone);
  const CLOCK = clock(timezone);
  const router = useRouter();
  const params = useSearchParams();

  // Local state is the source of truth so a tick lands instantly; the URL is
  // written alongside it so the plan stays shareable. Driving the checkbox from
  // the URL alone made it wait on a server round trip before it looked ticked,
  // which reads as a broken control.
  const [picked, setLocal] = useState<Set<string>>(
    () => new Set((params.get("sessions") ?? "").split(",").filter(Boolean)),
  );

  const setPicked = (next: Set<string>) => {
    setLocal(next);
    const query = [...next].join(",");
    // replace, not push: twenty picks should not mean twenty back-button presses.
    router.replace(
      query === "" ? `/e/${slug}/itinerary` : `/e/${slug}/itinerary?sessions=${query}`,
      { scroll: false },
    );
  };

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const mine = sessions.filter((row) => picked.has(row.id));

  /** Sixty-one talks ran as one flat list, with the day readable only in a line
   *  of grey mono beside the time. A conference is lived one day at a time, and
   *  a visitor deciding what to see on Thursday had to read every row to find
   *  where Thursday started. */
  const days = useMemo(() => {
    const KEY = dayKey(timezone);
    const NAME = dayName(timezone);
    const groups = new Map<string, { heading: string; rows: Session[] }>();
    for (const row of sessions) {
      const key = row.starts_at === null ? UNDATED : KEY.format(new Date(row.starts_at));
      const heading =
        row.starts_at === null ? "Time to be confirmed" : NAME.format(new Date(row.starts_at));
      const group = groups.get(key) ?? { heading, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => ({
        key,
        heading: group.heading,
        rows: [...group.rows].sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? "")),
      }));
  }, [sessions, timezone]);

  /** Two picks at the same time is the thing an attendee most wants told. */
  const clashes = useMemo(() => {
    const byTime = new Map<string, string[]>();
    for (const row of mine) {
      if (row.starts_at === null) continue;
      byTime.set(row.starts_at, [...(byTime.get(row.starts_at) ?? []), row.title]);
    }
    return [...byTime.entries()].filter(([, titles]) => titles.length > 1);
  }, [mine]);

  return (
    <>
      <p style={{ color: "var(--i3)", margin: "0 0 12px", fontSize: 14 }}>
        {picked.size === 0
          ? "Pick the talks you want and this becomes a schedule you can bookmark or send to someone."
          : `${picked.size} picked. This page's address holds your plan, so you can bookmark or share it.`}
      </p>

      {clashes.length > 0 ? (
        <div
          style={{
            border: "1px solid var(--cnl)",
            background: "var(--cnw)",
            color: "var(--cn)",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 13.5,
          }}
        >
          {clashes.map(([starts, titles]) => (
            <div key={starts}>
              {WHEN.format(new Date(starts))}: {titles.join(" and ")} are at the same time.
            </div>
          ))}
        </div>
      ) : null}

      {picked.size > 0 ? (
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          <button
            onClick={() => setPicked(new Set())}
            style={{
              height: "var(--control-h-sm, 36px)",
              padding: "0 14px",
              borderRadius: 999,
              border: "1px solid var(--ls)",
              background: "none",
              color: "var(--i2)",
              font: "500 12.5px var(--font-plex-sans)",
            }}
          >
            Clear all
          </button>
          <a
            href={`/api/v1/public/events/${slug}/schedule.ics`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: "var(--control-h-sm, 36px)",
              padding: "0 14px",
              borderRadius: 999,
              background: "var(--bt)",
              color: "var(--bf)",
              font: "600 12.5px var(--font-plex-sans)",
              textDecoration: "none",
            }}
          >
            Download the full schedule
          </a>
        </div>
      ) : null}

      {days.map((day) => {
        const chosen = day.rows.filter((row) => picked.has(row.id)).length;
        return (
          <section key={day.key} style={{ marginBottom: 26 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                flexWrap: "wrap",
                margin: "0 0 12px",
                paddingBottom: 8,
                borderBottom: "1px solid var(--ln)",
              }}
            >
              <h2
                style={{
                  font: "600 15px var(--font-plex-sans)",
                  color: "var(--ik)",
                  margin: 0,
                  flex: 1,
                }}
              >
                {day.heading}
              </h2>
              <span
                className="tabular"
                style={{ font: "400 12px var(--font-plex-mono)", color: "var(--i3)" }}
              >
                {chosen === 0
                  ? `${day.rows.length} ${day.rows.length === 1 ? "talk" : "talks"}`
                  : `${chosen} of ${day.rows.length} picked`}
              </span>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {day.rows.map((row) => {
                const on = picked.has(row.id);
                return (
                  <article
                    key={row.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 14,
                      background: "var(--cd)",
                      border: `1px solid ${on ? "var(--sl)" : "var(--ln)"}`,
                      borderLeft: `3px solid ${on ? "var(--sg)" : "var(--ln)"}`,
                      borderRadius: 14,
                      padding: 16,
                    }}
                  >
                    {/* This is the whole point of the page, and it was a native
                  unstyled checkbox measuring 13x13px — a third of the touch
                  floor, on a page a visitor uses on a phone in a hallway. The
                  title beside it is a link, so there was no larger target for
                  picking either. */}
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(row.id)}
                      aria-label={`Add ${row.title} to my schedule`}
                      style={{
                        width: 24,
                        height: 24,
                        marginTop: 2,
                        flex: "none",
                        accentColor: "var(--bt)",
                        cursor: "pointer",
                      }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h2
                        style={{
                          font: "600 16px var(--font-plex-sans)",
                          color: "var(--ik)",
                          margin: "0 0 4px",
                        }}
                      >
                        <Link
                          href={`/e/${slug}/schedule/${row.slug}` as never}
                          style={{ color: "inherit", textDecoration: "none" }}
                        >
                          {row.title}
                        </Link>
                      </h2>
                      <p
                        className="tabular"
                        style={{
                          font: "400 12.5px var(--font-plex-mono)",
                          color: "var(--i3)",
                          margin: 0,
                        }}
                      >
                        {/* The weekday moved to the day heading above, so the row
                      carries the time and nothing the heading already said. */}
                        {row.starts_at === null ? "—" : CLOCK.format(new Date(row.starts_at))}
                        {row.room !== null ? ` · ${row.room}` : ""}
                        {row.track !== null ? ` · ${row.track}` : ""}
                        {row.speakers.length > 0
                          ? ` · ${row.speakers.map((person) => person.name).join(", ")}`
                          : ""}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
