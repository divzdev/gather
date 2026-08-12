"use client";

/** The embeds an organiser has kept.
 *
 *  The builder above generates a snippet for whatever is currently selected, and
 *  that was the whole of it — an organiser with an agenda on the sponsor page, a
 *  gallery on the about page and an itinerary in the app had no record of which
 *  three they had made, and rebuilt each one by memory to change a colour.
 *
 *  A saved embed is **settings, not snippet text**. The row renders its snippet
 *  on demand from the current generator, so a saved embed inherits later fixes
 *  instead of preserving whatever was emitted the day it was saved. That is also
 *  why Delete is safe and says so: nothing on a host page reads this table, so
 *  forgetting the record leaves the live widget running.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authed } from "@/lib/session";

type SavedEmbed = {
  id: string;
  name: string;
  widget: string;
  theme: string;
  track: string | null;
  limit: number;
  snippet: string;
};

const card: React.CSSProperties = {
  border: "1px solid var(--ln)",
  borderRadius: 14,
  background: "var(--cd)",
  padding: "22px 24px",
  marginTop: 16,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 0",
  borderTop: "1px solid var(--ln)",
  font: "400 12.5px var(--font-plex-sans)",
  color: "var(--i2)",
};

const ghost: React.CSSProperties = {
  height: 36,
  padding: "0 16px",
  borderRadius: 999,
  border: "1px solid var(--ls)",
  background: "var(--cd)",
  color: "var(--i2)",
  font: "500 12px var(--font-plex-sans)",
  cursor: "pointer",
};

/** Which anonymous payload each widget reads — the same mapping `embed.py`
 *  uses, so a feed URL here is the one the script would fetch. */
const FEED: Record<string, string> = {
  schedule: "schedule",
  agenda: "agenda",
  itinerary: "itinerary",
  upcoming: "schedule",
  speakers: "speakers",
  gallery: "gallery",
};

/** The same content, for people who do not want our script.
 *
 *  A styled script tag suits a marketing page; a developer building the
 *  conference app wants JSON, and an attendee wants the whole programme in their
 *  calendar. All three already exist as anonymous endpoints — this is the screen
 *  that admits it, because an organiser cannot copy a URL they were never shown.
 */
export function OutputFormats({
  slug,
  widget,
  onDone,
}: {
  slug: string | null;
  widget: string;
  onDone: (message: string) => void;
}) {
  const origin =
    typeof window === "undefined" ? "" : window.location.origin + "/api/v1/public/events";
  if (slug === null) return null;

  const feed = FEED[widget] ?? "schedule";
  const rows: { label: string; hint: string; url: string }[] = [
    {
      label: "JSON feed",
      hint: "The payload the widget reads. Anonymous, no key.",
      url: `${origin}/${slug}/${feed}`,
    },
    {
      label: "Calendar (.ics)",
      hint: "Subscribe to the published programme.",
      url: `${origin}/${slug}/schedule.ics`,
    },
  ];

  return (
    <section style={card} data-output-formats>
      <h2 style={{ font: "600 13px var(--font-plex-sans)", color: "var(--ik)", margin: "0 0 4px" }}>
        Other formats
      </h2>
      <p style={{ font: "400 12px var(--font-plex-sans)", color: "var(--i3)", margin: "0 0 4px" }}>
        The script above is for a web page. These are the same published data for anything else.
      </p>
      {rows.map((row) => (
        <div key={row.label} style={rowStyle}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ color: "var(--ik)", fontWeight: 500 }}>{row.label}</span>
            <span style={{ display: "block", font: "400 11px var(--font-plex-sans)" }}>
              {row.hint}
            </span>
          </span>
          <button
            style={ghost}
            onClick={() => {
              void navigator.clipboard?.writeText(row.url);
              onDone(`${row.label} URL copied.`);
            }}
          >
            Copy URL
          </button>
        </div>
      ))}
    </section>
  );
}

export function SavedEmbeds({
  eventId,
  current,
  onDone,
}: {
  eventId: string | null;
  /** What the builder is showing right now — the thing Save keeps. */
  current: { widget: string; theme: string; track: string | null; limit: number };
  onDone: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const { data: saved } = useQuery({
    queryKey: ["saved-embeds", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<SavedEmbed[]>(`/events/${eventId}/embeds`),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["saved-embeds", eventId] });
  };

  const save = useMutation({
    // `authed` serialises the body itself — passing a string here would be sent
    // as a JSON-encoded string and rejected as the wrong shape.
    mutationFn: () =>
      authed<SavedEmbed>(`/events/${eventId}/embeds`, {
        method: "POST",
        body: { name: name.trim(), ...current },
      }),
    onSuccess: () => {
      setName("");
      refresh();
      onDone("Saved. The snippet is rebuilt from these settings every time you copy it.");
    },
    onError: () => onDone("Could not save that embed."),
  });

  const forget = useMutation({
    mutationFn: (id: string) => authed(`/events/${eventId}/embeds/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      onDone("Forgotten. Anything already pasted on a page keeps working.");
    },
  });

  const rows = saved ?? [];

  return (
    <section style={card} data-saved-embeds>
      <h2
        style={{
          font: "600 13px var(--font-plex-sans)",
          color: "var(--ik)",
          margin: "0 0 4px",
        }}
      >
        Saved embeds
      </h2>
      <p style={{ font: "400 12px var(--font-plex-sans)", color: "var(--i3)", margin: "0 0 12px" }}>
        Keep the ones you have put on a page, so you can find them again. Snippets are rebuilt from
        the saved settings, so they never go stale.
      </p>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          aria-label="Name this embed"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={`e.g. ${current.widget} on the sponsor page`}
          style={{
            flex: 1,
            minWidth: 0,
            height: 40,
            padding: "0 14px",
            borderRadius: 8,
            border: "1px solid var(--ls)",
            background: "var(--cd)",
            font: "400 12.5px var(--font-plex-sans)",
            color: "var(--ik)",
          }}
        />
        <button
          onClick={() => save.mutate()}
          disabled={name.trim() === "" || save.isPending}
          style={{ ...ghost, opacity: name.trim() === "" ? 0.5 : 1 }}
        >
          {save.isPending ? "Saving…" : "Save this embed"}
        </button>
      </div>

      {rows.length === 0 ? (
        <p style={{ ...rowStyle, color: "var(--i4)" }}>
          Nothing saved yet. Build an embed above, name it, and it will be listed here.
        </p>
      ) : (
        rows.map((row) => (
          <div key={row.id} style={rowStyle}>
            <span style={{ flex: 1, minWidth: 0, color: "var(--ik)", fontWeight: 500 }}>
              {row.name}
            </span>
            <span
              className="tabular"
              style={{ font: "400 11px var(--font-plex-mono), monospace", color: "var(--i4)" }}
            >
              {row.widget}
              {row.track === null ? "" : ` · ${row.track}`} · {row.theme}
            </span>
            <button
              style={ghost}
              onClick={() => {
                void navigator.clipboard?.writeText(row.snippet);
                onDone(`Copied the snippet for "${row.name}".`);
              }}
            >
              Get code
            </button>
            <button
              style={ghost}
              onClick={() => forget.mutate(row.id)}
              aria-label={`Forget ${row.name}`}
            >
              Forget
            </button>
          </div>
        ))
      )}
    </section>
  );
}
