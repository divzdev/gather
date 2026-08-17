"use client";

/** Every file on the event, in one place.
 *
 *  Uploads were reachable one speaker at a time and nowhere together, so
 *  chasing slides meant opening eighty drawers. Only the latest version of each
 *  logical file is listed, with a count — a deliverable that came back three
 *  times is one row that says so, not three rows competing to be current.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { authed, download } from "@/lib/session";

type Entry = {
  id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  uploaded_at: string;
  versions: number;
  version_group_id: string;
  speaker_name: string | null;
  speaker_id: string | null;
  label: string;
  session_title: string | null;
};

const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function size(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const cell: React.CSSProperties = {
  padding: "10px 12px",
  font: "400 12.5px var(--font-plex-sans)",
  color: "var(--i2,#3E4E58)",
  borderBottom: "1px solid var(--ln,#E1E7E9)",
  textAlign: "left",
  verticalAlign: "top",
};

const head: React.CSSProperties = {
  ...cell,
  font: "600 10px var(--font-plex-sans)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--i4,#99A6AD)",
  position: "sticky",
  top: 0,
  background: "var(--cd,#FFFFFF)",
};

export function FilesLibrary({
  eventId,
  onError,
}: {
  eventId: string;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { data: entries, isPending } = useQuery({
    queryKey: ["files-library", eventId],
    enabled: open,
    queryFn: () => authed<Entry[]>(`/events/${eventId}/files`),
  });

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return entries ?? [];
    return (entries ?? []).filter((row) =>
      [row.filename, row.speaker_name, row.session_title, row.label]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [entries, query]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          right: 16,
          bottom: 64,
          height: 44,
          padding: "0 18px",
          borderRadius: 999,
          border: "1px solid var(--ls,#C8D2D5)",
          background: "var(--cd,#FFFFFF)",
          font: "500 13px var(--font-plex-sans)",
          color: "var(--ik,#16232B)",
          boxShadow: "0 8px 24px rgba(13,16,32,.12)",
          cursor: "pointer",
          zIndex: 40,
        }}
      >
        All files
      </button>
    );
  }

  return (
    <aside
      aria-label="Files library"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(760px,96vw)",
        background: "var(--cd,#FFFFFF)",
        borderLeft: "1px solid var(--ln,#E1E7E9)",
        boxShadow: "0 12px 32px rgba(13,16,32,.24)",
        zIndex: 61,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header style={{ padding: "18px 22px 12px", borderBottom: "1px solid var(--ln,#E1E7E9)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <h2
            style={{
              font: "600 17px var(--font-plex-sans)",
              color: "var(--ik,#16232B)",
              margin: 0,
              flex: 1,
            }}
          >
            All files
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              height: 36,
              padding: "0 14px",
              borderRadius: 999,
              border: "none",
              background: "none",
              font: "500 12.5px var(--font-plex-sans)",
              color: "var(--i3,#6B7B84)",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
        <p
          style={{
            font: "400 12.5px/1.6 var(--font-plex-sans)",
            color: "var(--i3,#6B7B84)",
            margin: "4px 0 12px",
          }}
        >
          Every upload on this event, newest first, with who it came from and what it was for. A
          file replaced more than once shows its version count; nothing is ever overwritten.
        </p>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by file, speaker, session or deliverable"
          aria-label="Filter files"
          style={{
            boxSizing: "border-box",
            width: "100%",
            height: 40,
            padding: "0 13px",
            borderRadius: 10,
            border: "1px solid var(--ls,#C8D2D5)",
            background: "var(--cd,#FFFFFF)",
            color: "var(--ik,#16232B)",
            font: "400 13px var(--font-plex-sans)",
          }}
        />
      </header>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {isPending ? (
          <p style={{ padding: 22, font: "400 13px var(--font-plex-sans)", color: "var(--i3)" }}>
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p
            style={{
              padding: 22,
              font: "400 13px/1.6 var(--font-plex-sans)",
              color: "var(--i3)",
            }}
          >
            {(entries ?? []).length === 0
              ? "Nobody has uploaded anything yet. Headshots and deliverables appear here as they arrive."
              : "Nothing matches that."}
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={head}>File</th>
                <th style={head}>Speaker</th>
                <th style={head}>Session</th>
                <th style={head}>For</th>
                <th style={head}>Added</th>
                <th style={head}>Versions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>
                    <button
                      type="button"
                      onClick={() => {
                        void download(
                          `/events/${eventId}/files/${row.id}/download`,
                          row.filename,
                        ).catch((problem: Error) => onError(problem.message));
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        font: "500 12.5px var(--font-plex-sans)",
                        color: "var(--sg,#E04E4E)",
                        textDecoration: "underline",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      {row.filename}
                    </button>
                    <span
                      style={{
                        display: "block",
                        font: "400 11px var(--font-plex-mono)",
                        color: "var(--i4,#99A6AD)",
                        marginTop: 2,
                      }}
                    >
                      {size(row.byte_size)}
                    </span>
                  </td>
                  <td style={cell}>{row.speaker_name ?? "—"}</td>
                  <td style={cell}>{row.session_title ?? "—"}</td>
                  <td style={cell}>{row.label}</td>
                  <td style={{ ...cell, whiteSpace: "nowrap" }} className="tabular">
                    {WHEN.format(new Date(row.uploaded_at))}
                  </td>
                  <td style={{ ...cell, textAlign: "right" }} className="tabular">
                    {row.versions}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </aside>
  );
}
