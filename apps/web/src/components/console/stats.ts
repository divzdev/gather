"use client";

/** The programme numbers the console repeats everywhere: the strip along the top
 *  of each screen, the rail badges, the Overview pulse. One query behind one key,
 *  so a screen and its rail do not each ask.
 */

import { useQuery } from "@tanstack/react-query";

import { authed, getEventId } from "@/lib/session";

type Row = { status: string; decision_status: string };
type Page = { data: Row[]; meta: { total: number } };
type Event = { name: string; starts_on: string; ends_on: string; cfp_closes_at: string | null };

export type ProgramStats = {
  total: number;
  unreviewed: number;
  decided: number;
  accepted: number;
  drafts: number;
  pendingSend: number;
  cfpDays: number | null;
  event: Event | null;
};

const DECIDED = new Set(["accepted", "waitlisted", "rejected"]);

export function useProgramStats(): { stats: ProgramStats; eventId: string | null } {
  const eventId = typeof window === "undefined" ? null : getEventId();

  const { data } = useQuery({
    queryKey: ["program-stats", eventId],
    enabled: eventId !== null,
    staleTime: 15_000,
    queryFn: async () => {
      const [page, event] = await Promise.all([
        authed<Page>(`/events/${eventId}/submissions?per_page=200`),
        authed<Event>(`/events/${eventId}`),
      ]);
      // Computed here rather than in render: the countdown reads the clock, and
      // an impure read during render is a re-render hazard.
      const closesAt = event.cfp_closes_at === null ? null : new Date(event.cfp_closes_at).getTime();
      const cfpDays =
        closesAt === null ? null : Math.max(0, Math.ceil((closesAt - Date.now()) / 86_400_000));
      return { page, event, cfpDays };
    },
  });

  const rows = data?.page.data ?? [];

  return {
    eventId,
    stats: {
      total: data?.page.meta.total ?? 0,
      unreviewed: rows.filter((row) => row.status === "submitted").length,
      decided: rows.filter((row) => DECIDED.has(row.status)).length,
      accepted: rows.filter((row) => row.status === "accepted").length,
      drafts: rows.filter((row) => row.status === "draft").length,
      pendingSend: rows.filter((row) => row.decision_status === "pending_send").length,
      cfpDays: data?.cfpDays ?? null,
      event: data?.event ?? null,
    },
  };
}

/** The strip along the top of most screens, in the shape the design expects. */
export function stripData(stats: ProgramStats): {
  subCount: number;
  unreviewedCount: number;
  decidedCount: number;
  cfpShort: string;
  cfpDays: number | string;
} {
  return {
    subCount: stats.total,
    unreviewedCount: stats.unreviewed,
    decidedCount: stats.decided,
    cfpShort: stats.cfpDays === null ? "—" : `${stats.cfpDays}d`,
    cfpDays: stats.cfpDays ?? "—",
  };
}
