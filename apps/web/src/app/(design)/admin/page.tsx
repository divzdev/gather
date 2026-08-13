"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { useConsoleChrome } from "@/components/console/chrome";
import { FirstRun } from "@/components/console/FirstRun";
import { useProgramStats } from "@/components/console/stats";
import { Overview, type OverviewData } from "@/components/design/Overview";
import { authed, getEventId } from "@/lib/session";

type Event = {
  name: string;
  slug: string;
  starts_on: string;
  ends_on: string;
  cfp_closes_at: string | null;
};

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const LONG_DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** `starts_on` is a calendar date, not an instant. `new Date("2027-05-12")` reads
 *  it as UTC midnight, which is the day before in any western timezone. */
function parseDateOnly(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

type MilestoneState = "done" | "next" | "todo";

function daysUntil(iso: string | null): number | null {
  if (iso === null) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  return Math.max(0, Math.ceil((target - Date.now()) / 86_400_000));
}

/** Overview, rendered from the design prototype. The counts, dates and calendar
 *  come from the event; everything visual is the generated component's. */
export default function OverviewPage() {
  const { chrome, toasts, toast, dismiss } = useConsoleChrome();
  const queryClient = useQueryClient();
  const eventId = typeof window === "undefined" ? null : getEventId();

  /** Everything countable comes from useProgramStats, which asks the API for
   *  per-status totals. This page used to fetch its own 200-row sample and
   *  count that — so on a 224-submission event the pulse said "146 decided"
   *  while the ticker two centimetres above it said 127. One source now. */
  const { stats } = useProgramStats();
  const event = stats.event as Event | null;

  const total = stats.total;
  const unreviewed = stats.unreviewed;
  const decided = stats.decided;
  const cfpDays = stats.cfpDays ?? daysUntil(event?.cfp_closes_at ?? null);
  const eventStart = event?.starts_on ?? null;

  const dates = useMemo(() => keyDates(event), [event]);
  const calendar = useMemo(() => buildCalendar(dates), [dates]);
  const legend = (index: number, fallback: string) => {
    const entry = dates[index];
    return entry === undefined ? fallback : `${entry.date.getDate()} · ${entry.name}`;
  };

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Speakers who have said yes, which is the number an organiser tracks — not
  // how many rows exist.
  const { data: roster } = useQuery({
    queryKey: ["roster-confirmed", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<{ status: string }[]>(`/events/${eventId}/speakers`),
  });
  const confirmedSpeakers = (roster ?? []).filter((row) => row.status === "confirmed").length;

  /** The button used to toast "Nudges are queued in Messages" and queue
   *  nothing anywhere — a success message for an action that never ran. This
   *  is the real one: the same 24-hour-floored reminder the Tasks screen
   *  sends, aimed at everyone with something past due. */
  const sendReminders = useMutation({
    mutationFn: (speakerIds: string[]) =>
      authed<{ sent: number; skipped: number }>(`/events/${eventId}/tasks/nudge`, {
        method: "POST",
        body: { speaker_ids: speakerIds },
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["overdue-summary", eventId] });
      toast(
        result.sent === 0
          ? `Nothing sent — all ${result.skipped} were reminded in the last 24 hours.`
          : `${result.sent} reminder${result.sent === 1 ? "" : "s"} sent.` +
              (result.skipped > 0 ? ` ${result.skipped} skipped, reminded within 24 hours.` : ""),
      );
    },
    onError: (error: Error) => toast(error.message),
  });

  // The overdue card named specific deliverables and speaker counts that were
  // fixture copy. Real rows, grouped by what is being chased.
  //
  // `overdue` is a status the API derives from the clock on read, so it is read
  // here rather than recomputed — calling Date.now() during render is impure and
  // would give a different answer on the server and the client.
  const { data: overdue } = useQuery({
    queryKey: ["overdue-summary", eventId],
    enabled: eventId !== null,
    queryFn: () =>
      authed<{ task_name: string; status: string; speaker_id: string }[]>(
        `/events/${eventId}/tasks/summary`,
      ),
  });
  const overdueRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of overdue ?? []) {
      if (row.status !== "overdue") continue;
      counts.set(row.task_name, (counts.get(row.task_name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([task, count]) => ({
        task,
        who: `${count} speaker${count === 1 ? "" : "s"}`,
        late: "overdue",
      }));
  }, [overdue]);

  const conflictRows = stats.conflictList.slice(0, 3).map((row) => ({
    where: row.label,
    what: row.detail,
  }));

  const overview: OverviewData = {
    // Until the event resolves there is no correct public URL, and the console
    // home is a better landing than another organisation's event.
    cfpHref: event === null ? "/admin" : `/e/${event.slug}/cfp`,
    greet,
    confirmedCount: confirmedSpeakers,
    overdueCount: stats.overdueTasks,
    conflictCount: stats.conflicts,
    conflictHeadline:
      stats.conflicts === 0
        ? "No schedule conflicts"
        : `${stats.conflicts} schedule conflict${stats.conflicts === 1 ? "" : "s"}`,
    conflictRows,
    firstName: (chrome.youName || "there").split(" ")[0],
    overdueHeadline:
      stats.overdueTasks === 0
        ? "No overdue speaker tasks"
        : `${stats.overdueTasks} overdue speaker task${stats.overdueTasks === 1 ? "" : "s"}`,
    overdueRows: overdueRows,
    // A primary-weighted invitation to email nobody was three of this screen's
    // four solid buttons on an empty event. The weight is gone; so is the offer.
    nudgeOff: stats.overdueTasks === 0,
    nudgeTitle:
      stats.overdueTasks === 0
        ? "Nothing is overdue, so there is nobody to nudge."
        : `Email the ${stats.overdueTasks} speakers with something past due.`,
    reviewerNote:
      total === 0
        ? "No proposals yet, so nothing to review."
        : `${unreviewed} of ${total} still unreviewed.`,
    todayLine: `${LONG_DATE.format(new Date())} · ${unreviewed} reviews waiting · ${total} proposals in`,
    subCount: total,
    unreviewedCount: unreviewed,
    decidedCount: decided,
    draftCount: stats.drafts,
    cfpShort: cfpDays === null ? "—" : `${cfpDays}d`,
    cfpDays: cfpDays ?? "—",
    readyPct: total === 0 ? 0 : Math.round(((total - unreviewed) / total) * 100),
    eventMonth: eventStart === null ? "the event" : MONTH.format(parseDateOnly(eventStart)),
    calMonth: calendar.label,
    calCells: calendar.cells,
    miles: buildMilestones(dates),
    legendCfp: legend(0, "CFP closes"),
    legendReviews: legend(1, "Reviews close"),
    legendDecisions: legend(2, "Decisions out"),

    // A slot inside the content column, not a sibling of <Overview>. Overview
    // renders the whole shell — rail and topbar included — so anything placed
    // beside it lands outside the console entirely and above the chrome.
    firstRun: <FirstRun />,

    nudge: () => {
      const ids = [
        ...new Set(
          (overdue ?? []).filter((row) => row.status === "overdue").map((row) => row.speaker_id),
        ),
      ];
      if (ids.length === 0) return;
      sendReminders.mutate(ids);
    },
    toasts: toasts.map((entry) => ({ msg: entry.msg, onX: () => dismiss(entry.id) })),
  };

  return <Overview d={overview} />;
}

type KeyDate = { date: Date; name: string; fill: boolean };

/** The dates the console treats as the programme's spine. Only the CFP close and
 *  the event dates are recorded; the review and decision milestones are spaced
 *  across the window between them, so they stay in order however tight it is. */
function keyDates(event: Event | null): KeyDate[] {
  if (event === null) return [];
  const start = parseDateOnly(event.starts_on);
  const closes = event.cfp_closes_at === null ? null : new Date(event.cfp_closes_at);
  if (closes === null) return [{ date: start, name: "Event days", fill: true }];

  const span = start.getTime() - closes.getTime();
  if (span <= 0) {
    return [
      { date: start, name: "Event days", fill: false },
      { date: closes, name: "CFP closes", fill: true },
    ].sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  const at = (fraction: number) => new Date(closes.getTime() + span * fraction);
  // Only the CFP close and event days are real records; the middle three are
  // suggestions spaced across the window. Saying so is the difference between
  // a plan and a fabrication.
  return [
    { date: closes, name: "CFP closes", fill: true },
    { date: at(1 / 3), name: "Reviews close (suggested)", fill: false },
    { date: at(2 / 3), name: "Decisions out (suggested)", fill: false },
    { date: at(5 / 6), name: "Schedule live (suggested)", fill: false },
    { date: start, name: "Event days", fill: false },
  ];
}

/** The month the CFP closes in, with any key date that falls inside it marked. */
function buildCalendar(dates: KeyDate[]): { label: string; cells: OverviewData["calCells"] } {
  const anchor = dates[0]?.date ?? new Date();
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const marks = new Map<number, KeyDate>();
  for (const entry of dates) {
    if (entry.date.getFullYear() === year && entry.date.getMonth() === month) {
      marks.set(entry.date.getDate(), entry);
    }
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first, as the prototype
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthShort = MONTH.format(anchor).slice(0, 3);
  return {
    label: MONTH_YEAR.format(anchor),
    cells: cells.map((day) => {
      const mark = day === null ? undefined : marks.get(day);
      return {
        n: day === null ? "" : String(day),
        tt: mark === undefined ? "" : `${day} ${monthShort} · ${mark.name}`,
        bg: mark?.fill === true ? "var(--bt,#FF6B6B)" : "transparent",
        fg:
          mark === undefined
            ? "var(--i2,#3E4E58)"
            : mark.fill
              ? "var(--bf,#331313)"
              : "var(--sg,#E04E4E)",
        bd:
          mark !== undefined && !mark.fill
            ? "1.5px solid var(--sg,#E04E4E)"
            : "1.5px solid transparent",
        wt: mark === undefined ? "400" : "600",
      };
    }),
  };
}

function buildMilestones(dates: KeyDate[]): OverviewData["miles"] {
  const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  const now = Date.now();
  const nextIndex = dates.findIndex((entry) => entry.date.getTime() >= now);

  return dates.map((entry, index) => {
    const state: MilestoneState =
      index === nextIndex ? "next" : entry.date.getTime() < now ? "done" : "todo";
    const last = index === dates.length - 1;
    return {
      d: short.format(entry.date),
      n: entry.name,
      dotBg:
        state === "done"
          ? "var(--ok,#0E7A5F)"
          : state === "next"
            ? "var(--sg,#E04E4E)"
            : "var(--cd,#FFFFFF)",
      dotBd: state === "todo" ? "1.5px solid var(--ls,#C8D2D5)" : "1.5px solid transparent",
      dateFg: state === "next" ? "var(--sg,#E04E4E)" : "var(--i3,#6B7B84)",
      wt: state === "next" ? "600" : "500",
      line: last ? "none" : "block",
      pb: last ? "0" : "14px",
    };
  });
}
