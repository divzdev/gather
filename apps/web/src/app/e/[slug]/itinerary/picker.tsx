"use client";

/** Building a personal schedule without an account.
 *
 *  The picks live in the URL, which is the whole design: an attendee can bookmark
 *  their plan, send it to a colleague, or open it on their phone, and none of
 *  that needs a login or a cookie. A server-side list would need an account.
 *
 *  localStorage mirrors the URL rather than replacing it. The URL alone loses the
 *  plan the moment someone opens the page from the nav instead of their bookmark
 *  — they tick twelve talks, come back tomorrow via the menu, and it is empty.
 *  So: the URL wins when it carries picks (a shared link must show the sender's
 *  plan, not the reader's), and the mirror restores them when it does not.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";

import { BROWSER_API_BASE_URL } from "@/lib/api";

/** The saved plan, as an external store rather than state restored in an effect.
 *
 *  Reading localStorage during render is a hydration mismatch (the server has
 *  none) and reading it in an effect is a cascading render. `useSyncExternalStore`
 *  is the shape that is neither: a server snapshot of "nothing", a client
 *  snapshot of what is stored, and a synchronous notify on write so a tick still
 *  lands on the very next frame. */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // `storage` fires in *other* tabs. Both matter: two tabs of the same plan
  // should not disagree.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readStore(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    // Private browsing throws on access, not just on write.
    return "";
  }
}

function writeStore(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A plan that cannot be remembered is not a reason to refuse the tick the
    // visitor just made.
  }
  for (const notify of listeners) notify();
}

type Session = {
  id: string;
  slug: string;
  title: string;
  abstract: string | null;
  starts_at: string | null;
  room: string | null;
  track: string | null;
  format: string | null;
  duration_minutes: number;
  speakers: { id: string; name: string; job_title: string | null; company: string | null }[];
};

/** Name, role and employer, skipping the separators for whatever is missing.
 *  The sessions list has printed this for a while; the itinerary printed bare
 *  names, so the same speaker read as two different people across two pages. */
function billing(person: { name: string; job_title: string | null; company: string | null }) {
  return [person.name, person.job_title, person.company].filter(Boolean).join(", ");
}

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

