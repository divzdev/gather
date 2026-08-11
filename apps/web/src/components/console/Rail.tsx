"use client";

/** Controller for the generated console rail.
 *
 * The prototype's own logic, ported: the active item is tinted with the accent,
 * collapsing swaps a set of measurements, and the collapsed flag survives a
 * reload under the same localStorage key the prototype used.
 */

import { useState, useSyncExternalStore } from "react";

import { ConsoleRail, type ConsoleRailData } from "@/components/design/ConsoleRail";
import { useQuery } from "@tanstack/react-query";

import { CommandPalette } from "@/components/console/CommandPalette";
import { useProgramStats } from "@/components/console/stats";
import { authed } from "@/lib/session";

const RAIL_KEY = "gather.rail";


/** Collapsed state lives in localStorage, so it is read through an external
 *  store rather than an effect: the server renders expanded and the client
 *  corrects on hydration without a second render pass. */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function setCollapsed(next: boolean): void {
  window.localStorage.setItem(RAIL_KEY, next ? "1" : "0");
  for (const listener of listeners) listener();
}

type NavName =
  | "Overview"
  | "Submissions"
  | "Sessions"
  | "Review"
  | "Speakers"
  | "Directory"
  | "Program"
  | "Agenda"
  | "Tasks"
  | "Messages"
  | "Portal"
  | "Forms"
  | "Publishing"
  | "Settings";

export function Rail({ active, style }: { active: NavName; style?: React.CSSProperties }) {
  // Same query key as the console chrome, so this is one request, not two.
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => authed<{ name: string; role: string; org_name: string | null }>("/auth/me"),
    staleTime: 5 * 60_000,
  });
  const initials = (me?.name ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
  const collapsed = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(RAIL_KEY) === "1",
    () => false,
  );
  const [logoHover, setLogoHover] = useState(false);
  const { stats } = useProgramStats();

  // A count of zero takes the badge out of the rail rather than showing "0".
  const badge = (value: number) => ({
    text: value === 0 ? "" : String(value),
    display: value === 0 ? "none" : "inline-block",
  });
  const submissions = badge(stats.total);
  const sessions = badge(stats.accepted);
  const review = badge(stats.unreviewed);
  // The conflict count is the number the customer complained the incumbent hides
  // until you reload, so it belongs where it is visible from every screen.
  const conflicts = badge(stats.conflicts);
  const overdue = badge(stats.overdueTasks);

  const item = (name: NavName) =>
    name === active
      ? {
          bg: "var(--sw,#FFEAE6)",
          fg: "var(--sg,#E04E4E)",
          wt: "600",
          dot: collapsed ? "none" : "inline-block",
        }
      : { bg: "none", fg: "var(--i2,#3E4E58)", wt: "500", dot: "none" };

  const data: ConsoleRailData = {
    youInitials: initials,
    youName: me?.name ?? "",
    youRole: (me?.role ?? "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
    // The demo chip is a real state — it belongs to the seeded event, not to
    // whoever is signed in.
    youBadge: me?.org_name?.toLowerCase().includes("demo") ? "DEMO" : "",
    ov: item("Overview"),
    su: item("Submissions"),
    se: item("Sessions"),
    rv: item("Review"),
    sp: item("Speakers"),
    dr: item("Directory"),
    pg: item("Program"),
    ag: item("Agenda"),
    tk: item("Tasks"),
    ms: item("Messages"),
    pt: item("Portal"),
    fm: item("Forms"),
    pb: item("Publishing"),
    st: item("Settings"),
    subBadge: submissions.text,
    subBadgeD: submissions.display,
    seBadge: sessions.text,
    seBadgeD: sessions.display,
    rvBadge: review.text,
    rvBadgeD: review.display,
    agBadge: conflicts.text,
    agBadgeD: conflicts.display,
    tkBadge: overdue.text,
    tkBadgeD: overdue.display,
    exp: !collapsed,
    col: collapsed,
    railW: collapsed ? "64px" : "216px",
    navPad: collapsed ? "4px 12px 14px" : "4px 10px 14px",
    iPad: collapsed ? "0" : "0 13px",
    iJus: collapsed ? "center" : "flex-start",
    lblD: collapsed ? "none" : "flex",
    eyeD: collapsed ? "none" : "block",
    divD: collapsed ? "block" : "none",
    lgHov: logoHover,
    lgIdle: !logoHover,
    lgBg: logoHover ? "var(--sk,#EDF1F2)" : "none",
    lgIn: () => setLogoHover(true),
    lgOut: () => setLogoHover(false),
    togRail: () => {
      setCollapsed(!collapsed);
      setLogoHover(false);
    },
  };

  return (
    <div style={{ ...style, position: "relative" }}>
      <ConsoleRail d={data} />
      <CommandPalette />
    </div>
  );
}
