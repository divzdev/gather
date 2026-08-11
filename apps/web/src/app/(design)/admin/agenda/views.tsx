"use client";

/** The agenda read three other ways.
 *
 *  The grid is the only view you can drag in, and it is 700px wide before it
 *  starts eliding — which made Track, List and Week buttons that opened the
 *  conflicts panel and nothing else. These are the real ones. They are
 *  deliberately read-only: dragging is the grid's job, and a list you can
 *  reorder by dragging would have to invent a meaning for "between 10:00 and
 *  10:30" that the grid already expresses exactly.
 *
 *  List is also the narrow-screen answer. It has no minimum width, so the agenda
 *  stops being desktop-only for anyone who just wants to read it.
 */

import type { CSSProperties } from "react";

/** The five the brief names — "day" is the hourly room×time grid, which is the
 *  one view that is also the editor, so it stays in the design component. */
export type ViewKey = "day" | "list" | "week" | "track" | "room";

export type ViewSession = {
  id: string;
  title: string;
  starts_at: string | null;
  duration_minutes: number;
  room_id: string | null;
  track_id: string | null;
  event_day_id: string | null;
  speaker_ids: string[];
};

export type ViewInput = {
  view: ViewKey;
  days: { id: string; day_date: string; label: string | null }[];
  rooms: { id: string; name: string }[];
  tracks: { id: string; name: string; hue: string }[];
  scheduled: ViewSession[];
  unscheduled: ViewSession[];
  conflicted: Set<string>;
  dayId: string | null;
  onSelect: (id: string) => void;
};

const CLOCK = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const startsAt = (row: ViewSession) => (row.starts_at === null ? 0 : Date.parse(row.starts_at));

const byTime = (a: ViewSession, b: ViewSession) =>
  startsAt(a) - startsAt(b) || a.title.localeCompare(b.title);

const column: CSSProperties = {
  border: "1px solid var(--ln)",
  borderRadius: 10,
  background: "var(--cd)",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
};

const columnHead: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  padding: "10px 12px",
  borderBottom: "1px solid var(--ln)",
  position: "sticky",
  top: 0,
  background: "var(--cd)",
  borderRadius: "10px 10px 0 0",
  zIndex: 1,
};

const columnTitle: CSSProperties = {
  font: "600 10.5px var(--font-plex-condensed), var(--font-plex-sans)",
  letterSpacing: "0.09em",
  color: "var(--i3)",
  textTransform: "uppercase",
};

const countStyle: CSSProperties = {
  font: "500 11px var(--font-plex-mono), monospace",
  color: "var(--i4)",
  marginLeft: "auto",
};

const emptyStyle: CSSProperties = {
  font: "400 12px var(--font-plex-sans)",
  color: "var(--i4)",
  padding: "12px",
};

function Card({
  row,
  hue,
  meta,
  conflicted,
  onSelect,
}: {
  row: ViewSession;
  hue: string;
  meta: string;
  conflicted: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(row.id)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        border: "none",
        borderLeft: `3px solid ${hue}`,
        borderBottom: "1px solid var(--ln)",
        background: conflicted ? "var(--cnw)" : "none",
        padding: "9px 12px",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          font: "400 10.5px var(--font-plex-mono), monospace",
          color: conflicted ? "var(--cn)" : "var(--i4)",
        }}
      >
        {row.starts_at === null ? "unplaced" : CLOCK.format(new Date(row.starts_at))}
        <span>{row.duration_minutes} min</span>
        {conflicted ? <span style={{ marginLeft: "auto" }}>⚠ clash</span> : null}
      </span>
      <span
        style={{
          display: "block",
          font: "500 12.5px/17px var(--font-plex-sans)",
          color: "var(--ik)",
          marginTop: 2,
        }}
      >
        {row.title}
      </span>
      <span
        style={{
          display: "block",
          font: "400 11px var(--font-plex-sans)",
          color: "var(--i4)",
          marginTop: 2,
        }}
      >
        {meta}
      </span>
    </button>
  );
}

