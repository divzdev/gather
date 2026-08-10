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
import { authed, getEventId, setEventId } from "@/lib/session";

const RAIL_KEY = "gather.rail";

const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short" });

/** A calendar date, not an instant: `new Date("2027-05-12")` is the day before
 *  in any western timezone. */
function parseDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

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
  const collapsed = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(RAIL_KEY) === "1",
    () => false,
  );
  const [logoHover, setLogoHover] = useState(false);
  const { stats } = useProgramStats();
  const event = stats.event;
  const dates =
    event === null
      ? "—"
      : `${SHORT.format(parseDate(event.starts_on))}–${SHORT.format(parseDate(event.ends_on))}`;

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
    // The rail named a fixture event on every screen it appeared on.
    eventName: event?.name ?? "Loading…",
    eventDates: dates,
    eventPlace: event === null ? "" : MONTH.format(parseDate(event.starts_on)),
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
      {collapsed ? null : <EventSwitcher />}
      <CommandPalette />
    </div>
  );
}

/** Switching event from anywhere.
 *
 *  The rail shows the event on every screen and its chevron was decorative; the
 *  only way to change event was a control on the submissions list, so an
 *  organiser standing on the agenda had no way to move. Rendered here rather
 *  than in the prototype because it is a behaviour the design only drew.
 */
function EventSwitcher() {
  const [open, setOpen] = useState(false);
  const current = typeof window === "undefined" ? null : getEventId();

  const { data: events } = useQuery({
    queryKey: ["my-events"],
    queryFn: () => authed<{ id: string; name: string; starts_on: string }[]>("/events"),
  });
  const list = events ?? [];

  return (
    <>
      <button
        onClick={() => setOpen((current_) => !current_)}
        aria-label="Switch event"
        aria-expanded={open}
        style={{
          position: "absolute",
          top: 62,
          right: 12,
          width: 26,
          height: 26,
          borderRadius: 7,
          border: "none",
          background: "none",
          color: "var(--i3,#6B7B84)",
          font: "400 11px var(--font-plex-sans), sans-serif",
        }}
      >
        ▾
      </button>
      {open ? (
        <>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close event list"
            style={{ position: "fixed", inset: 0, background: "none", border: "none", zIndex: 40 }}
          />
          <div
            role="listbox"
            aria-label="Events"
            style={{
              position: "absolute",
              top: 88,
              left: 12,
              right: 12,
              zIndex: 41,
              background: "var(--cd,#FFFFFF)",
              border: "1px solid var(--ln,#E1E7E9)",
              borderRadius: 10,
              boxShadow: "0 16px 40px rgba(13,16,32,.18)",
              padding: 6,
              maxHeight: 260,
              overflowY: "auto",
            }}
          >
            {list.length === 0 ? (
              <span
                style={{
                  display: "block",
                  padding: "8px 10px",
                  font: "400 12px var(--font-plex-sans), sans-serif",
                  color: "var(--i4,#99A6AD)",
                }}
              >
                No other events yet.
              </span>
            ) : (
              list.map((event) => (
                <button
                  key={event.id}
                  role="option"
                  aria-selected={event.id === current}
                  onClick={() => {
                    setEventId(event.id);
                    setOpen(false);
                    // A hard reload, deliberately: every query on the screen is
                    // keyed by event id, and refetching them piecemeal would
                    // show one event's agenda beside another's counts.
                    window.location.reload();
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 7,
                    border: "none",
                    background: event.id === current ? "var(--sw,#FFEAE6)" : "none",
                    color: event.id === current ? "var(--sg,#E04E4E)" : "var(--ik,#16232B)",
                    font: "500 12.5px var(--font-plex-sans), sans-serif",
                  }}
                >
                  {event.name}
                </button>
              ))
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
