"use client";

/** The event control, in the console header.
 *
 *  It used to be a bare chevron pinned over the rail's org card, which put the
 *  name of the thing you are working on and the way to change it in the corner
 *  of the navigation. The header is where it belongs: the rail is for moving
 *  between screens, the header for saying which event those screens are showing.
 *
 *  The panel is the event's front door, not just a picker — switching event and
 *  configuring one are the same errand, and the settings for the thing named in
 *  the header should hang off the thing named in the header rather than being
 *  hunted for at the bottom of the rail.
 *
 *  Rendered here rather than in the prototypes because switching is behaviour
 *  the design only drew, and because one component in the header beats the same
 *  markup pasted into thirteen generated screens.
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { authed, getEventId, setEventId } from "@/lib/session";

type EventRow = { id: string; name: string; starts_on: string; ends_on?: string };
type Me = { name: string; role: string; org_name: string | null };

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short" });

/** A calendar date, not an instant: `new Date("2027-05-12")` is the day before
 *  in any western timezone. */
function parseDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/** The seeded event runs 12 May to 1 June, and the rail used to render that as
 *  "12–1 May" — an event ending three weeks before it starts, in the wrong
 *  month. A range only collapses to one month when it is genuinely in one. */
function when(event: EventRow): string {
  const start = parseDate(event.starts_on);
  const opening = `${DAY.format(start)} ${MONTH.format(start)}`;
  if (event.ends_on === undefined) return opening;

  const end = parseDate(event.ends_on);
  if (start.getFullYear() !== end.getFullYear()) {
    return `${opening} ${start.getFullYear()} – ${DAY.format(end)} ${MONTH.format(end)} ${end.getFullYear()}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${opening} – ${DAY.format(end)} ${MONTH.format(end)}`;
  }
  return `${DAY.format(start)}–${DAY.format(end)} ${MONTH.format(start)}`;
}

const EYEBROW: React.CSSProperties = {
  font: "600 10px var(--font-plex-condensed), sans-serif",
  letterSpacing: "0.08em",
  color: "var(--i4,#99A6AD)",
  padding: "8px 10px 4px",
};

/** Lifted from the rail so a destination looks the same in both places. */
const ICONS: Record<string, React.ReactNode> = {
  settings: (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" style={{ flex: "none" }}>
      <circle cx="7.5" cy="7.5" r="2.4" />
      <circle cx="7.5" cy="1.9" r="1.3" />
      <circle cx="7.5" cy="13.1" r="1.3" />
      <circle cx="1.9" cy="7.5" r="1.3" />
      <circle cx="13.1" cy="7.5" r="1.3" />
    </svg>
  ),
  program: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      style={{ flex: "none" }}
    >
      <rect x="1.6" y="2.4" width="11.8" height="10.2" rx="1.8" />
      <path d="M1.6 6h11.8M6 6v6.6" />
    </svg>
  ),
  forms: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      style={{ flex: "none" }}
    >
      <rect x="2.5" y="1.5" width="10" height="12" rx="2" />
      <rect x="5" y="4.4" width="5" height="1.4" rx="0.7" fill="currentColor" stroke="none" />
      <rect x="5" y="7.2" width="5" height="1.4" rx="0.7" fill="currentColor" stroke="none" />
    </svg>
  ),
  publishing: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      style={{ flex: "none" }}
    >
      <path d="M5 4L1.8 7.5 5 11" />
      <path d="M10 4l3.2 3.5L10 11" />
    </svg>
  ),
  directory: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      style={{ flex: "none" }}
    >
      <rect x="2" y="1.8" width="11" height="11.4" rx="1.8" />
      <path d="M2 5.2h11M5.4 1.8v11.4" />
    </svg>
  ),
};

/** Only destinations that exist. "New event" sat out of this list until there
 *  was a POST /v1/events behind it, on the grounds that a control which cannot
 *  work is worse than its absence; it lives under the events column now that
 *  one exists. */
const EVENT_LINKS = [
  { href: "/admin/settings", icon: "settings", label: "Event settings" },
  { href: "/admin/program", icon: "program", label: "Rooms & tracks" },
  { href: "/admin/forms", icon: "forms", label: "Forms & pages" },
  { href: "/admin/publishing", icon: "publishing", label: "Publishing" },
] as const;

const ORG_LINKS = [
  { href: "/admin/directory", icon: "directory", label: "Speaker directory" },
] as const;

function MenuLink({
  href,
  icon,
  label,
  onNavigate,
}: {
  href: string;
  icon: string;
  label: string;
  onNavigate: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={href as "/admin/settings"}
      onClick={onNavigate}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 6,
        textDecoration: "none",
        background: hover ? "var(--sk,#EDF1F2)" : "none",
        color: hover ? "var(--ik,#16232B)" : "var(--i2,#3E4E58)",
        font: "500 12.5px var(--font-plex-sans), sans-serif",
      }}
    >
      {ICONS[icon]}
      {label}
    </Link>
  );
}