/** Columns of sessions, used by all three views with a different grouping. */
function Columns({
  groups,
  input,
  meta,
}: {
  groups: { key: string; title: string; hue: string; rows: ViewSession[] }[];
  input: ViewInput;
  meta: (row: ViewSession) => string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(min(260px, 100%), 1fr))`,
        gap: 12,
        padding: "16px 20px 60px",
        alignItems: "start",
      }}
    >
      {groups.map((group) => (
        <section key={group.key} style={column}>
          <header style={columnHead}>
            <span
              aria-hidden
              style={{ width: 9, height: 9, borderRadius: 3, background: group.hue, flex: "none" }}
            />
            <h2 style={{ ...columnTitle, margin: 0 }}>{group.title}</h2>
            <span className="tabular" style={countStyle}>
              {group.rows.length}
            </span>
          </header>
          {group.rows.length === 0 ? (
            <p style={emptyStyle}>Nothing here yet.</p>
          ) : (
            group.rows
              .slice()
              .sort(byTime)
              .map((row) => (
                <Card
                  key={row.id}
                  row={row}
                  hue={group.hue}
                  meta={meta(row)}
                  conflicted={input.conflicted.has(row.id)}
                  onSelect={input.onSelect}
                />
              ))
          )}
        </section>
      ))}
    </div>
  );
}

export function AgendaView({ input }: { input: ViewInput }) {
  const roomName = (id: string | null) =>
    input.rooms.find((room) => room.id === id)?.name ?? "no room";
  const track = (id: string | null) => input.tracks.find((entry) => entry.id === id);
  const hueOf = (row: ViewSession) => track(row.track_id)?.hue ?? "var(--ls)";
  const dayLabel = (day: { day_date: string; label: string | null }) =>
    day.label ?? DATE.format(new Date(`${day.day_date}T00:00:00Z`));

  if (input.view === "list") {
    const today = input.scheduled.filter((row) => row.event_day_id === input.dayId).sort(byTime);
    return (
      <div style={{ padding: "16px 20px 60px", maxWidth: 760 }}>
        <section style={column}>
          <header style={columnHead}>
            <h2 style={{ ...columnTitle, margin: 0 }}>This day, in order</h2>
            <span className="tabular" style={countStyle}>
              {today.length}
            </span>
          </header>
          {today.length === 0 ? (
            <p style={emptyStyle}>Nothing is placed on this day yet.</p>
          ) : (
            today.map((row) => (
              <Card
                key={row.id}
                row={row}
                hue={hueOf(row)}
                meta={`${roomName(row.room_id)} · ${track(row.track_id)?.name ?? "no track"}`}
                conflicted={input.conflicted.has(row.id)}
                onSelect={input.onSelect}
              />
            ))
          )}
        </section>

        {input.unscheduled.length > 0 ? (
          <section style={{ ...column, marginTop: 14 }}>
            <header style={columnHead}>
              <h2 style={{ ...columnTitle, margin: 0 }}>Still unplaced</h2>
              <span className="tabular" style={countStyle}>
                {input.unscheduled.length}
              </span>
            </header>
            {input.unscheduled.map((row) => (
              <Card
                key={row.id}
                row={row}
                hue={hueOf(row)}
                meta={track(row.track_id)?.name ?? "no track"}
                conflicted={false}
                onSelect={input.onSelect}
              />
            ))}
          </section>
        ) : null}
      </div>
    );
  }

  if (input.view === "room") {
    const today = input.scheduled.filter((row) => row.event_day_id === input.dayId);
    const roomless = today.filter((row) => row.room_id === null);
    return (
      <Columns
        input={input}
        meta={(row) => track(row.track_id)?.name ?? "no track"}
        groups={[
          ...input.rooms.map((room) => ({
            key: room.id,
            title: room.name,
            hue: "var(--ls)",
            rows: today.filter((row) => row.room_id === room.id),
          })),
          ...(roomless.length > 0
            ? [{ key: "none", title: "No room", hue: "var(--ls)", rows: roomless }]
            : []),
        ]}
      />
    );
  }

  if (input.view === "track") {
    const today = input.scheduled.filter((row) => row.event_day_id === input.dayId);
    const untracked = today.filter((row) => row.track_id === null);
    return (
      <Columns
        input={input}
        meta={(row) => roomName(row.room_id)}
        groups={[
          ...input.tracks.map((entry) => ({
            key: entry.id,
            title: entry.name,
            hue: entry.hue,
            rows: today.filter((row) => row.track_id === entry.id),
          })),
          // Only when it would not be an empty column: most events track
          // everything, and a permanent "No track" header reads like a fault.
          ...(untracked.length > 0
            ? [{ key: "none", title: "No track", hue: "var(--ls)", rows: untracked }]
            : []),
        ]}
      />
    );
  }

  return (
    <Columns
      input={input}
      meta={(row) => `${roomName(row.room_id)} · ${track(row.track_id)?.name ?? "no track"}`}
      groups={input.days.map((day) => ({
        key: day.id,
        title: dayLabel(day),
        hue: day.id === input.dayId ? "var(--sg)" : "var(--ls)",
        rows: input.scheduled.filter((row) => row.event_day_id === day.id),
      }))}
    />
  );
}
