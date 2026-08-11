"use client";

/** What the agenda is built from, and how much of it exists yet.
 *
 *  This page used to stack four editors on one scroll: to reach event days you
 *  went past three other forms, and nothing told you whether a track had ever
 *  been made or why the agenda was empty. It answers that first now, and sends
 *  you to the one thing you came to change.
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { useProgramStats } from "@/components/console/stats";
import { PageHead } from "@/components/ui";
import { authed } from "@/lib/session";

import { ProgramShell, SECTIONS } from "./shell";

type Counted = { rooms: number; tracks: number; formats: number; days: number };

export default function ProgramOverviewPage() {
  const { eventId } = useProgramStats();

  const { data: counts } = useQuery({
    queryKey: ["program-counts", eventId],
    enabled: eventId !== null,
    queryFn: async (): Promise<Counted> => {
      const read = async (path: string) => {
        const rows = await authed<unknown>(`/events/${eventId}/${path}`).catch(() => []);
        // The crud router returns a bare array; paginated ones return {data}.
        return Array.isArray(rows)
          ? rows.length
          : ((rows as { data?: unknown[] }).data ?? []).length;
      };
      const [rooms, tracks, formats, days] = await Promise.all([
        read("rooms"),
        read("tracks"),
        read("session-formats"),
        read("days"),
      ]);
      return { rooms, tracks, formats, days };
    },
  });

  const countOf = (key: string): number | null => {
    if (counts === undefined) return null;
    if (key === "rooms") return counts.rooms;
    if (key === "tracks") return counts.tracks;
    if (key === "session-formats") return counts.formats;
    if (key === "days") return counts.days;
    return null;
  };

  const groups = [...new Set(SECTIONS.filter((entry) => entry.group !== "").map((e) => e.group))];
  const missing = SECTIONS.filter((entry) => entry.group !== "" && countOf(entry.key) === 0);

  return (
    <ProgramShell>
      <div style={{ padding: "20px 28px 80px" }}>
        <PageHead
          crumbs={["Program", "Setup"]}
          title="Program setup"
          summary="The agenda is drawn from these. Until they exist there is nothing to drag a session onto."
        />

        {counts !== undefined && missing.length > 0 && (
          <div
            style={{
              border: "1px solid var(--pdl)",
              background: "var(--pdw)",
              borderRadius: 12,
              padding: "12px 16px",
              marginBottom: 20,
              font: "400 13px var(--font-plex-sans)",
              color: "var(--pd)",
            }}
          >
            Still to set up: {missing.map((entry) => entry.label.toLowerCase()).join(", ")}.
          </div>
        )}

        {groups.map((group) => (
          <section key={group} style={{ marginBottom: 26 }}>
            <h2
              style={{
                font: "600 13px var(--font-plex-sans)",
                color: "var(--ik)",
                margin: "0 0 12px",
              }}
            >
              {group}
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(min(320px,100%), 1fr))",
                gap: 12,
              }}
            >
              {SECTIONS.filter((entry) => entry.group === group).map((entry) => {
                const count = countOf(entry.key);
                return (
                  <Link
                    key={entry.key}
                    href={entry.href as "/admin/program"}
                    style={{
                      display: "flex",
                      gap: 14,
                      alignItems: "flex-start",
                      padding: 18,
                      borderRadius: 14,
                      border: "1px solid var(--ln)",
                      background: "var(--cd)",
                      textDecoration: "none",
                      boxShadow: "0 1px 2px rgba(13,16,32,.04)",
                    }}
                  >
                    <span
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 9,
                        flex: "none",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "var(--sw)",
                        color: "var(--sg)",
                        font: "400 15px var(--font-plex-sans)",
                      }}
                    >
                      {entry.icon}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span
                        style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}
                      >
                        <span style={{ font: "600 14px var(--font-plex-sans)", color: "var(--ik)" }}>
                          {entry.label}
                        </span>
                        <span
                          className="tabular"
                          style={{
                            font: "500 11.5px var(--font-plex-mono), monospace",
                            color: count === 0 ? "var(--pd)" : "var(--i4)",
                          }}
                        >
                          {count === null ? "" : count === 0 ? "none yet" : count}
                        </span>
                      </span>
                      <span
                        style={{
                          display: "block",
                          font: "400 12.5px/1.5 var(--font-plex-sans)",
                          color: "var(--i3)",
                        }}
                      >
                        {entry.blurb}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </ProgramShell>
  );
}
