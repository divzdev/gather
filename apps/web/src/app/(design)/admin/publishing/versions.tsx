"use client";

/** What the public is looking at, and how to put back what they were.
 *
 *  The API has kept an immutable snapshot per publish since the first migration,
 *  and rollback is just republishing an older one — but this screen was only the
 *  embed builder, so none of it was reachable. An organiser who published a
 *  broken schedule at 9am had a working version sitting in the table and no way
 *  to say so.
 *
 *  Rollback asks first, and says the version number out loud. It is one of the
 *  four things in this product that must never be optimistic: it changes what
 *  two hundred attendees see.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authed } from "@/lib/session";

type Version = {
  version: number;
  published_at: string;
  note: string | null;
  session_count: number;
};

type Diff = {
  added: unknown[];
  removed: unknown[];
  moved: unknown[];
  duration_changed: unknown[];
  speakers_changed: unknown[];
  has_changes: boolean;
};

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const card: React.CSSProperties = {
  border: "1px solid var(--ln)",
  borderRadius: 12,
  background: "var(--cd)",
  padding: "16px 18px",
  marginTop: 16,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "9px 0",
  borderTop: "1px solid var(--ln)",
  font: "400 12.5px var(--font-plex-sans)",
  color: "var(--i2)",
};

const restore: React.CSSProperties = {
  height: 28,
  padding: "0 12px",
  borderRadius: 999,
  border: "1px solid var(--ls)",
  background: "var(--cd)",
  color: "var(--i2)",
  font: "500 12px var(--font-plex-sans)",
  cursor: "pointer",
};

export function PublishedVersions({
  eventId,
  onDone,
}: {
  eventId: string | null;
  onDone: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<number | null>(null);

  const { data: versions } = useQuery({
    queryKey: ["schedule-versions", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Version[]>(`/events/${eventId}/schedule/versions`),
  });

  const { data: diff } = useQuery({
    queryKey: ["schedule-diff", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Diff>(`/events/${eventId}/schedule/diff`),
  });

  const rollback = useMutation({
    mutationFn: (version: number) =>
      authed<{ version: number; restored_from: number }>(`/events/${eventId}/schedule/rollback`, {
        method: "POST",
        body: { version },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (result) => {
      setConfirming(null);
      void queryClient.invalidateQueries({ queryKey: ["schedule-versions", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["schedule-diff", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["published"] });
      // A rollback is a new version, not a rewind — say so, or the next person
      // to read the list wonders why the number went up.
      onDone(
        `Version ${result.restored_from} is public again, republished as version ${result.version}.`,
      );
    },
    onError: (error: Error) => onDone(error.message),
  });

  if (versions === undefined || versions.length === 0) return null;

  const [current, ...earlier] = versions;
  const pending =
    diff === undefined || !diff.has_changes
      ? null
      : [
          diff.added.length > 0 ? `${diff.added.length} added` : "",
          diff.removed.length > 0 ? `${diff.removed.length} removed` : "",
          diff.moved.length > 0 ? `${diff.moved.length} moved` : "",
          diff.duration_changed.length > 0 ? `${diff.duration_changed.length} re-timed` : "",
          diff.speakers_changed.length > 0 ? `${diff.speakers_changed.length} re-cast` : "",
        ]
          .filter((part) => part !== "")
          .join(" · ");

  return (
    <section style={card} aria-label="Published versions">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
        <h2
          style={{
            font: "600 10.5px var(--font-plex-condensed), var(--font-plex-sans)",
            letterSpacing: "0.09em",
            color: "var(--i3)",
            margin: 0,
          }}
        >
          PUBLISHED VERSIONS
        </h2>
        <span
          className="tabular"
          style={{ font: "500 11px var(--font-plex-mono), monospace", color: "var(--i4)" }}
        >
          {versions.length}
        </span>
      </div>

      <p style={{ font: "400 13px var(--font-plex-sans)", color: "var(--ik)", margin: "0 0 4px" }}>
        The public is reading <strong>version {current!.version}</strong>, published{" "}
        {WHEN.format(new Date(current!.published_at))} with {current!.session_count} sessions.
      </p>
      <p
        style={{
          font: "400 12px var(--font-plex-sans)",
          color: pending === null ? "var(--ok)" : "var(--pd)",
          margin: "0 0 4px",
        }}
      >
        {pending === null
          ? "The draft matches it — nothing is waiting to be published."
          : `Unpublished changes since then: ${pending}. Publish from the agenda.`}
      </p>

      {earlier.length === 0 ? null : (
        <div style={{ marginTop: 10 }}>
          {earlier.slice(0, 8).map((entry) => (
            <div key={entry.version} style={rowStyle}>
              <span className="tabular" style={{ minWidth: 34, color: "var(--i4)" }}>
                v{entry.version}
              </span>
              <span style={{ minWidth: 116 }}>{WHEN.format(new Date(entry.published_at))}</span>
              <span style={{ flex: 1, minWidth: 0, color: "var(--i4)" }}>
                {entry.note ?? `${entry.session_count} sessions`}
              </span>
              {confirming === entry.version ? (
                <>
                  <span style={{ color: "var(--cn)" }}>Make v{entry.version} public again?</span>
                  <button
                    style={{ ...restore, borderColor: "var(--cn)", color: "var(--cn)" }}
                    disabled={rollback.isPending}
                    onClick={() => rollback.mutate(entry.version)}
                  >
                    {rollback.isPending ? "Restoring…" : "Yes, restore it"}
                  </button>
                  <button style={restore} onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button style={restore} onClick={() => setConfirming(entry.version)}>
                  Restore
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
