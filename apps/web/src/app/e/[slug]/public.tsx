import Link from "next/link";
import { notFound } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

import { INK, MONO, SANS } from "./chrome";

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

/** The public event shell.
 *
 *  A photographic band carries the nav and whatever the page puts in `hero`;
 *  the home page fills it with the event's name at display scale, and every
 *  other page passes a short title, so the band shrinks to a header without
 *  becoming a different component.
 *
 *  Palette and rationale live in `./chrome` — fixed dark, because a stranger
 *  arriving from a speaker's link has set no theme for this to follow.
 */
export function PublicShell({
  event,
  slug,
  active,
  hero,
  banner,
  children,
}: {
  event: EventInfo;
  slug: string;
  active: string;
  /** Present on the home page: a full-height photographic hero. Absent
   *  elsewhere, where the band is a header and the page starts below it. */
  hero?: { photo: string };
  /** Rendered inside the band. The home page fills it with the event's name at
   *  display scale; every other page leaves it out and gets the page title. */
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const day = (value: string, withYear: boolean) =>
    calendarDate(value, {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    });
  const dates = `${day(event.starts_on, false)} – ${day(event.ends_on, true)}`;
  const tall = hero !== undefined;

  return (
    <div
      // marketing.css defines this surface's palette against this attribute,
      // exactly as the landing does. Without it every var() falls back to its
      // literal and per-event branding would have nothing to hook onto.
      data-event=""
      style={{
        minHeight: "100vh",
        background: INK.page,
        color: INK.text,
        fontFamily: SANS,
        fontSize: 16,
      }}
    >
      <div style={{ position: "relative", overflow: "hidden" }}>
        {tall ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a decorative
                full-bleed layer sized entirely by CSS, pre-optimised on disk. */}
            <img
              src={hero.photo}
              alt=""
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "50% 45%",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(to top, ${INK.page} 4%, rgba(7,8,14,.55) 46%, rgba(7,8,14,.72))`,
              }}
            />
          </>
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(80% 140% at 15% 0%, rgba(255,107,107,.14), transparent 70%), ${INK.page}`,
            }}
          />
        )}

        <div style={{ position: "relative", zIndex: 2 }}>
          <div
            style={{
              maxWidth: 1120,
              margin: "0 auto",
              padding: "22px max(22px,4vw)",
              display: "flex",
              alignItems: "center",
              gap: 18,
              flexWrap: "wrap",
            }}
          >
            <Link
              href={`/e/${slug}` as never}
              style={{
                textDecoration: "none",
                color: INK.text,
                fontWeight: 800,
                letterSpacing: "-.02em",
                fontSize: 17,
                marginRight: "auto",
              }}
            >
              {event.name}
            </Link>
            <nav style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {NAV.map((item) => {
                const selected = active === item.label;
                return (
                  <Link
                    key={item.label}
                    href={`/e/${slug}${item.href}` as never}
                    aria-current={selected ? "page" : undefined}
                    style={{
                      textDecoration: "none",
                      minHeight: 38,
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "0 15px",
                      borderRadius: 999,
                      fontSize: 13.5,
                      fontWeight: selected ? 700 : 600,
                      background: selected ? "rgba(255,255,255,.10)" : "transparent",
                      color: selected ? INK.text : INK.muted,
                      border: `1px solid ${selected ? INK.edgeStrong : "transparent"}`,
                    }}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div
            style={{
              padding: tall
                ? "clamp(72px,16vh,190px) 0 clamp(48px,9vh,96px)"
                : "clamp(26px,4vh,44px) 0 clamp(22px,3vh,34px)",
            }}
          >
            {banner !== undefined ? (
              banner
            ) : (
              <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 max(22px,4vw)" }}>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 12,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: INK.faint,
                  }}
                >
                  {dates}
                  {event.location !== null ? ` · ${event.location}` : ""}
                </div>
                <h1
                  style={{
                    fontFamily: SANS,
                    fontWeight: 800,
                    letterSpacing: "-.03em",
                    fontSize: "clamp(1.9rem,3.6vw,2.8rem)",
                    lineHeight: 1.06,
                    margin: "12px 0 0",
                  }}
                >
                  {active}
                </h1>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* The home page's children are <Section>s, which carry their own width
          and rhythm; every other page hands over plain content and wants the
          container. */}
      {banner === undefined ? (
        <main style={{ maxWidth: 1120, margin: "0 auto", padding: "8px max(22px,4vw) 96px" }}>
          {children}
        </main>
      ) : (
        <main style={{ paddingBottom: 40 }}>{children}</main>
      )}

      <footer
        style={{
          borderTop: `1px solid ${INK.edge}`,
          padding: "26px max(22px,4vw)",
        }}
      >
        <div
          style={{
            maxWidth: 1120,
            margin: "0 auto",
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            alignItems: "center",
            fontFamily: MONO,
            fontSize: 11.5,
            color: INK.faint,
          }}
        >
          <span>
            {event.name} · {dates}
          </span>
          <span style={{ marginLeft: "auto" }}>
            Programme run on{" "}
            <Link href="/" style={{ color: INK.muted }}>
              Gather
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
