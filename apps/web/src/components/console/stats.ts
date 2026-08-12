"use client";

/** The programme numbers the console repeats everywhere: the strip along the top
 *  of each screen, the rail badges, the Overview pulse. One query behind one key,
 *  so a screen and its rail do not each ask.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { authed, getEventId, setEventId } from "@/lib/session";

type Row = { status: string; decision_status: string };
type Page = { data: Row[]; meta: { total: number } };
type Event = {
  name: string;
  slug: string;
  starts_on: string;
  ends_on: string;
  cfp_closes_at: string | null;
};
type Conflict = { severity: string; label: string; detail?: string | null };
type TaskRow = { status: string };

/** Every status the lifecycle has, so a count can never quietly omit one. */
export const STATUSES = [
  "draft",
  "submitted",
  "in_review",
  "accepted",
  "waitlisted",
  "rejected",
  "withdrawn",
] as const;
export type SubmissionStatus = (typeof STATUSES)[number];

export type ProgramStats = {
  total: number;
  unreviewed: number;
  decided: number;
  accepted: number;
  drafts: number;
  pendingSend: number;
  //: One entry per status, counted by the database rather than by whatever
  //: subset of rows the client happened to fetch.
  byStatus: Record<SubmissionStatus, number>;
  //: In review and actually scored — the only console view that is not a
  //: status, so it is the only one that needs its own count.
  readyToDecide: number;
  cfpDays: number | null;
  //: Sessions in the programme. Not the same as accepted submissions — an
  //: accepted proposal is not a session until somebody promotes it, and the
  //: rail badge sat under a "Sessions" label reading the submission count.
  sessions: number;
  //: Hard conflicts only: room and speaker double-bookings, the ones that must
  //: be resolved. Track collisions are frequently deliberate.
  conflicts: number;
  //: Every class, which is what the agenda's own list shows. Two numbers under
  //: one word was the bug; two numbers that each say what they count is not.
  conflictsAll: number;
  //: The few worth naming on Overview, not just the count.
  conflictList: { label: string; detail: string }[];
  overdueTasks: number;
  event: Event | null;
  //: Whether any of the above is a fact yet.
  //:
  //: Every count below defaults to 0 while the query is in flight, and 0 is a
  //: claim: "no submissions, nothing unreviewed, no conflicts" rendered across
  //: the top of every console route on an event with 215 proposals. An empty
  //: state and a loading state are different assertions and were drawn
  //: identically. Callers that display a number must show nothing until this
  //: is true.
  ready: boolean;
};

const DECIDED_STATUSES = ["accepted", "waitlisted", "rejected"] as const;

