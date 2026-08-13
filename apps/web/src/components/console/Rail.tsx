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

/** Below this, an expanded rail eats two-thirds of the viewport and the
 *  content column wraps into a one-word-per-line tower. The console is not a
 *  phone product — the drag-drop screens never will be — but reading a count
 *  or approving a session from a hallway has to work. */
const NARROW_QUERY = "(max-width: 900px)";

/** Collapsed state lives in localStorage, so it is read through an external
 *  store rather than an effect: the server renders expanded and the client
 *  corrects on hydration without a second render pass.
 *
 *  Narrow screens keep their own key: with one shared flag, expanding on a
 *  desktop would write "0" and a later phone visit would inherit a rail it
 *  has no room for. Absent key = the width decides. */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function subscribeNarrow(listener: () => void): () => void {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function setCollapsed(next: boolean, key: string): void {
  window.localStorage.setItem(key, next ? "1" : "0");
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
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
  const railKey = narrow ? `${RAIL_KEY}.narrow` : RAIL_KEY;
  const stored = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(railKey),
    () => null,
  );
  const collapsed = stored === null ? narrow : stored === "1";
  const [logoHover, setLogoHover] = useState(false);
  const { stats } = useProgramStats();

  // A count of zero takes the badge out of the rail rather than showing "0".
  const badge = (value: number) => ({
    text: value === 0 ? "" : String(value),
    display: value === 0 ? "none" : "inline-block",
  });
  const submissions = badge(stats.total);
  // Sessions in the programme, not accepted submissions. An accepted proposal
  // is not a session until somebody promotes it, so this badge read 62 under a
  // "Sessions" label on an event with 61 sessions — right about a number nobody
  // asked for.
  const sessions = badge(stats.sessions);
  const review = badge(stats.unreviewed);
  // The conflict count is the number the customer complained the incumbent hides
  // until you reload, so it belongs where it is visible from every screen.
  //
  // Hard conflicts only — room and speaker double-bookings. The agenda lists all
  // three classes including soft track collisions, which organisers often create
  // on purpose, so the two numbers differ by design and the badge says which it
  // means rather than leaving the reader to guess.
  const conflicts = badge(stats.conflicts);
  const conflictLabel =
    stats.conflictsAll > stats.conflicts
      ? `${stats.conflicts} to resolve · ${stats.conflictsAll - stats.conflicts} track overlap${stats.conflictsAll - stats.conflicts === 1 ? "" : "s"} allowed`
      : `${stats.conflicts} to resolve`;
  const overdue = badge(stats.overdueTasks);

  const item = (name: NavName) =>
    name === active
      ? {
          bg: "var(--sw,#FFEAE6)",
          fg: "var(--sg,#E04E4E)",
          wt: "700",
          dot: collapsed ? "none" : "inline-block",
          // Unlike the dot, the bar survives collapsing: it is the only thing
          // left saying where you are once the labels go.
          bar: "block",
        }
      : { bg: "none", fg: "var(--i2,#3E4E58)", wt: "600", dot: "none", bar: "none" };

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
    agBadgeTitle: conflictLabel,
    tkBadge: overdue.text,
    tkBadgeD: overdue.display,
    exp: !collapsed,
    col: collapsed,
    railW: collapsed ? "64px" : "256px",
    navPad: collapsed ? "4px 12px 14px" : "4px 12px 16px",
    iPad: collapsed ? "0" : "0 12px",
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
      setCollapsed(!collapsed, railKey);
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
