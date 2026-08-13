"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AssignmentPanel } from "@/components/console/AssignmentPanel";
import { SideDrawer } from "@/components/console/SideDrawer";
import { useConsoleChrome } from "@/components/console/chrome";
import { Evaluations, type EvaluationsData } from "@/components/design/Evaluations";
import { RubricEditor } from "@/components/console/RubricEditor";
import { authed, getEventId } from "@/lib/session";
import { pill, quietPill } from "@/components/ui";

type Round = {
  id: string;
  name: string;
  is_blind: boolean;
  status: string;
  sort_order: number;
  closes_at: string | null;
  submission_count: number;
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

type Pace = "Done" | "On pace" | "Behind" | "Not started" | "Nothing assigned";

const PACE_COLOURS: Record<Pace, { fg: string; bg: string }> = {
  Done: { fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)" },
  "On pace": { fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)" },
  Behind: { fg: "var(--pd,#B96A1F)", bg: "var(--pdw,#F9EDDF)" },
  "Not started": { fg: "var(--cn,#D8432B)", bg: "var(--cnw,#FBE8E6)" },
  "Nothing assigned": { fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)" },
};

/** Behind is under half done. Derived from the two numbers the API actually
 *  reports rather than a stored status. A person with no queue is neither done
 *  nor behind — they are waiting for Assign reviewers to give them work. */
function paceOf(row: Progress): Pace {
  if (row.assigned === 0) return "Nothing assigned";
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

  const [planOpen, setPlanOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBlind, setNewBlind] = useState(false);
  const [assignFor, setAssignFor] = useState<string | null>(null);

  const [addingEval, setAddingEval] = useState(false);
  const [evalDraft, setEvalDraft] = useState({ name: "", email: "", role: "reviewer" });
  const [evalError, setEvalError] = useState<string | null>(null);

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
      setNewBlind(false);
      setPlanOpen(false);
      setView("plans");
      toast(`Created ${round.name}. Add its criteria, then assign reviewers.`);
    },
    onError: (error: Error) => toast(error.message),
  });

  const addEvaluator = useMutation({
    mutationFn: () =>
      authed<Member>(`/events/${eventId}/members`, {
        method: "POST",
        body: {
          name: evalDraft.name.trim(),
          email: evalDraft.email.trim(),
          role: evalDraft.role,
        },
      }),
    onSuccess: (member) => {
      void queryClient.invalidateQueries({ queryKey: ["members", eventId] });
      setAddingEval(false);
      setEvalDraft({ name: "", email: "", role: "reviewer" });
      setEvalError(null);
      setView("eval");
      toast(`${member.name} is on the team — a sign-in link is on its way to ${member.email}.`);
    },
    onError: (error: Error) => setEvalError(error.message),
  });

  const submitEvaluator = () => {
    if (evalDraft.name.trim() === "") return setEvalError("They need a name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(evalDraft.email.trim())) {
      return setEvalError("That does not look like an email address.");
    }
    setEvalError(null);
    return addEvaluator.mutate();
  };

  const patchRound = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      authed<Round>(`/events/${eventId}/review-rounds/${id}`, { method: "PATCH", body }),
    onSuccess: (round) => {
      refreshRounds();
      toast(`${round.name} is now ${round.is_blind ? "blind" : "open"}.`);
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

  /** The Evaluators tab is the team, not just the already-assigned. The
   *  progress endpoint only knows people with a queue, so someone added a
   *  minute ago would be invisible on the very screen that added them —
   *  merged with the member list, they appear at 0/0, "Nothing assigned". */
  const teamReviewers = (members ?? []).filter((member) => REVIEWING_ROLES.has(member.role));
  const progressByUser = new Map((progress ?? []).map((row) => [row.user_id, row]));
  const reviewers: Progress[] = [
    ...teamReviewers.map(
      (member) =>
        progressByUser.get(member.user_id) ?? {
          user_id: member.user_id,
          name: member.name,
          email: member.email,
          assigned: 0,
          completed: 0,
        },
    ),
    ...(progress ?? []).filter(
      (row) => !teamReviewers.some((member) => member.user_id === row.user_id),
    ),
  ];
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
      (reviewers.length === 0
        ? "nobody can score yet — add an evaluator"
        : `${chasing} ${chasing === 1 ? "person is" : "people are"} behind`),

    coverage: assigned === 0 ? "—" : `${Math.round((done / assigned) * 100)}%`,
    evalsFrac: `${done}/${assigned}`,
    medianScore: median === null ? "—" : median.toFixed(1),
    notStartedLine:
      reviewers.length === 0
        ? "NO EVALUATORS YET"
        : assigned === 0
          ? "NOTHING ASSIGNED YET"
          : chasing === 0
            ? "EVERYONE IS ON PACE"
            : `${chasing} ${chasing === 1 ? "PERSON IS" : "PEOPLE ARE"} BEHIND`,
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
        // A reminder goes to people with outstanding work; someone finished or
        // never assigned would get an email about nothing.
        canRemind: pace === "Behind" || pace === "Not started" || pace === "On pace",
        onNudge: () => nudge.mutate(),
      };
    }),

    evalEmpty:
      sorted.length > 0 ? null : (
        <div style={{ padding: "36px 24px", textAlign: "center" }}>
          <div
            style={{
              font: "600 14px var(--font-plex-sans),sans-serif",
              color: "var(--ik,#16232B)",
              marginBottom: 6,
            }}
          >
            Nobody can score proposals yet
          </div>
          <p
            style={{
              font: "400 12.5px/1.6 var(--font-plex-sans),sans-serif",
              color: "var(--i3,#6B7B84)",
              maxWidth: 420,
              margin: "0 auto 16px",
            }}
          >
            Evaluators are teammates who score submissions against your rubric. Add one and they get
            an email that signs them in — nothing to install, no password to set up.
          </p>
          <button type="button" style={pill} onClick={() => setAddingEval(true)}>
            + Add your first evaluator
          </button>
        </div>
      ),

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
        // Counted by the API. This used to be the assignment total, which read
        // as 520 on an event with 215 proposals — a number nothing else in the
        // product agreed with.
        subs: round.submission_count,
        evals: rows.length,
        done: finished,
        total,
        crits: plan?.criteria.length ?? 0,
        progW: total === 0 ? "0%" : `${Math.round((finished / total) * 100)}%`,
        // Opens the panel rather than spreading straight away. It used to fire
        // auto-distribute on click with two numbers hardcoded in this file and
        // shown nowhere — a write to every reviewer's queue from a button that
        // named neither what it would do nor how much.
        onAssign: () => setAssignFor(round.id),
        onNudge: () => nudge.mutate(),
        onBlind: () => patchRound.mutate({ id: round.id, body: { is_blind: !round.is_blind } }),
        onAdvance: () => advance.mutate(round.id),
        /* The screen's stated purpose is setting review up, and the rubric is
         * what review scores against — yet nothing in the product could write
         * one. It printed a criteria count and offered no way to change it. */
        /* The round card's setup slot. It is named `rubric` in the generated
         * screen and now carries both editors, rather than adding a prop to a
         * file `tools/dc2tsx.py` would overwrite. */
        rubric:
          eventId === null ? null : (
            <>
              <RubricEditor eventId={eventId} roundId={round.id} />
              <AssignmentPanel
                eventId={eventId}
                roundId={round.id}
                open={assignFor === round.id}
                onClose={() => setAssignFor(null)}
              />
            </>
          ),
      };
    }),
    newPlan: () => setPlanOpen(true),
    addEval: () => setAddingEval(true),
    plansNote:
      teamReviewers.length === 0
        ? "Nobody can score yet — add an evaluator (top right) so assignment has someone to assign to."
        : `${teamReviewers.length} people can score. Assignment balances by current load and never gives anyone their own submission.`,

    toasts: toasts.map((entry) => ({ msg: entry.msg, onX: () => dismiss(entry.id) })),
  };

  const field = {
    height: 38,
    padding: "0 12px",
    borderRadius: 9,
    border: "1px solid var(--ls)",
    background: "var(--cd)",
    color: "var(--ik)",
    font: "400 13.5px var(--font-plex-sans)",
  } as const;
  const label = { font: "600 12.5px var(--font-plex-sans)", color: "var(--ik)" } as const;
  const hint = { font: "400 11.5px/1.5 var(--font-plex-sans)", color: "var(--i4)" } as const;

  return (
    <>
      <Evaluations d={screen} />

      <SideDrawer
        open={addingEval}
        title="Add an evaluator"
        subtitle="They get an email that signs them in — no password to set up, no account ceremony. They only see this event."
        onClose={() => setAddingEval(false)}
        footer={
          <>
            <button type="button" style={quietPill} onClick={() => setAddingEval(false)}>
              Cancel
            </button>
            <button
              type="button"
              style={{ ...pill, opacity: addEvaluator.isPending ? 0.6 : 1 }}
              disabled={addEvaluator.isPending}
              onClick={submitEvaluator}
            >
              {addEvaluator.isPending ? "Adding…" : "Add & send sign-in link"}
            </button>
          </>
        }
      >
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="eval-name" style={label}>
              Full name
            </label>
            <input
              id="eval-name"
              value={evalDraft.name}
              onChange={(event) =>
                setEvalDraft((current) => ({ ...current, name: event.target.value }))
              }
              style={field}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="eval-email" style={label}>
              Email
            </label>
            <input
              id="eval-email"
              type="email"
              value={evalDraft.email}
              onChange={(event) =>
                setEvalDraft((current) => ({ ...current, email: event.target.value }))
              }
              style={field}
            />
            <span style={hint}>Their sign-in link goes here.</span>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <span style={label}>What can they do?</span>
            {(
              [
                {
                  value: "reviewer",
                  name: "Reviewer",
                  blurb:
                    "Scores the proposals assigned to them, from a focused queue. Cannot decide, publish or email anyone.",
                },
                {
                  value: "coordinator",
                  name: "Coordinator",
                  blurb:
                    "Day-to-day programme work — agenda, tasks, editing submissions. Cannot publish or send.",
                },
                {
                  value: "admin",
                  name: "Admin",
                  blurb: "Everything except owning the workspace: decides, publishes, sends.",
                },
              ] as const
            ).map((choice) => (
              <label
                key={choice.value}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border:
                    evalDraft.role === choice.value
                      ? "1px solid var(--sg,#E04E4E)"
                      : "1px solid var(--ln)",
                  background: evalDraft.role === choice.value ? "var(--sw,#FFEAE6)" : "var(--cd)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="eval-role"
                  checked={evalDraft.role === choice.value}
                  onChange={() => setEvalDraft((current) => ({ ...current, role: choice.value }))}
                  style={{ marginTop: 3, accentColor: "var(--sg,#E04E4E)" }}
                />
                <span>
                  <span style={{ ...label, display: "block" }}>{choice.name}</span>
                  <span style={hint}>{choice.blurb}</span>
                </span>
              </label>
            ))}
          </div>
          {evalError === null ? null : (
            <p
              role="alert"
              style={{ font: "500 12.5px var(--font-plex-sans)", color: "var(--cn)", margin: 0 }}
            >
              {evalError}
            </p>
          )}
        </div>
      </SideDrawer>

      <SideDrawer
        open={planOpen}
        title="New review round"
        subtitle="A round is one pass over the submissions: its own rubric, its own reviewers, its own deadline. Most events need just one; add a second for shortlisting."
        onClose={() => setPlanOpen(false)}
        footer={
          <>
            <button type="button" style={quietPill} onClick={() => setPlanOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              style={{ ...pill, opacity: createRound.isPending ? 0.6 : 1 }}
              disabled={createRound.isPending}
              onClick={() => {
                const name = newName.trim();
                if (name === "") {
                  toast("Give the round a name first.");
                  return;
                }
                createRound.mutate({ name, is_blind: newBlind });
              }}
            >
              {createRound.isPending ? "Creating…" : "Create round"}
            </button>
          </>
        }
      >
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="round-name" style={label}>
              Round name
            </label>
            <input
              id="round-name"
              value={newName}
              placeholder="Round 1 · First pass"
              onChange={(event) => setNewName(event.target.value)}
              style={field}
            />
            <span style={hint}>Reviewers see this name at the top of their queue.</span>
          </div>
          <label
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "10px 12px",
              borderRadius: 10,
              border: newBlind ? "1px solid var(--sg,#E04E4E)" : "1px solid var(--ln)",
              background: newBlind ? "var(--sw,#FFEAE6)" : "var(--cd)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={newBlind}
              onChange={() => setNewBlind((on) => !on)}
              style={{ marginTop: 3, accentColor: "var(--sg,#E04E4E)" }}
            />
            <span>
              <span style={{ ...label, display: "block" }}>Blind review</span>
              <span style={hint}>
                Reviewers score without seeing who submitted — names and any answer marked
                identity-bearing are hidden from them, enforced by the server. You can switch this
                later.
              </span>
            </span>
          </label>
          <p style={{ ...hint, margin: 0 }}>
            After creating it: add scoring criteria on the round&apos;s card, then Assign reviewers
            to hand out the queue.
          </p>
        </div>
      </SideDrawer>
    </>
  );
}
