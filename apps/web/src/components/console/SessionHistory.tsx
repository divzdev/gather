"use client";

/** Who changed this session's wording, when, and what it said before.
 *
 *  `ActivityLog` has recorded before/after diffs since the first migration and
 *  nothing read them, so a title that changed under an organiser had no author
 *  and no previous value. Restoring writes a new entry rather than rewinding —
 *  same reason files are versioned rather than overwritten: an undo you cannot
 *  undo is a second way to lose the text.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authed } from "@/lib/session";

type Entry = {
  id: string;
  at: string;
  actor_name: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const FIELD_NAMES: Record<string, string> = {
  title: "Title",
  abstract: "Abstract",
  expertise_level: "Level",
  language: "Language",
  tags: "Tags",
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.join(", ");
  const text = String(value);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

export function SessionHistory({
  eventId,
  sessionId,
  onRestored,
}: {
  eventId: string;
  sessionId: string;
  onRestored: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const key = ["session-history", eventId, sessionId];

  const { data: entries, isPending } = useQuery({
    queryKey: key,
    queryFn: () => authed<Entry[]>(`/events/${eventId}/sessions/${sessionId}/history`),
  });

  const restore = useMutation({
    mutationFn: (entryId: string) =>
      authed<{ restored: string[] }>(`/events/${eventId}/sessions/${sessionId}/restore`, {
        method: "POST",
        body: { entry_id: entryId },
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ["sessions", eventId] });
      onRestored(
        `Put back the previous ${result.restored.map((f) => FIELD_NAMES[f]?.toLowerCase() ?? f).join(" and ")}.`,
      );
    },
    onError: (error: Error) => onRestored(error.message),
  });

  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--ln,#E1E7E9)" }}>
      <div
        style={{
          font: "600 10px 'IBM Plex Sans Condensed',sans-serif",
          letterSpacing: "0.08em",
          color: "var(--i4,#99A6AD)",
          marginBottom: 10,
        }}
      >
        CHANGE HISTORY
      </div>

      {isPending ? (
        <p style={{ font: "400 12.5px var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}>
          Loading…
        </p>
      ) : (entries ?? []).length === 0 ? (
        <p
          style={{
            font: "400 12.5px/1.6 var(--font-plex-sans)",
            color: "var(--i3)",
            margin: 0,
          }}
        >
          Nothing has been edited yet. Changes to the title, abstract, level, language or tags are
          recorded here with who made them.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {(entries ?? []).map((entry) => (
            <div
              key={entry.id}
              style={{
                border: "1px solid var(--ln,#E1E7E9)",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    font: "600 12px var(--font-plex-sans)",
                    color: "var(--ik,#16232B)",
                  }}
                >
                  {entry.actor_name}
                </span>
                <span
                  className="tabular"
                  style={{ font: "400 11px var(--font-plex-mono)", color: "var(--i4,#99A6AD)" }}
                >
                  {WHEN.format(new Date(entry.at))}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(entry.id)}
                  style={{
                    height: 36,
                    padding: "0 13px",
                    borderRadius: 999,
                    border: "1px solid var(--ls,#C8D2D5)",
                    background: "none",
                    font: "500 12px var(--font-plex-sans)",
                    color: "var(--ik,#16232B)",
                    cursor: restore.isPending ? "wait" : "pointer",
                    opacity: restore.isPending ? 0.6 : 1,
                  }}
                >
                  Put this back
                </button>
              </div>
              {Object.keys(entry.after).map((name) => (
                <div
                  key={name}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "72px minmax(0,1fr)",
                    gap: 10,
                    padding: "3px 0",
                    font: "400 12px/1.5 var(--font-plex-sans)",
                  }}
                >
                  <span style={{ color: "var(--i3,#6B7B84)" }}>{FIELD_NAMES[name] ?? name}</span>
                  <span style={{ color: "var(--i2,#3E4E58)" }}>
                    <span style={{ textDecoration: "line-through", opacity: 0.65 }}>
                      {show(entry.before[name])}
                    </span>
                    {" → "}
                    <span style={{ color: "var(--ik,#16232B)" }}>{show(entry.after[name])}</span>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
