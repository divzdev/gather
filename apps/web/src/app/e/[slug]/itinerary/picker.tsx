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
import { useMemo } from "react";

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

const WHEN = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export function Picker({ slug, sessions }: { slug: string; sessions: Session[] }) {
  const router = useRouter();
  const params = useSearchParams();

  const picked = useMemo(() => {
    const raw = params.get("sessions") ?? "";
    return new Set(raw.split(",").filter(Boolean));
  }, [params]);

  const setPicked = (next: Set<string>) => {
    const query = [...next].join(",");
    // replace, not push: twenty picks should not mean twenty back-button presses.
    router.replace(query === "" ? `/e/${slug}/itinerary` : `/e/${slug}/itinerary?sessions=${query}`, {
      scroll: false,
    });
  };

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const mine = sessions.filter((row) => picked.has(row.id));

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
            border: "1px solid #F3C7C2",
            background: "#FBE8E6",
            color: "#D8432B",
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
              height: 32,
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
              height: 32,
              padding: "0 14px",
              borderRadius: 999,
              background: "#FF6B6B",
              color: "#331313",
              font: "600 12.5px var(--font-plex-sans)",
              textDecoration: "none",
            }}
          >
            Download the full schedule
          </a>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 10 }}>
        {sessions.map((row) => {
          const on = picked.has(row.id);
          return (
            <article
              key={row.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                background: "var(--cd)",
                border: `1px solid ${on ? "#FFC9C0" : "var(--ln)"}`,
                borderLeft: `3px solid ${on ? "#E04E4E" : "var(--ln)"}`,
                borderRadius: 14,
                padding: 16,
              }}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(row.id)}
                aria-label={`Add ${row.title} to my schedule`}
                style={{ marginTop: 4, flex: "none" }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ font: "600 16px var(--font-plex-sans)", color: "var(--ik)", margin: "0 0 4px" }}>
                  <Link
                    href={`/e/${slug}/schedule/${row.slug}` as never}
                    style={{ color: "inherit", textDecoration: "none" }}
                  >
                    {row.title}
                  </Link>
                </h2>
                <p
                  className="tabular"
                  style={{ font: "400 12.5px var(--font-plex-mono)", color: "var(--i3)", margin: 0 }}
                >
                  {row.starts_at === null ? "Time to be confirmed" : WHEN.format(new Date(row.starts_at))}
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
    </>
  );
}
