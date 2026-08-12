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
import { PAGE_ICON, PageHead } from "@/components/ui";
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
          icon={PAGE_ICON.program}
          crumbs={["Program", "Setup"]}
          title="Program setup"
          summary="The agenda is drawn from these. Until they exist there is nothing to drag a session onto."
        />

        {/* A list of what is missing tells you the state; it does not tell you what
            to do, and it says nothing at all once the list is empty — which is
            exactly the moment an organiser has finished here and has no idea the
            next thing is a CFP form. Both halves are one control now. */}
        {counts !== undefined && <NextStep missing={missing} />}

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
                        <span
                          style={{ font: "600 14px var(--font-plex-sans)", color: "var(--ik)" }}
                        >
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

/** The one thing to do next, in both states.
 *
 *  While pieces are missing it names the first one and links to it, in the order
 *  the data depends on — days and rooms before tracks and formats, because the
 *  grid needs somewhere to put a session before it needs to know what colour it
 *  is. When nothing is missing it hands over to the call for papers, which is
 *  otherwise a step an organiser has to already know exists.
 */
function NextStep({ missing }: { missing: (typeof SECTIONS)[number][] }) {
  const target = missing[0];
  const done = target === undefined;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        border: `1px solid ${done ? "var(--okl)" : "var(--pdl)"}`,
        background: done ? "var(--okw)" : "var(--pdw)",
        borderRadius: 12,
        padding: "14px 18px",
        marginBottom: 20,
      }}
    >
      <span style={{ flex: 1, minWidth: "min(100%, 320px)" }}>
        <span
          style={{
            display: "block",
            font: "600 13px var(--font-plex-sans)",
            color: done ? "var(--ok)" : "var(--pd)",
            marginBottom: 2,
          }}
        >
          {done ? "Program is set up." : `Next: add ${target.label.toLowerCase()}`}
        </span>
        <span
          style={{
            display: "block",
            font: "400 12.5px/1.5 var(--font-plex-sans)",
            color: "var(--i3)",
          }}
        >
          {done
            ? "Every piece the agenda needs exists. Next is the call for papers — the questions speakers answer when they submit."
            : `${target.blurb} ${
                missing.length > 1
                  ? `Then ${missing
                      .slice(1)
                      .map((entry) => entry.label.toLowerCase())
                      .join(", ")}.`
                  : ""
              }`}
        </span>
      </span>
      <Link
        href={(done ? "/admin/forms" : target.href) as "/admin/program"}
        style={{
          flex: "none",
          display: "inline-flex",
          alignItems: "center",
          height: 40,
          padding: "0 20px",
          borderRadius: 999,
          textDecoration: "none",
          background: "var(--sg)",
          color: "var(--cd)",
          font: "600 13px var(--font-plex-sans)",
        }}
      >
        {done ? "Build the call for papers →" : `Add ${target.label.toLowerCase()} →`}
      </Link>
    </div>
  );
}
