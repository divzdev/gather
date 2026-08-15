"use client";

/** Controller for the generated console rail.
 *
 * The prototype's own logic, ported: the active item is tinted with the accent,
 * collapsing swaps a set of measurements, and the collapsed flag survives a
 * reload under the same localStorage key the prototype used.
 */

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { ConsoleRail, type ConsoleRailData } from "@/components/design/ConsoleRail";
import { useQuery } from "@tanstack/react-query";

import { CommandPalette } from "@/components/console/CommandPalette";
import {
  readMobileNav,
  serverMobileNav,
  setMobileNav,
  subscribeMobileNav,
} from "@/components/console/mobileNav";
import { useProgramStats } from "@/components/console/stats";
import { authed } from "@/lib/session";

const RAIL_KEY = "gather.rail";

/** Below this, an expanded rail eats two-thirds of the viewport and the
 *  content column wraps into a one-word-per-line tower. The console is not a
 *  phone product — the drag-drop screens never will be — but reading a count
 *  or approving a session from a hallway has to work. */
const NARROW_QUERY = "(max-width: 900px)";

/** Routes that mount a second nav column of their own, beside the rail.
 *
 *  Two navs plus content is 464px of chrome before the first word — a third of
 *  a 1440 laptop spent on wayfinding, most of it duplicated, because the
 *  section nav already says where you are. So the rail starts collapsed here
 *  and hands the width back.
 *
 *  A list rather than a prop on `<Rail>` because Settings mounts its rail
 *  inside `components/design/Settings.tsx`, which is generated — a hand-added
 *  prop there is exactly what regeneration deletes. */
const SECTION_NAV_ROUTES = ["/admin/program", "/admin/settings"];

/** Collapsed state lives in localStorage, so it is read through an external
 *  store rather than an effect: the server renders expanded and the client
 *  corrects on hydration without a second render pass.
 *
 *  Three keys, not one. Narrow screens and section-nav screens each keep their
 *  own: with a single shared flag, expanding on a desktop dashboard would
 *  write "0" and a later phone visit — or a later trip to Settings — would
 *  inherit a rail that context has no room for. Absent key = the context
 *  decides; a present key is the choice this person made *in that context*,
 *  which is why the toggle still works on every screen and is never undone by
 *  navigating. */
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
  const pathname = usePathname();
  const sectionNav = SECTION_NAV_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  // Narrow outranks section: a phone has no room for the rail whatever else the
  // screen is showing, and its own key already carries that.
  const railKey = narrow ? `${RAIL_KEY}.narrow` : sectionNav ? `${RAIL_KEY}.section` : RAIL_KEY;
  const stored = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(railKey),
    () => null,
  );
  /** On a phone the rail is not a column, it is a drawer: off-canvas until
   *  asked for, over the page rather than beside it. A 64px strip permanently
   *  taking a sixth of a 390px screen is a desktop layout made narrow, which is
   *  not the same thing as a mobile layout. */
  const drawerOpen = useSyncExternalStore(subscribeMobileNav, readMobileNav, serverMobileNav);
  /** An open drawer always shows labels. Collapsing to icons is a trade a
   *  desktop user makes to buy back screen width they can see the value of;
   *  someone who has just tapped a menu open has asked to read it, and there is
   *  no width to save because the drawer is floating over the page anyway. */
  const collapsed = drawerOpen ? false : stored === null ? narrow || sectionNav : stored === "1";
  // Navigating closes it. Without this the drawer stays over the page you just
  // asked for, which reads as the tap not having worked.
  useEffect(() => setMobileNav(false), [pathname]);
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

  // The ink pill is the active state (spec 0002): chrome carries no hue, so
  // the pill's fill is the whole signal — it survives collapsing as an
  // icon-only pill, which is why the old edge bar and dot are gone.
  const item = (name: NavName) =>
    name === active
      ? {
          bg: "var(--bt,#141417)",
          fg: "var(--bf,#FFFFFF)",
          wt: "650",
          dot: "none",
          bar: "none",
        }
      : { bg: "none", fg: "var(--i2,#3F3F46)", wt: "550", dot: "none", bar: "none" };

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
    <>
      {/* Dismisses the drawer, and blocks the page behind it from being poked
       *  through. Only rendered while open, so it costs nothing on a desktop. */}
      {drawerOpen ? (
        <div
          data-console-scrim
          onClick={() => setMobileNav(false)}
          aria-hidden
          style={{ position: "fixed", inset: 0, background: "rgba(9,14,20,.5)", zIndex: 59 }}
        />
      ) : null}
      <div
        data-console-rail
        data-open={drawerOpen ? "true" : "false"}
        style={{ ...style, position: "relative" }}
      >
        <ConsoleRail d={data} />
      </div>
      {/* Outside the rail, and it has to be. The rail carries a `transform` on
       *  mobile to slide off-canvas, and a transformed ancestor becomes the
       *  containing block for `position: fixed` descendants — so the palette,
       *  which is fixed and full-viewport, was being positioned against a box
       *  parked at -100% and rendered with its left half off the screen. */}
      <CommandPalette />
    </>
  );
}
