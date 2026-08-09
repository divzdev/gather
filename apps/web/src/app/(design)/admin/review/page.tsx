"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useConsoleChrome } from "@/components/console/chrome";
import { Evaluations, type EvaluationsData } from "@/components/design/Evaluations";
import { authed, getEventId } from "@/lib/session";

type Round = {
  id: string;
  name: string;
  is_blind: boolean;
  status: string;
  sort_order: number;
  closes_at: string | null;
};

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
type Progress = {
  user_id: string;
  name: string;
  email: string;
  assigned: number;
  completed: number;
};

type Pace = "Done" | "On pace" | "Behind" | "Not started";

const PACE_COLOURS: Record<Pace, { fg: string; bg: string }> = {
  Done: { fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)" },
  "On pace": { fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)" },
  Behind: { fg: "var(--pd,#B96A1F)", bg: "var(--pdw,#F9EDDF)" },
  "Not started": { fg: "var(--cn,#D8432B)", bg: "var(--cnw,#FBE8E6)" },
};

/** Behind is under half done. The prototype's four bands, derived from the two
 *  numbers the API actually reports rather than a stored status. */
function paceOf(row: Progress): Pace {
  if (row.assigned === 0) return "Done";
  if (row.completed === 0) return "Not started";
  if (row.completed >= row.assigned) return "Done";
  return row.completed / row.assigned < 0.5 ? "Behind" : "On pace";
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

type SortKey = "name" | "done" | "pace" | "bias";

/** Review progress across the round: who is assigned what, who has finished,
 *  and who needs chasing. Nudging is the one write on this screen. */
export default function EvaluationsPage() {
  const { chrome, toasts, toast, dismiss } = useConsoleChrome();
  const queryClient = useQueryClient();
  const eventId = typeof window === "undefined" ? null : getEventId();

  const [view, setView] = useState<"plans" | "eval">("eval");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const { data: rounds } = useQuery({
    queryKey: ["review-rounds-admin", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Round[]>(`/events/${eventId}/review-rounds`),
  });
  const openRound = rounds?.find((round) => round.status === "open") ?? rounds?.[0] ?? null;

  const { data: progress } = useQuery({
    queryKey: ["review-progress", eventId, openRound?.id],
    enabled: eventId !== null && openRound != null,
    queryFn: () => authed<Progress[]>(`/events/${eventId}/review-rounds/${openRound?.id}/progress`),
  });

  const { data: scores } = useQuery({
    queryKey: ["review-scores", eventId],
    enabled: eventId !== null,
    queryFn: async () => {
      const page = await authed<{ data: { score_avg: string | null }[] }>(
        `/events/${eventId}/submissions?per_page=200`,
      );
      return page.data
        .map((row) => (row.score_avg === null ? null : Number(row.score_avg)))
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
    },
  });

  const nudge = useMutation({
    mutationFn: () =>
      authed<{ sent: number; skipped: number }>(
        `/events/${eventId}/review-rounds/${openRound?.id}/nudge`,
        { method: "POST" },
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["review-progress", eventId] });
      toast(
        `Reminder queued for ${result.sent} reviewer${result.sent === 1 ? "" : "s"}` +
          (result.skipped > 0 ? `; ${result.skipped} already finished.` : "."),
      );
    },
    onError: (error: Error) => toast(error.message),
  });

  const reviewers = progress ?? [];
  const done = reviewers.reduce((total, row) => total + row.completed, 0);
  const assigned = reviewers.reduce((total, row) => total + row.assigned, 0);
  const chasing = reviewers.filter((row) => {
    const pace = paceOf(row);
    return pace === "Behind" || pace === "Not started";
  }).length;

  const scored = scores ?? [];
  const median =
    scored.length === 0
      ? null
      : scored.length % 2 === 1
        ? scored[(scored.length - 1) / 2]!
        : (scored[scored.length / 2 - 1]! + scored[scored.length / 2]!) / 2;

  const sorted = [...reviewers].sort((a, b) => {
    const by =
      sortKey === "done"
        ? (a.assigned === 0 ? 0 : a.completed / a.assigned) -
          (b.assigned === 0 ? 0 : b.completed / b.assigned)
        : sortKey === "pace"
          ? paceOf(a).localeCompare(paceOf(b))
          : a.name.localeCompare(b.name);
    return by * sortDir;
  });

  const sorter = (key: SortKey) => ({
    on: () => {
      if (sortKey === key) setSortDir((dir) => (dir === 1 ? -1 : 1));
      else {
        setSortKey(key);
        setSortDir(key === "name" ? 1 : -1);
      }
    },
    g: sortKey === key ? (sortDir === 1 ? "↑" : "↓") : "↑↓",
    gc: sortKey === key ? "var(--sg,#E04E4E)" : "var(--i4,#99A6AD)",
    fg: sortKey === key ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
  });

  const tile = (active: boolean, count: number, on: () => void) => ({
    c: count,
    on,
    bd: active ? "var(--sg,#E04E4E)" : "var(--ln,#E1E7E9)",
    ring: active ? "0 0 0 3px var(--sw,#FFEAE6)" : "0 1px 2px rgba(13,16,32,.04)",
    numFg: active ? "var(--sg,#E04E4E)" : "var(--ik,#16232B)",
  });

  const segment = (active: boolean) =>
    active
      ? {
          bg: "var(--cd,#FFFFFF)",
          fg: "var(--ik,#16232B)",
          wt: "600",
          sh: "0 1px 2px rgba(13,16,32,.08)",
        }
      : { bg: "none", fg: "var(--i3,#6B7B84)", wt: "500", sh: "none" };

  const roundCount = rounds?.length ?? 0;

  const screen: EvaluationsData = {
    ...chrome,

    tPlans: tile(view === "plans", roundCount, () => setView("plans")),
    tEvalsT: tile(view === "eval", reviewers.length, () => setView("eval")),
    tBehind: tile(false, chasing, () => {
      setView("eval");
      setSortKey("done");
      setSortDir(1);
    }),
    tDoneE: tile(false, done, () => setView("eval")),
    sumLine:
      `${roundCount} ${roundCount === 1 ? "round" : "rounds"} configured · ` +
      `${done} of ${assigned} reviews in · ` +
      `${chasing} ${chasing === 1 ? "evaluator needs" : "evaluators need"} a nudge`,

    coverage: assigned === 0 ? "—" : `${Math.round((done / assigned) * 100)}%`,
    evalsFrac: `${done}/${assigned}`,
    medianScore: median === null ? "—" : median.toFixed(1),
    notStartedLine:
      chasing === 0
        ? "EVERY REVIEWER HAS STARTED"
        : `${chasing} ${chasing === 1 ? "REVIEWER NEEDS" : "REVIEWERS NEED"} A NUDGE`,
    closesLine:
      openRound === null
        ? "no round configured"
        : openRound.closes_at == null
          ? `${openRound.name} · no close date`
          : `${openRound.name} closes ${DAY.format(new Date(openRound.closes_at))}`,
    evaluatorCount: reviewers.length,

    onPlans: view === "plans",
    onEval: view === "eval",
    vPlans: () => setView("plans"),
    vEval: () => setView("eval"),
    pB: segment(view === "plans"),
    eB: segment(view === "eval"),

    soName: sorter("name"),
    soDone: sorter("done"),
    soPace: sorter("pace"),
    soBias: sorter("bias"),

    evals: sorted.map((row) => {
      const pace = paceOf(row);
      const fraction = row.assigned === 0 ? 0 : row.completed / row.assigned;
      return {
        n: row.name,
        ini: initials(row.name),
        frac: `${row.completed}/${row.assigned}`,
        w: `${Math.round(fraction * 100)}%`,
        fill:
          pace === "Not started"
            ? "var(--cn,#D8432B)"
            : pace === "Behind"
              ? "var(--pd,#B96A1F)"
              : "var(--ok,#0E7A5F)",
        pace,
        paceFg: PACE_COLOURS[pace].fg,
        paceBg: PACE_COLOURS[pace].bg,
        // Scoring bias needs each reviewer's mean against the overall mean; the
        // progress endpoint reports counts only, so this stays blank rather
        // than showing a number nothing computed.
        bias: "·",
        biasFg: "var(--i4,#99A6AD)",
        onNudge: () => nudge.mutate(),
      };
    }),

    nudgeSlow: () => nudge.mutate(),
    newPlan: () => toast("Round creation is on the API; the builder screen is not wired yet."),
    editR2: () => toast("Round editing is on the API; the builder screen is not wired yet."),
    previewR2: () => toast("Preview follows the round builder."),

    toasts: toasts.map((entry) => ({ msg: entry.msg, onX: () => dismiss(entry.id) })),
  };

  return <Evaluations d={screen} />;
}
