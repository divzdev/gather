"use client";

/** Every conference this speaker is on, and a way between them.
 *
 *  A speaker session is bound to one event, so somebody speaking at three of an
 *  organiser's conferences held three magic links, three sessions and three
 *  portals — with nothing on any of them naming the other two. The only place
 *  their programme existed as a whole was their inbox.
 *
 *  Hidden entirely at one conference. A switcher offering one destination is
 *  furniture, and it would appear on every speaker's portal to serve the few.
 */

import { useMutation, useQuery } from "@tanstack/react-query";

import { portal, setSpeakerToken } from "@/lib/session";

type SpeakerEvent = {
  event_id: string;
  name: string;
  slug: string;
  starts_on: string;
  ends_on: string;
  status: string;
  open_tasks: number;
  is_current: boolean;
};

const MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** A calendar date, not an instant: `new Date("2027-05-12")` is UTC midnight,
 *  which is the previous day west of Greenwich. */
function dateOnly(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function ConferenceSwitcher() {
  const { data } = useQuery({
    queryKey: ["portal-events"],
    queryFn: () => portal<SpeakerEvent[]>("/events"),
  });

  const switchTo = useMutation({
    mutationFn: (eventId: string) =>
      portal<{ access_token: string }>("/switch", {
        method: "POST",
        body: { event_id: eventId },
      }),
    onSuccess: (result) => {
      setSpeakerToken(result.access_token);
      // A hard reload rather than cache invalidation: every query on this
      // screen is scoped to the old event by the token itself, so the honest
      // move is to start the portal again as the new session.
      window.location.reload();
    },
  });

  const events = data ?? [];
  if (events.length < 2) return null;

  return (
    <nav
      aria-label="Your conferences"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        padding: "12px 20px",
        borderBottom: "1px solid var(--ln,#E1E7E9)",
        background: "var(--sk,#EDF1F2)",
      }}
    >
      <span
        style={{
          font: "500 10.5px 'IBM Plex Mono',monospace",
          letterSpacing: "0.11em",
          textTransform: "uppercase",
          color: "var(--i3,#6B7B84)",
          marginRight: 4,
        }}
      >
        Your conferences
      </span>

      {events.map((entry) => {
        const dates = `${MONTH.format(dateOnly(entry.starts_on))} – ${MONTH.format(dateOnly(entry.ends_on))}`;
        return (
          <button
            key={entry.event_id}
            type="button"
            disabled={entry.is_current || switchTo.isPending}
            aria-current={entry.is_current ? "page" : undefined}
            onClick={() => switchTo.mutate(entry.event_id)}
            title={
              entry.is_current
                ? "You are looking at this one."
                : `Switch to ${entry.name} · ${dates}`
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              minHeight: 36,
              padding: "0 14px",
              borderRadius: 999,
              cursor: entry.is_current ? "default" : "pointer",
              border: `1px solid ${entry.is_current ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)"}`,
              background: entry.is_current ? "var(--cd,#FFFFFF)" : "transparent",
              font: `${entry.is_current ? 600 : 400} 13px 'IBM Plex Sans',sans-serif`,
              color: entry.is_current ? "var(--ik,#16232B)" : "var(--i2,#3E4E58)",
              opacity: switchTo.isPending && !entry.is_current ? 0.6 : 1,
            }}
          >
            {entry.name}
            {/* The count is the reason to look at the other conference at all. */}
            {entry.open_tasks > 0 && (
              <span
                className="tabular"
                title={`${entry.open_tasks} still to do`}
                style={{
                  minWidth: 18,
                  padding: "1px 6px",
                  borderRadius: 999,
                  font: "600 11px 'IBM Plex Sans',sans-serif",
                  background: "var(--pdw,#F9EDDF)",
                  color: "var(--pd,#B96A1F)",
                }}
              >
                {entry.open_tasks}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
