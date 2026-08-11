"use client";

/** The pieces the agenda is drawn from, one screen each.
 *
 *  This was a single page with four stacked sections and an add-form inside
 *  every one of them: to reach event days you scrolled past three other
 *  editors, and nothing told you what was already configured. Now each piece
 *  has its own page behind a section nav, and the overview says what exists.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { card, EmptyState, pill, quietPill } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { authed } from "@/lib/session";
import { useSubmitOnce } from "@/lib/submitOnce";

type Row = Record<string, unknown> & { id: string; name?: string };

/** Track hues are an index into the design's palette, not free-form colour. */
const HUES = ["#3E8896", "#A85788", "#5A6BA8", "#7E5CB8", "#C4703A", "#34526B", "#0E7A5F", "#B96A1F"];

type Panel = {
  key: string;
  path: string;
  title: string;
  blurb: string;
  /** Turns the new-row form values into a create body. */
  build: (draft: Record<string, string>) => Record<string, unknown> | string;
  fields: { key: string; label: string; placeholder: string; type?: string }[];
  describe: (row: Row) => string;
};

const PANELS: Panel[] = [
  {
    key: "rooms",
    path: "rooms",
    title: "Rooms",
    blurb: "Every place a session can happen. These become the agenda's columns.",
    fields: [
      { key: "name", label: "Room name", placeholder: "Main Stage" },
      { key: "capacity", label: "Capacity", placeholder: "800", type: "number" },
    ],
    build: (draft) => {
      if ((draft.name ?? "").trim() === "") return "A room needs a name.";
      const capacity = Number(draft.capacity);
      return {
        name: draft.name!.trim(),
        capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
      };
    },
    describe: (row) => (row.capacity ? `seats ${String(row.capacity)}` : "no capacity set"),
  },
  {
    key: "tracks",
    path: "tracks",
    title: "Tracks",
    blurb: "The themes you file talks under. Each gets a colour on the grid.",
    fields: [
      { key: "name", label: "Track name", placeholder: "Platform & Infra" },
      { key: "hue_index", label: "Colour (1-8)", placeholder: "1", type: "number" },
    ],
    build: (draft) => {
      if ((draft.name ?? "").trim() === "") return "A track needs a name.";
      const hue = Number(draft.hue_index);
      return {
        name: draft.name!.trim(),
        hue_index: Number.isFinite(hue) && hue >= 1 && hue <= 8 ? hue : 1,
      };
    },
    describe: (row) => `colour ${String(row.hue_index ?? 1)}`,
  },
  {
    key: "session-formats",
    path: "session-formats",
    title: "Session formats",
    blurb: "Talk, workshop, keynote. The default duration pre-fills a new session.",
    fields: [
      { key: "name", label: "Format name", placeholder: "Talk (30 min)" },
      {
        key: "default_duration_minutes",
        label: "Default minutes",
        placeholder: "30",
        type: "number",
      },
    ],
    build: (draft) => {
      if ((draft.name ?? "").trim() === "") return "A format needs a name.";
      const minutes = Number(draft.default_duration_minutes);
      if (!Number.isFinite(minutes) || minutes < 5 || minutes > 600) {
        return "Default duration must be between 5 and 600 minutes.";
      }
      return { name: draft.name!.trim(), default_duration_minutes: minutes };
    },
    describe: (row) => `${String(row.default_duration_minutes ?? 30)} min by default`,
  },
  {
    key: "days",
    path: "days",
    title: "Event days",
    blurb: "One row per day the conference runs. The agenda gets a tab for each.",
    fields: [
      { key: "day_date", label: "Date", placeholder: "2027-05-12", type: "date" },
      { key: "label", label: "Label", placeholder: "Day one" },
    ],
    build: (draft) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.day_date ?? "")) return "Pick a date.";
      return {
        day_date: draft.day_date,
        label: (draft.label ?? "").trim() === "" ? null : draft.label!.trim(),
      };
    },
    // The API serialises a time as 09:00:00; nobody wants to read the seconds.
    describe: (row) =>
      `${String(row.starts_at_local ?? "09:00").slice(0, 5)}–${String(
        row.ends_at_local ?? "18:00",
      ).slice(0, 5)}`,
  },
];