export function EventSwitcher() {
  const [open, setOpen] = useState(false);
  const current = typeof window === "undefined" ? null : getEventId();
  const close = () => setOpen(false);

  const { data: events } = useQuery({
    queryKey: ["my-events"],
    queryFn: () => authed<EventRow[]>("/events"),
    staleTime: 5 * 60_000,
  });
  // Same key the rail and console chrome use, so this is one request, not three.
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => authed<Me>("/auth/me"),
    staleTime: 5 * 60_000,
  });

  const list = events ?? [];
  const active = list.find((event) => event.id === current) ?? list[0];
  const org = me?.org_name ?? "Your organisation";

  return (
    <span data-event-switcher-slot style={{ position: "relative", flex: "none" }}>
      {/* A bordered capsule rather than bare text: the header's leftmost element
          is the answer to "which event am I looking at", and it has to hold its
          own against a 40px search field beside it. */}
      <button
        onClick={() => setOpen((shown) => !shown)}
        aria-label="Switch event"
        aria-expanded={open}
        aria-haspopup="true"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 42,
          padding: "0 12px 0 7px",
          borderRadius: 12,
          background: open ? "var(--sk,#EDF1F2)" : "var(--cd,#FFFFFF)",
          border: "1px solid var(--ln,#E1E7E9)",
          font: "600 13.5px var(--font-plex-sans), sans-serif",
          color: "var(--ik,#16232B)",
          /* Fixed, not content-sized. Everything to the right of this capsule is
             flexed, so a content width would move the search field as the event
             query resolves — "Loading…" is 60px narrower than a real name — and
             again for every event with a longer name than the last.

             Below the mobile breakpoint `[data-event-switcher]` in globals.css
             lets it shrink instead: at 236px it pushed the bell and the avatar
             clean off a 390px screen, which is a worse problem than the search
             field twitching once on load. */
          width: 236,
        }}
        data-event-switcher
      >
        <span
          style={{
            width: 28,
            height: 28,
            flex: "none",
            borderRadius: 8,
            background: "var(--sw,#FFEAE6)",
            color: "var(--sg,#E04E4E)",
            display: "grid",
            placeItems: "center",
            font: "700 11px var(--font-plex-sans), sans-serif",
          }}
        >
          {(active?.name ?? org).slice(0, 1).toUpperCase()}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: "left",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {active?.name ?? "Loading…"}
        </span>
        <span
          style={{
            flex: "none",
            font: "400 11px var(--font-plex-sans), sans-serif",
            color: "var(--i4,#99A6AD)",
          }}
        >
          ▾
        </span>
      </button>

      {open ? (
        <>
          <button
            onClick={close}
            aria-label="Close event menu"
            style={{
              position: "fixed",
              inset: 0,
              background: "none",
              border: "none",
              cursor: "default",
              zIndex: 40,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 50,
              left: 0,
              width: "min(560px, calc(100vw - 32px))",
              zIndex: 41,
              background: "var(--cd,#FFFFFF)",
              border: "1px solid var(--ln,#E1E7E9)",
              borderRadius: 12,
              boxShadow: "0 18px 44px rgba(16,19,25,.20)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "13px 14px",
                borderBottom: "1px solid var(--ln,#E1E7E9)",
              }}
            >
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  flex: "none",
                  background: "var(--sw,#FFEAE6)",
                  color: "var(--sg,#E04E4E)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  font: "600 14px var(--font-plex-sans), sans-serif",
                }}
              >
                {org.slice(0, 1).toUpperCase()}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    font: "600 13.5px var(--font-plex-sans), sans-serif",
                    color: "var(--ik,#16232B)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {org}
                </span>
                <span
                  style={{
                    display: "block",
                    font: "400 11px var(--font-plex-mono), monospace",
                    color: "var(--i4,#99A6AD)",
                  }}
                >
                  {list.length} {list.length === 1 ? "event" : "events"}
                  {me?.role === undefined ? "" : ` · you're ${me.role.replace(/_/g, " ")}`}
                </span>
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
              <div style={{ padding: 6 }}>
                <div style={EYEBROW}>YOUR EVENTS</div>
                <div role="listbox" aria-label="Events">
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
                          close();
                          // A hard reload, deliberately: every query on the
                          // screen is keyed by event id, and refetching them
                          // piecemeal would show one event's agenda beside
                          // another's counts.
                          window.location.reload();
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 9,
                          width: "100%",
                          textAlign: "left",
                          padding: "8px 10px",
                          borderRadius: 6,
                          border: "none",
                          background: event.id === current ? "var(--sw,#FFEAE6)" : "none",
                        }}
                      >
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            flex: "none",
                            background:
                              event.id === current ? "var(--sg,#E04E4E)" : "var(--i4,#99A6AD)",
                          }}
                        />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span
                            style={{
                              display: "block",
                              font: "600 12.5px var(--font-plex-sans), sans-serif",
                              color:
                                event.id === current ? "var(--sg,#E04E4E)" : "var(--ik,#16232B)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {event.name}
                          </span>
                          <span
                            style={{
                              display: "block",
                              font: "400 11px var(--font-plex-mono), monospace",
                              color: "var(--i4,#99A6AD)",
                            }}
                          >
                            {when(event)}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <Link
                  href="/admin/events/new"
                  onClick={close}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "8px 10px",
                    marginTop: 2,
                    borderRadius: 6,
                    textDecoration: "none",
                    font: "600 12.5px var(--font-plex-sans), sans-serif",
                    color: "var(--sg,#E04E4E)",
                  }}
                >
                  <span style={{ width: 7, textAlign: "center" }}>+</span>
                  New event
                </Link>
              </div>

              <div style={{ padding: 6, borderLeft: "1px solid var(--ln,#E1E7E9)" }}>
                <div style={EYEBROW}>EVENT</div>
                {EVENT_LINKS.map((link) => (
                  <MenuLink key={link.href} {...link} onNavigate={close} />
                ))}
                <div style={{ ...EYEBROW, paddingTop: 12 }}>ORGANISATION</div>
                {ORG_LINKS.map((link) => (
                  <MenuLink key={link.href} {...link} onNavigate={close} />
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </span>
  );
}