export function useProgramStats(): { stats: ProgramStats; eventId: string | null } {
  const stored = typeof window === "undefined" ? null : getEventId();
  const [eventId, setCurrent] = useState(stored);

  /** A stored id can outlive the event it names — the database was reset, the
   *  event was deleted, or the token now belongs to a different organisation.
   *  Every screen then read an event that 404s and rendered empty forever, with
   *  the switcher stuck on "Loading…" and nothing saying why. Adopting the first
   *  event the account can actually see is the recovery. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mine = await authed<{ id: string }[]>("/events").catch(() => null);
      if (cancelled || mine === null) return;
      const known = mine.some((row) => row.id === eventId);
      const first = mine[0];
      if (known || first === undefined) return;
      setEventId(first.id);
      setCurrent(first.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const { data, isSuccess } = useQuery({
    queryKey: ["program-stats", eventId],
    enabled: eventId !== null,
    staleTime: 15_000,
    queryFn: async () => {
      // A reviewer can read submissions but not the agenda or the task board, so
      // each badge source falls back to empty rather than failing the whole rail.
      // Counted per status by the API, not derived from a page of rows. These
      // numbers drive the rail badges and the Overview pulse, and they used to
      // be computed from the first 200 submissions — so on a 608-row event
      // every one of them silently stopped at 200.
      const counts = Promise.all(
        STATUSES.map(async (status) => {
          const slice = await authed<Page>(
            `/events/${eventId}/submissions?per_page=1&filter[status]=${status}`,
          );
          return [status, slice.meta.total] as const;
        }),
      );
      const [page, event, conflicts, sessions, tasks, byStatusPairs, pending, ready] =
        await Promise.all([
        authed<Page>(`/events/${eventId}/submissions?per_page=1`),
        authed<Event>(`/events/${eventId}`),
        authed<Conflict[]>(`/events/${eventId}/conflicts`).catch(() => [] as Conflict[]),
        authed<{ id: string }[]>(`/events/${eventId}/sessions`).catch(() => [] as { id: string }[]),
        authed<TaskRow[]>(`/events/${eventId}/tasks/summary`).catch(() => [] as TaskRow[]),
        counts,
        authed<{ total: number }>(`/events/${eventId}/submissions/pending-decisions`).catch(() => ({
          total: 0,
        })),
        authed<Page>(
          `/events/${eventId}/submissions?per_page=1&filter[status]=in_review&filter[reviewed]=true`,
        ),
      ]);
      // Computed here rather than in render: the countdown reads the clock, and
      // an impure read during render is a re-render hazard.
      const closesAt =
        event.cfp_closes_at === null ? null : new Date(event.cfp_closes_at).getTime();
      const cfpDays =
        closesAt === null ? null : Math.max(0, Math.ceil((closesAt - Date.now()) / 86_400_000));
      return {
        page,
        event,
        byStatus: Object.fromEntries(byStatusPairs) as Record<SubmissionStatus, number>,
        readyToDecide: ready.meta.total,
        pendingSend: pending.total,
        cfpDays,
        sessions: sessions.length,
        conflicts: conflicts.filter((row) => row.severity === "hard").length,
        conflictsAll: conflicts.length,
        conflictList: conflicts.slice(0, 3).map((row) => ({
          label: row.label,
          detail: row.detail ?? row.label,
        })),
        overdueTasks: tasks.filter((row) => row.status === "overdue").length,
      };
    },
  });

  const empty = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<SubmissionStatus, number>;
  const byStatus = data?.byStatus ?? empty;
  const decided = DECIDED_STATUSES.reduce((sum, status) => sum + byStatus[status], 0);

  return {
    eventId,
    stats: {
      total: data?.page.meta.total ?? 0,
      unreviewed: byStatus.submitted,
      decided,
      accepted: byStatus.accepted,
      drafts: byStatus.draft,
      byStatus,
      readyToDecide: data?.readyToDecide ?? 0,
      //: The only figure still read off a page of rows. `decision_status` is not
      //: a status filter, so there is nothing to count it by yet; Overview reads
      //: the real number from /submissions/pending-decisions.
      pendingSend: data?.pendingSend ?? 0,
      cfpDays: data?.cfpDays ?? null,
      sessions: data?.sessions ?? 0,
      conflicts: data?.conflicts ?? 0,
      conflictsAll: data?.conflictsAll ?? 0,
      conflictList: data?.conflictList ?? [],
      overdueTasks: data?.overdueTasks ?? 0,
      event: data?.event ?? null,
      ready: isSuccess,
    },
  };
}

/** The strip along the top of most screens, in the shape the design expects. */
export function stripData(stats: ProgramStats): {
  subCount: number | string;
  unreviewedCount: number | string;
  decidedCount: number | string;
  overdueCount: number | string;
  conflictCount: number | string;
  cfpShort: string;
  cfpDays: number | string;
} {
  //: An em-dash rather than a skeleton: the strip is one line of small mono
  //: text, so a shimmer would be more motion than the thing it stands in for.
  //: It cannot be mistaken for a count, which is the whole point.
  const known = <T,>(value: T): T | string => (stats.ready ? value : "—");
  return {
    subCount: known(stats.total),
    unreviewedCount: known(stats.unreviewed),
    decidedCount: known(stats.decided),
    overdueCount: known(stats.overdueTasks),
    conflictCount: known(stats.conflicts),
    cfpShort: !stats.ready || stats.cfpDays === null ? "—" : `${stats.cfpDays}d`,
    cfpDays: known(stats.cfpDays ?? "—"),
  };
}
