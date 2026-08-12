"use client";

/** The section nav that sits between the rail and a program setup screen.
 *
 *  Four editors on one scrolling page meant the last of them was three screens
 *  down and nothing said which were already filled in. A second column costs
 *  little and turns "scroll until you find days" into one click.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ConsoleHeader } from "@/components/console/ConsoleHeader";
import { Rail } from "@/components/console/Rail";

export type SectionKey = "overview" | "rooms" | "tracks" | "session-formats" | "days";

export const SECTIONS: {
  key: SectionKey;
  href: string;
  label: string;
  icon: string;
  group: string;
  blurb: string;
}[] = [
  {
    key: "overview",
    href: "/admin/program",
    label: "Overview",
    icon: "▦",
    group: "",
    blurb: "What is configured, and what is still missing.",
  },
  {
    key: "days",
    href: "/admin/program/days",
    label: "Event days",
    icon: "▤",
    group: "Schedule & venue",
    blurb: "One row per day the conference runs. The agenda gets a tab for each.",
  },
  {
    key: "rooms",
    href: "/admin/program/rooms",
    label: "Rooms",
    icon: "◫",
    group: "Schedule & venue",
    blurb: "Every place a session can happen. These become the agenda's columns.",
  },
  {
    key: "tracks",
    href: "/admin/program/tracks",
    label: "Tracks",
    icon: "◈",
    group: "Program structure",
    blurb: "The themes you file talks under. Each gets a colour on the grid.",
  },
  {
    key: "session-formats",
    href: "/admin/program/session-formats",
    label: "Session formats",
    icon: "◑",
    group: "Program structure",
    blurb: "Talk, workshop, keynote. The default duration pre-fills a new session.",
  },
];

export function ProgramShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const groups = [...new Set(SECTIONS.filter((entry) => entry.group !== "").map((e) => e.group))];

  const item = (entry: (typeof SECTIONS)[number]) => {
    const active =
      entry.href === "/admin/program" ? pathname === "/admin/program" : pathname === entry.href;
    return (
      <Link
        key={entry.key}
        href={entry.href as "/admin/program"}
        aria-current={active ? "page" : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 36,
          padding: "0 12px",
          borderRadius: 8,
          textDecoration: "none",
          background: active ? "var(--sw)" : "none",
          color: active ? "var(--sg)" : "var(--i2)",
          font: `${active ? 600 : 500} 13px var(--font-plex-sans)`,
        }}
      >
        <span style={{ width: 14, textAlign: "center", opacity: 0.8 }}>{entry.icon}</span>
        {entry.label}
      </Link>
    );
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0,1fr)",
        height: "100vh",
        overflow: "hidden",
        background: "var(--pp)",
        color: "var(--ik)",
      }}
    >
      <Rail active="Program" style={{ height: "100%", minHeight: 0 }} />

      {/* The header spans the section nav as well as the content, which is how
          Settings and the form builder already treat their own second column.
          Sitting it beside the nav instead would make Program the one console
          screen whose header starts 208px in. */}
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <ConsoleHeader />
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <nav
            aria-label="Rooms & tracks"
            style={{
              width: 208,
              flex: "none",
              borderRight: "1px solid var(--ln)",
              background: "var(--cd)",
              padding: "18px 10px",
              overflowY: "auto",
              display: "grid",
              alignContent: "start",
              gap: 2,
            }}
          >
            <p
              style={{
                font: "600 10px var(--font-plex-sans)",
                letterSpacing: "0.12em",
                color: "var(--i4)",
                margin: "0 0 8px 12px",
              }}
            >
              PROGRAM SETUP
            </p>
            {item(SECTIONS[0]!)}
            {groups.map((group) => (
              <div key={group} style={{ display: "grid", gap: 2, marginTop: 14 }}>
                <p
                  style={{
                    font: "600 10px var(--font-plex-sans)",
                    letterSpacing: "0.1em",
                    color: "var(--i4)",
                    margin: "0 0 2px 12px",
                  }}
                >
                  {group.toUpperCase()}
                </p>
                {SECTIONS.filter((entry) => entry.group === group).map(item)}
              </div>
            ))}
          </nav>

          <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}
