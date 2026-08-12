import Link from "next/link";
import { notFound } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

export type EventInfo = {
  name: string;
  slug: string;
  description: string | null;
  location: string | null;
  starts_on: string;
  ends_on: string;
  /** The event's IANA zone. CLAUDE.md: "Times are UTC timestamptz in storage;
   *  the client formats using `event_timezone`." Without it here, the agenda
   *  formatted in the *server's* OS zone and the itinerary hardcoded UTC, so
   *  the same session showed 05:00 on one page and 09:00 on another and 02:00
   *  in reality. */
  timezone: string;
};

/** An instant, in the conference's own local time.
 *
 *  The agenda formatted with `toLocaleTimeString(undefined)` — on the server,
 *  so the *host's* OS zone — and the itinerary hardcoded UTC, so one session
 *  read 05:00 on one page and 09:00 on another when it was really at 02:00.
 *  Three callers now, which is what earns this a shared home. */
export function eventTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(new Date(iso));
}

/** "Wed 12 May", in the event's zone. */
export function eventDay(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(new Date(iso));
}

/** The zone as a reader recognises it — "PDT", not "GMT-7". */
export function zoneLabel(iso: string, timezone: string): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" })
      .formatToParts(new Date(iso))
      .find((part) => part.type === "timeZoneName")?.value ?? timezone
  );
}

/** A bare calendar date (`"2027-05-12"`), formatted where it was written, not
 *  where it is read. `2027-05-12` parses as UTC midnight, and formatting that
 *  in the reader's own zone renders 11 May for everyone west of Greenwich —
 *  the schedule page once said "May 11 – 13" for a conference that runs the
 *  12th to the 14th. A calendar date has no timezone of its own, so UTC is
 *  used as a fixed anchor, not a claim about where the event is. */
export function calendarDate(value: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    ...options,
    timeZone: "UTC",
  });
}

export async function getPublic<T>(slug: string, path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/public/events/${slug}${path}`, {
    cache: "no-store",
  });
  if (!response.ok) notFound();
  return response.json() as Promise<T>;
}

/** For the three surfaces that go blank before publish — schedule, agenda,
 *  speakers — `null` means "nothing published yet", which is a real, expected
 *  state, not an error. A 404 is the only response that means that (see
 *  `publishing/snapshot.py:require_latest`); anything else — a 500, a bad
 *  gateway, the request never landing — is a real failure and is left to
 *  throw, so it reaches this route's `error.tsx` instead of being relabelled
 *  "not published yet". A blind `catch {}` around `getPublic` used to
 *  swallow both alike: a backend crash and an unpublished schedule read as
 *  the identical, calm "check back closer to the event." */
export async function getPublicOptional<T>(slug: string, path: string): Promise<T | null> {
  const response = await fetch(`${API_BASE_URL}/public/events/${slug}${path}`, {
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json() as Promise<T>;
}

const NAV = [
  { href: "", label: "About" },
  { href: "/schedule", label: "Sessions" },
  { href: "/agenda", label: "Agenda" },
  { href: "/speakers", label: "Speakers" },
  { href: "/itinerary", label: "My schedule" },
  { href: "/cfp", label: "Submit a talk" },
] as const;

/** Public shell. Body is 16px here, not the console's 14px, and the display face
 *  is allowed because these are the pages strangers see. */
export function PublicShell({
  event,
  slug,
  active,
  children,
}: {
  event: EventInfo;
  slug: string;
  active: string;
  children: React.ReactNode;
}) {
  const day = (value: string, withYear: boolean) =>
    calendarDate(value, {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    });
  const dates = `${day(event.starts_on, false)} – ${day(event.ends_on, true)}`;

  return (
    <div style={{ fontSize: 16, minHeight: "100vh", background: "var(--pp)" }}>
      <header style={{ borderBottom: "1px solid var(--ln)", background: "var(--cd)" }}>
        <div style={{ maxWidth: 1040, margin: "0 auto", padding: "18px 24px" }}>
          <p
            style={{
              margin: 0,
              font: "600 10px var(--font-plex-condensed)",
              letterSpacing: "0.12em",
              color: "var(--i4)",
            }}
          >
            {dates}
            {event.location !== null ? ` · ${event.location}` : ""}
          </p>
          <h1
            style={{
              font: "600 30px var(--font-bricolage), sans-serif",
              color: "var(--ik)",
              margin: "4px 0 14px",
            }}
          >
            {event.name}
          </h1>
          <nav style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {NAV.map((item) => {
              const selected = active === item.label;
              return (
                <Link
                  key={item.label}
                  href={`/e/${slug}${item.href}` as never}
                  style={{
                    textDecoration: "none",
                    minHeight: 36,
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "0 16px",
                    borderRadius: 999,
                    font: "500 13px var(--font-plex-sans), sans-serif",
                    background: selected ? "var(--sw)" : "transparent",
                    color: selected ? "var(--sg)" : "var(--i2)",
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 24px 80px" }}>
        {children}
      </main>
    </div>
  );
}

export function NotPublished({ what }: { what: string }) {
  return (
    <div
      style={{
        background: "var(--cd)",
        border: "1px solid var(--ln)",
        borderRadius: 14,
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      <p style={{ font: "600 15px var(--font-plex-sans)", color: "var(--ik)", margin: "0 0 6px" }}>
        The {what} is not published yet
      </p>
      <p style={{ font: "400 14px var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}>
        Check back closer to the event.
      </p>
    </div>
  );
}
