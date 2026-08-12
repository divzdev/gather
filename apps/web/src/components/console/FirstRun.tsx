"use client";

/** What to do next, on an event that has nothing in it yet.
 *
 *  A brand-new event renders an Overview of zeros: "No overdue speaker tasks",
 *  "0 submissions unreviewed", "No schedule conflicts". Every one of those is
 *  true, and together they say nothing — worse, the actions beside them are
 *  wrong. "Send nudge" with no speakers to nudge, "Start reviewing" with no
 *  proposals, "Open agenda" before a single room or day exists. An organiser who
 *  has just named their event is offered four dead ends and no first step.
 *
 *  So this replaces that first screen while the event is empty, and disappears
 *  the moment it isn't. It is deliberately a checklist rather than a wizard: the
 *  order below is the order the data depends on — the CFP form's Track and
 *  Format dropdowns read the program skeleton, and nothing can be scheduled
 *  before days and rooms exist — but an organiser who already knows that should
 *  be able to jump straight to the part they want.
 */

import { useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";

import { authed, getEventId } from "@/lib/session";

type Step = {
  title: string;
  why: string;
  // `typedRoutes` is on, so this is checked against the app's real routes — a
  // step pointing somewhere that does not exist fails the build rather than 404ing.
  href: Route;
  done: boolean;
};

/** Anything with a `total` is a page; anything else is a plain list. Both shapes
 *  appear across these endpoints, so count defensively rather than guessing. */
function count(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object") {
    const meta = (value as { meta?: { total?: number } }).meta;
    if (typeof meta?.total === "number") return meta.total;
    const data = (value as { data?: unknown[] }).data;
    if (Array.isArray(data)) return data.length;
  }
  return 0;
}

export function FirstRun() {
  const eventId = typeof window === "undefined" ? null : getEventId();

  const { data, isPending } = useQuery({
    queryKey: ["first-run", eventId],
    enabled: eventId !== null,
    queryFn: async () => {
      const [days, rooms, tracks, formats, forms, submissions] = await Promise.all([
        authed<unknown>(`/events/${eventId}/days`),
        authed<unknown>(`/events/${eventId}/rooms`),
        authed<unknown>(`/events/${eventId}/tracks`),
        authed<unknown>(`/events/${eventId}/session-formats`),
        authed<unknown>(`/events/${eventId}/forms`),
        authed<unknown>(`/events/${eventId}/submissions?per_page=1`),
      ]);
      return {
        days: count(days),
        rooms: count(rooms),
        tracks: count(tracks),
        formats: count(formats),
        forms: count(forms),
        submissions: count(submissions),
      };
    },
  });

  // Never flash the checklist at an established event while the counts load.
  if (isPending || data === undefined) return null;

  // The first proposal is the point where the zeros start meaning something and
  // the real Overview earns the space back.
  if (data.submissions > 0) return null;

  const hasProgram = data.days > 0 && data.rooms > 0 && data.tracks > 0 && data.formats > 0;
  const steps: Step[] = [
    {
      title: "Set up the program",
      why: "Days, rooms, tracks and session formats. The agenda grid is drawn from these, and the CFP form's dropdowns read them — so this comes first.",
      href: "/admin/program",
      done: hasProgram,
    },
    {
      title: "Build the call for papers",
      why: "Choose the questions speakers answer. Fields stay editable until the first proposal arrives.",
      href: "/admin/forms",
      done: data.forms > 0,
    },
    {
      title: "Open the call",
      why: "Publishes the public form and sets the deadline. The server clock decides when it closes, not the browser's.",
      href: "/admin/forms",
      done: false,
    },
  ];

  const next = steps.find((step) => !step.done);
  if (next === undefined) return null;

  return (
    <section
      aria-label="Getting started"
      style={{
        border: "1px solid var(--ln)",
        borderRadius: 14,
        background: "var(--cd)",
        padding: "22px 24px",
        marginBottom: 16,
      }}
    >
      <p
        style={{
          font: "600 10.5px var(--font-plex-sans)",
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "var(--i3)",
          margin: "0 0 6px",
        }}
      >
        Getting started
      </p>
      <h2
        style={{
          font: "700 19px var(--font-plex-sans)",
          color: "var(--ik)",
          margin: "0 0 4px",
          letterSpacing: "-.01em",
        }}
      >
        {next.title}
      </h2>
      <p
        style={{
          font: "400 13px/1.55 var(--font-plex-sans)",
          color: "var(--i2)",
          margin: "0 0 18px",
          maxWidth: "68ch",
        }}
      >
        {next.why}
      </p>

      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {steps.map((step) => {
          const isNext = step === next;
          return (
            <li key={step.title}>
              <Link
                href={step.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  minHeight: 44,
                  padding: "0 16px",
                  borderRadius: 10,
                  textDecoration: "none",
                  border: `1px solid ${isNext ? "var(--sg)" : "var(--ln)"}`,
                  background: isNext ? "var(--sw)" : "transparent",
                  color: step.done ? "var(--i3)" : "var(--ik)",
                  font: `${isNext ? "600" : "500"} 13px var(--font-plex-sans)`,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 18,
                    height: 18,
                    flex: "none",
                    borderRadius: 999,
                    border: `1.5px solid ${step.done ? "var(--ok)" : isNext ? "var(--sg)" : "var(--ls)"}`,
                    background: step.done ? "var(--ok)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--cd)",
                    fontSize: 11,
                    lineHeight: 1,
                  }}
                >
                  {step.done ? "✓" : ""}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>{step.title}</span>
                <span
                  style={{
                    font: "500 12px var(--font-plex-sans)",
                    color: isNext ? "var(--sg)" : "var(--i4)",
                  }}
                >
                  {step.done ? "Done" : isNext ? "Start →" : "Later"}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