/** What the row calls itself. The remove control has to name the same thing the
 *  row shows, or a screen reader announces a button for something else. */
function label(row: Row): string {
  return String(row.name ?? row.label ?? row.day_date ?? "");
}

function List({ panel, eventId }: { panel: Panel; eventId: string | null }) {
  const queryClient = useQueryClient();
  const once = useSubmitOnce();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState("");

  const { data } = useQuery({
    queryKey: [panel.key, eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Row[]>(`/events/${eventId}/${panel.path}`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [panel.key, eventId] });
    void queryClient.invalidateQueries({ queryKey: ["agenda", eventId] });
  };

  const add = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      authed(`/events/${eventId}/${panel.path}`, { method: "POST", body }),
    onSuccess: () => {
      setDraft({});
      setProblem("");
      invalidate();
    },
    onError: (error: Error) => setProblem(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      authed(`/events/${eventId}/${panel.path}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setProblem("");
      invalidate();
    },
    // Deleting something a session still points at is refused by the database;
    // say so rather than showing a raw constraint error.
    onError: (error: Error) =>
      setProblem(
        error instanceof ApiError && error.status === 409
          ? error.message
          : `That ${panel.title.toLowerCase().replace(/s$/, "")} is still in use, so it was kept.`,
      ),
  });

  const rows = data ?? [];

  return (
    // No title or blurb: the page header above already says both, and repeating
    // them was an artefact of four of these sharing one scrolling page.
    <section style={{ ...card, padding: 20, marginBottom: 16 }}>
      {rows.length === 0 ? (
        <EmptyState title={`No ${panel.title.toLowerCase()} yet`} body="Add the first one below." />
      ) : (
        <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
          {rows.map((row) => (
            <div
              key={row.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                borderRadius: 8,
                background: "var(--pp)",
              }}
            >
              {panel.key === "tracks" ? (
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    flex: "none",
                    background: HUES[(Number(row.hue_index ?? 1) - 1) % HUES.length],
                  }}
                />
              ) : null}
              <span
                style={{ flex: 1, font: "500 13px var(--font-plex-sans)", color: "var(--ik)" }}
              >
                {label(row)}
              </span>
              <span
                style={{ font: "400 11.5px var(--font-plex-mono)", color: "var(--i4)" }}
              >
                {panel.describe(row)}
              </span>
              <button
                onClick={() => remove.mutate(row.id)}
                aria-label={`Remove ${label(row)}`}
                style={{ ...quietPill, height: 26 }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        {panel.fields.map((entry) => (
          <label key={entry.key} style={{ display: "grid", gap: 4, minWidth: 150, flex: 1 }}>
            <span style={{ font: "500 11.5px var(--font-plex-sans)", color: "var(--i2)" }}>
              {entry.label}
            </span>
            <input
              type={entry.type ?? "text"}
              value={draft[entry.key] ?? ""}
              placeholder={entry.placeholder}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [entry.key]: event.target.value }))
              }
              style={{
                height: 34,
                padding: "0 12px",
                borderRadius: 6,
                border: "1px solid var(--ls)",
                background: "var(--cd)",
                font: "400 13px var(--font-plex-sans)",
                color: "var(--ik)",
              }}
            />
          </label>
        ))}
        <button
          style={pill}
          disabled={add.isPending}
          onClick={() =>
            once(() => {
              const built = panel.build(draft);
              if (typeof built === "string") {
                setProblem(built);
                return;
              }
              add.mutate(built);
            })
          }
        >
          Add
        </button>
      </div>

      {problem !== "" ? (
        <p
          role="alert"
          style={{ font: "400 12.5px var(--font-plex-sans)", color: "var(--cn)", margin: "10px 0 0" }}
        >
          {problem}
        </p>
      ) : null}
    </section>
  );
}

export { List, PANELS, label, HUES };
export type { Panel, Row };
