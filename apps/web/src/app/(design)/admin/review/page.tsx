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

type Member = { user_id: string; name: string; email: string; role: string };

/** Everyone who can be handed a review queue. Owners and admins review too. */
const REVIEWING_ROLES = new Set(["owner", "admin", "coordinator", "reviewer"]);

const ROUND_STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  draft: { label: "Draft", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)" },
  open: { label: "Open", fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)" },
  closed: { label: "Closed", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)" },
};
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
  const { toasts, toast, dismiss } = useConsoleChrome();
  const queryClient = useQueryClient();
  const eventId = typeof window === "undefined" ? null : getEventId();

  const [view, setView] = useState<"plans" | "eval">("eval");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const [newName, setNewName] = useState("");
  const [newBlind, setNewBlind] = useState(false);

  const { data: rounds } = useQuery({
    queryKey: ["review-rounds-admin", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Round[]>(`/events/${eventId}/review-rounds`),
  });

  const { data: members } = useQuery({
    queryKey: ["members", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Member[]>(`/events/${eventId}/members`),
  });

  const { data: plans } = useQuery({
    queryKey: ["round-plans", eventId, (rounds ?? []).map((r) => r.id).join(",")],
    enabled: eventId !== null && (rounds ?? []).length > 0,
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          (rounds ?? []).map(async (round) => {
            const [criteria, progressRows] = await Promise.all([
              authed<{ id: string }[]>(`/events/${eventId}/review-rounds/${round.id}/criteria`),
              authed<Progress[]>(`/events/${eventId}/review-rounds/${round.id}/progress`),
            ]);
            return [round.id, { criteria, progress: progressRows }] as const;
          }),
        ),
      ),
  });

  const refreshRounds = () => {
    void queryClient.invalidateQueries({ queryKey: ["review-rounds-admin", eventId] });
    void queryClient.invalidateQueries({ queryKey: ["round-plans", eventId] });
    void queryClient.invalidateQueries({ queryKey: ["review-progress", eventId] });
  };

  const createRound = useMutation({
    mutationFn: (body: { name: string; is_blind: boolean }) =>
      authed<Round>(`/events/${eventId}/review-rounds`, { method: "POST", body }),
    onSuccess: (round) => {
      refreshRounds();
      setNewName("");
      toast(`Created ${round.name}. Add its criteria, then assign reviewers.`);
    },
    onError: (error: Error) => toast(error.message),
  });

  const patchRound = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      authed<Round>(`/events/${eventId}/review-rounds/${id}`, { method: "PATCH", body }),
    onSuccess: (round) => {
      refreshRounds();
      toast(`${round.name} is now ${round.is_blind ? "blind" : "open"}.`);
    },
    onError: (error: Error) => toast(error.message),
  });

  const distribute = useMutation({
    mutationFn: (id: string) =>
      authed<{ created: number; under_assigned: number }>(
        `/events/${eventId}/review-rounds/${id}/auto-distribute`,
        {
          method: "POST",
          body: {
            user_ids: (members ?? [])
              .filter((member) => REVIEWING_ROLES.has(member.role))
              .map((member) => member.user_id),
            per_submission: 2,
          },
        },
      ),
    onSuccess: (result) => {
      refreshRounds();
      toast(
        `${result.created} assignments created` +
          (result.under_assigned > 0
            ? `; ${result.under_assigned} submissions could not be fully covered.`
            : "."),
      );
    },
    onError: (error: Error) => toast(error.message),
  });

  const advance = useMutation({
    mutationFn: (id: string) =>
      authed<Record<string, number>>(`/events/${eventId}/review-rounds/${id}/advance`, {
        method: "POST",
      }),
    onSuccess: (result) => {
      refreshRounds();
      const advanced = result["advanced"] ?? 0;
      toast(`${advanced} submission${advanced === 1 ? "" : "s"} advanced.`);
    },
    onError: (error: Error) => toast(error.message),
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

    rounds: (rounds ?? []).map((round) => {
      const plan = plans?.[round.id];
      const rows = plan?.progress ?? [];
      const total = rows.reduce((sum, row) => sum + row.assigned, 0);
      const finished = rows.reduce((sum, row) => sum + row.completed, 0);
      const status = ROUND_STATUS[round.status] ?? ROUND_STATUS.draft!;
      return {
        name: round.name,
        stLabel: status.label,
        stFg: status.fg,
        stBg: status.bg,
        blindD: round.is_blind ? "inline-flex" : "none",
        blindLabel: round.is_blind ? "Show identities" : "Make blind",
        meta:
          round.closes_at == null
            ? "no close date · rubric below"
            : `due ${DAY.format(new Date(round.closes_at))} · ${plan?.criteria.length ?? 0} criteria`,
        subs: new Set(rows.map((row) => row.user_id)).size === 0 ? 0 : total,
        evals: rows.length,
        done: finished,
        total,
        crits: plan?.criteria.length ?? 0,
        progW: total === 0 ? "0%" : `${Math.round((finished / total) * 100)}%`,
        onAssign: () => distribute.mutate(round.id),
        onNudge: () => nudge.mutate(),
        onBlind: () => patchRound.mutate({ id: round.id, body: { is_blind: !round.is_blind } }),
        onAdvance: () => advance.mutate(round.id),
      };
    }),
    // The header's New plan button and the create card do the same thing.
    newPlan: () => {
      setView("plans");
      toast("Name the round in the card below, then create it.");
    },
    newName,
    onNewName: (e: React.SyntheticEvent) => setNewName((e.target as HTMLInputElement).value),
    newBlindLabel: newBlind ? "Blind: on" : "Blind: off",
    togNewBlind: () => setNewBlind((on) => !on),
    createRound: () => {
      const name = newName.trim();
      if (name === "") {
        toast("Give the round a name first.");
        return;
      }
      createRound.mutate({ name, is_blind: newBlind });
    },
    plansNote:
      (members ?? []).filter((member) => REVIEWING_ROLES.has(member.role)).length === 0
        ? "No reviewers on this event yet — assignment needs someone to assign to."
        : `${(members ?? []).filter((m) => REVIEWING_ROLES.has(m.role)).length} people can review. Assignment balances by current load and never gives anyone their own submission.`,

    toasts: toasts.map((entry) => ({ msg: entry.msg, onX: () => dismiss(entry.id) })),
  };

  return <Evaluations d={screen} />;
}