/** Short date for a card that may be read on its own. */
const stamp = (timezone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
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
  const STAMP = stamp(timezone);
  const router = useRouter();
  const params = useSearchParams();

  const store = `itinerary:${slug}`;
  const saved = useSyncExternalStore(
    subscribe,
    () => readStore(store),
    () => "",
  );

  /** The URL wins whenever it carries picks: a link someone was sent shows the
   *  sender's plan, never the reader's. The saved plan is the fallback, which is
   *  what makes the page survive arriving from the nav instead of a bookmark. */
  const fromUrl = params.get("sessions") ?? "";
  const picked = useMemo(
    () => new Set((fromUrl !== "" ? fromUrl : saved).split(",").filter(Boolean)),
    [fromUrl, saved],
  );

  const setPicked = (next: Set<string>) => {
    const query = [...next].join(",");
    writeStore(store, query);
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
      <p style={{ color: "var(--e-muted, #9A9FB1)", margin: "0 0 12px", fontSize: 14 }}>
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
              border: "1px solid var(--e-edge-strong, rgba(255,255,255,.18))",
              background: "none",
              color: "var(--e-muted, #9A9FB1)",
              font: "500 12.5px var(--font-manrope), sans-serif",
            }}
          >
            Clear all
          </button>
          {/* This offered only the whole programme, which is the one calendar an
              attendee who just picked six talks does not want. */}
          <a
            href={`${BROWSER_API_BASE_URL}/public/events/${slug}/schedule.ics?session_ids=${[...picked].join(",")}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: "var(--control-h-sm, 36px)",
              padding: "0 14px",
              borderRadius: 999,
              background: "var(--e-text, #F3F4F8)",
              color: "var(--e-page, #07080E)",
              font: "600 12.5px var(--font-manrope), sans-serif",
              textDecoration: "none",
            }}
          >
            Add my {picked.size} {picked.size === 1 ? "talk" : "talks"} to a calendar
          </a>
          <a
            href={`${BROWSER_API_BASE_URL}/public/events/${slug}/schedule.ics`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: "var(--control-h-sm, 36px)",
              padding: "0 14px",
              borderRadius: 999,
              border: "1px solid var(--e-edge-strong, rgba(255,255,255,.18))",
              background: "none",
              color: "var(--e-muted, #9A9FB1)",
              font: "500 12.5px var(--font-manrope), sans-serif",
              textDecoration: "none",
            }}
          >
            Full schedule
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
                borderBottom: "1px solid var(--e-edge, rgba(255,255,255,.10))",
              }}
            >
              <h2
                style={{
                  font: "600 15px var(--font-manrope), sans-serif",
                  color: "var(--e-text, #F3F4F8)",
                  margin: 0,
                  flex: 1,
                }}
              >
                {day.heading}
              </h2>
              <span
                className="tabular"
                style={{
                  font: "400 12px ui-monospace,'SF Mono',Menlo,monospace",
                  color: "var(--e-muted, #9A9FB1)",
                }}
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
                      background: "var(--e-raised, #101018)",
                      border: `1px solid ${on ? "var(--e-edge-strong, rgba(255,255,255,.18))" : "var(--e-edge, rgba(255,255,255,.10))"}`,
                      borderLeft: `3px solid ${on ? "var(--e-accent, #FF6B6B)" : "var(--e-edge, rgba(255,255,255,.10))"}`,
                      borderRadius: 14,
                      padding: 16,
                    }}
                  >
                    {/* This is the whole point of the page, and it was a native
                  unstyled checkbox measuring 13x13px — a third of the touch
                  floor, on a page a visitor uses on a phone in a hallway. The
                  title beside it is a link, so there was no larger target for
                  picking either. */}
                    {/* 24 was better than 13 and is still the entire hit area on
                    the one control this page exists for. The label carries the
                    target; the tick stays the size it should look. */}
                    <label
                      style={{
                        flex: "none",
                        display: "grid",
                        placeItems: "center",
                        width: "var(--control-h-md, 44px)",
                        height: "var(--control-h-md, 44px)",
                        margin: "-6px 0 -6px -10px",
                        borderRadius: 10,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(row.id)}
                        aria-label={`Add ${row.title} to my schedule`}
                        style={{
                          width: 24,
                          height: 24,
                          accentColor: "var(--e-text, #F3F4F8)",
                          cursor: "pointer",
                        }}
                      />
                    </label>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h2
                        style={{
                          font: "600 16px var(--font-manrope), sans-serif",
                          color: "var(--e-text, #F3F4F8)",
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
                          font: "400 12.5px ui-monospace,'SF Mono',Menlo,monospace",
                          color: "var(--e-muted, #9A9FB1)",
                          margin: 0,
                        }}
                      >
                        {/* The date is repeated from the day heading on purpose.
                            A personal schedule is a thing people screenshot and
                            send one card of, and a card that says only "09:00"
                            has lost the half that matters once it leaves the
                            page it was grouped on. */}
                        {row.starts_at === null
                          ? "—"
                          : `${STAMP.format(new Date(row.starts_at))} · ${CLOCK.format(new Date(row.starts_at))}`}
                        {row.room !== null ? ` · ${row.room}` : ""}
                        {row.track !== null ? ` · ${row.track}` : ""}
                        {row.format !== null ? ` · ${row.format}` : ""}
                      </p>
                      {/* Speakers were a bare comma list on this page while the
                          sessions list gave each one their role and employer.
                          Which one an attendee is choosing between is often the
                          speaker, so it is the wrong page to shorten. */}
                      {row.speakers.length > 0 ? (
                        <p
                          style={{
                            font: "500 13px var(--font-manrope), sans-serif",
                            color: "var(--e-text, #F3F4F8)",
                            margin: "6px 0 0",
                          }}
                        >
                          {row.speakers.map(billing).join(" · ")}
                        </p>
                      ) : null}
                      {row.abstract === null || row.abstract === "" ? null : (
                        <p
                          style={{
                            font: "400 13.5px var(--font-manrope), sans-serif",
                            lineHeight: 1.55,
                            color: "var(--e-muted, #9A9FB1)",
                            margin: "8px 0 0",
                          }}
                        >
                          {row.abstract.length > 220
                            ? `${row.abstract.slice(0, 220)}…`
                            : row.abstract}
                        </p>
                      )}
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
