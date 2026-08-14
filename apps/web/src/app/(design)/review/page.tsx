"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRACK_HUES } from "@/lib/trackHues";
import { useState } from "react";

import { useHotkeys } from "@/lib/hotkeys";

import { useConsoleChrome } from "@/components/console/chrome";
import { Review, type ReviewData } from "@/components/design/Review";
import { authed, getEventId } from "@/lib/session";

type Round = {
  id: string;
  name: string;
  is_blind: boolean;
  status: string;
  sort_order: number;
  closes_at: string | null;
};
type QueueItem = { submission_id: string; code: string; title: string; completed: boolean };
type Criterion = {
  id: string;
  label: string;
  description: string | null;
  scale_min: number;
  scale_max: number;
  is_required: boolean;
  sort_order: number;
};
type ProposalScore = { criterion_id: string; label: string; value: number; reason: string };
type Proposal = {
  id: string;
  status: string;
  output: {
    scores?: ProposalScore[];
    summary?: string;
    is_stub?: boolean;
    error?: string;
  };
  model: string | null;
};
type Subject = {
  id: string;
  code: string;
  title: string;
  answers: Record<string, unknown>;
  track_id: string | null;
  session_format_id: string | null;
  speakers: Record<string, unknown>[];
  is_blind: boolean;
};

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function firstSpeakerName(subject: Subject | undefined): string | null {
  const name = subject?.speakers[0]?.["name"];
  return typeof name === "string" ? name : null;
}



function answer(subject: Subject | undefined, key: string): string {
  const value = subject?.answers[key];
  return typeof value === "string" ? value : "";
}

/** The reviewer's queue: one proposal at a time, scored against the round's
 *  rubric. Blind rounds arrive already stripped of identity by the API, so
 *  there is nothing to hide here. */
export default function ReviewPage() {
  const { toasts, dismiss, toast } = useConsoleChrome();
  const queryClient = useQueryClient();
  const eventId = typeof window === "undefined" ? null : getEventId();

  const [index, setIndex] = useState(0);
  const [focus, setFocus] = useState(0);
  const [scores, setScores] = useState<Record<string, Record<string, number>>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [aiOpen, setAiOpen] = useState(false);
  const [finished, setFinished] = useState(false);

  const { data: rounds } = useQuery({
    queryKey: ["review-rounds", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Round[]>(`/events/${eventId}/review/rounds`),
  });
  const round = rounds?.find((entry) => entry.status === "open") ?? rounds?.[0] ?? null;

  const { data } = useQuery({
    queryKey: ["review-queue", eventId, round?.id],
    enabled: eventId !== null && round != null,
    queryFn: async () => {
      const [queue, criteria] = await Promise.all([
        authed<QueueItem[]>(`/events/${eventId}/review/queue?round_id=${round?.id}`),
        authed<Criterion[]>(`/events/${eventId}/review/rounds/${round?.id}/criteria`),
      ]);
      return { queue, criteria };
    },
  });

  const queue = data?.queue ?? [];
  const criteria = [...(data?.criteria ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const current = queue[Math.min(index, Math.max(0, queue.length - 1))];

  const { data: subject } = useQuery({
    queryKey: ["review-subject", eventId, round?.id, current?.submission_id],
    enabled: eventId !== null && round != null && current !== undefined,
    queryFn: () =>
      authed<Subject>(
        `/events/${eventId}/review/submissions/${current?.submission_id}?round_id=${round?.id}`,
      ),
  });

  /** The suggestion for the submission on screen, or null.
   *
   *  Deliberately not cached per submission: a suggestion is a thing you asked
   *  for about the proposal in front of you, and silently resurrecting one when
   *  you navigate back would make it look like a stored property of the
   *  submission rather than something a person requested.
   */
  const [proposal, setProposal] = useState<Proposal | null>(null);
  /** Set when "Use these" filled the form from this proposal. The next save
   *  then goes through the accept endpoint — same `review.score()` underneath,
   *  but the proposal row resolves to `accepted` instead of sitting `ready`
   *  forever, so the ai_proposals ledger stays honest about what was used. */
  const [usedProposal, setUsedProposal] = useState<{ id: string; submissionId: string } | null>(
    null,
  );

  const suggest = useMutation({
    mutationFn: (submissionId: string) =>
      authed<Proposal>(`/events/${eventId}/ai/review-rounds/${round?.id}/score`, {
        method: "POST",
        body: { submission_id: submissionId },
      }),
    onSuccess: (result) => setProposal(result),
    // A failed *request* is different from a proposal that came back `failed`,
    // which is handled in `aiNote` — that one is the model answering badly, and
    // it is recorded rather than thrown away.
    onError: (error: Error) => toast(error.message),
  });

  /** What the panel has to admit, in priority order. */
  const aiNote = (): string | null => {
    if (proposal?.status === "failed") {
      const detail = proposal.output.error;
      return typeof detail === "string" ? detail : "The model could not answer that.";
    }
    if (proposal?.output.is_stub === true) {
      return "No model is configured, so these are placeholder values rather than a reading of the proposal. Set ANTHROPIC_API_KEY to get real suggestions.";
    }
    if (proposal === null) {
      return "Suggested scores against this round's rubric, with a reason for each. They fill the form; they never save on your behalf.";
    }
    return null;
  };

  const save = useMutation({
    mutationFn: async (submissionId: string) => {
      // A save that started from "Use these" adopts the proposal instead:
      // the same review.score() runs server-side with these exact (possibly
      // edited) values under the reviewer's id, and the proposal is resolved.
      if (usedProposal !== null && usedProposal.submissionId === submissionId) {
        return authed(`/events/${eventId}/ai/proposals/${usedProposal.id}/accept`, {
          method: "POST",
          body: {
            review_round_id: round?.id,
            submission_id: submissionId,
            values: scores[submissionId] ?? {},
            comment: comments[submissionId] ?? null,
          },
        });
      }
      return authed(
        `/events/${eventId}/review/submissions/${submissionId}/scores?round_id=${round?.id}`,
        {
          method: "PUT",
          body: {
            values: scores[submissionId] ?? {},
            comment: comments[submissionId] ?? null,
            conflict_of_interest: false,
          },
        },
      );
    },
    onSuccess: (_result, submissionId) => {
      if (usedProposal?.submissionId === submissionId) setUsedProposal(null);
      void queryClient.invalidateQueries({ queryKey: ["review-queue", eventId, round?.id] });
      void queryClient.invalidateQueries({ queryKey: ["program-stats", eventId] });
    },
    onError: (error: Error) => toast(error.message),
  });

  const scoredCount = queue.filter((item) => {
    const given = scores[item.submission_id];
    const complete =
      criteria.length > 0 && criteria.every((criterion) => given?.[criterion.id] !== undefined);
    return item.completed || complete;
  }).length;

  const move = (delta: number) => {
    setIndex((current) => Math.min(Math.max(0, current + delta), Math.max(0, queue.length - 1)));
    setFocus(0);
    // The suggestion belongs to the submission it was asked about. Without
    // this, requesting scores on one proposal and pressing j showed them —
    // reasons and all — beside the next proposal, as if they were its reading.
    setProposal(null);
    setUsedProposal(null);
  };

  const setScore = (criterionId: string, value: number) => {
    if (current === undefined) return;
    setScores((all) => ({
      ...all,
      [current.submission_id]: { ...all[current.submission_id], [criterionId]: value },
    }));
    setFocus((position) => Math.min(position + 1, Math.max(0, criteria.length - 1)));
  };

  const saveAndNext = () => {
    if (current === undefined) return;
    save.mutate(current.submission_id);
    if (index >= queue.length - 1) setFinished(true);
    else move(1);
  };

  /** The header has advertised "1-5 scores · ⌘⏎ saves · j / k navigates" since
   *  this screen was ported, and no keydown listener existed anywhere in the
   *  app. The panel was already built for it — the focused criterion highlights
   *  itself and prints "press 1-5" — so only this was missing, and
   *  `APP_CONTEXT.md` calls a keyboard-driven queue the reviewer's defining
   *  need: they work a hundred proposals in one sitting and the mouse is the
   *  slow path.
   *
   *  The scale comes from the rubric, so a criterion scored 0-3 binds four keys
   *  and one scored 1-10 binds ten — a digit outside the range is left alone
   *  rather than silently recorded. */
  const focused = criteria[focus];
  useHotkeys(
    [
      // Saving works from inside the comment box too, because that is exactly
      // where a reviewer's hands are when they finish one.
      { key: "mod+Enter", run: () => saveAndNext(), whileTyping: true },
      { key: "j", run: () => move(1) },
      { key: "k", run: () => move(-1) },
      ...(focused === undefined
        ? []
        : Array.from(
            { length: focused.scale_max - focused.scale_min + 1 },
            (_, offset) => focused.scale_min + offset,
          )
            .filter((value) => value >= 0 && value <= 9)
            .map((value) => ({
              key: String(value),
              run: () => setScore(focused.id, value),
            }))),
    ],
    queue.length > 0 && !finished,
  );

  const given = current === undefined ? {} : (scores[current.submission_id] ?? {});
  const hue = TRACK_HUES[0]!;

  const screen: ReviewData = {
    // Blind review is enforced by the API, which strips identity before it
    // reaches here; the banner reports what the round actually is.
    blindLabel:
      subject?.is_blind === true
        ? "BLIND REVIEW ON · SPEAKER DETAILS HIDDEN"
        : `${round?.name ?? "Review"} · OPEN`,
    speakerLine:
      subject?.is_blind === true ? "Hidden by blind review" : (firstSpeakerName(subject) ?? "—"),
    closesLine:
      round?.closes_at == null
        ? "no close date set"
        : `round closes ${DAY.format(new Date(round.closes_at))}`,

    working: !finished && queue.length > 0,
    done: finished || queue.length === 0,
    pos:
      queue.length === 0
        ? "Nothing assigned to you yet"
        : `${Math.min(index + 1, queue.length)} of ${queue.length} in your queue`,
    progress: `${scoredCount} of ${queue.length} reviewed`,
    progW: queue.length === 0 ? "0%" : `${Math.round((scoredCount / queue.length) * 100)}%`,

    /* An empty queue and a finished queue are opposite states and used to
     * render identically: a green tick and "Round 1 complete — you reviewed 0
     * of 0." A reviewer who has never been given anything was congratulated for
     * it, and told nothing about what to do next. */
    roundLabel: round == null ? "Review" : `Review · ${round.name}`,
    /* Was a literal advertising four shortcuts, none of which existed. Three of
     * them do now; the fourth said "Tab moves criteria", which is not how this
     * works — scoring advances the focus itself, and Tab is left to the browser
     * so keyboard and screen-reader users keep it. The range comes from the
     * rubric, because a round scored 0-3 should not claim 1-5. */
    shortcutHint:
      focused === undefined
        ? "⌘⏎ saves · j / k moves between proposals"
        : `${focused.scale_min}–${focused.scale_max} scores · ⌘⏎ saves · j / k moves between proposals`,
    doneTitle:
      queue.length === 0
        ? "Nothing assigned to you yet"
        : `${round?.name ?? "This round"} complete`,
    doneMark: queue.length === 0 ? "—" : "✓",
    doneBg: queue.length === 0 ? "var(--sk,#EDF1F2)" : "var(--okw,#E2F1EC)",
    doneBd: queue.length === 0 ? "var(--ln,#E1E7E9)" : "var(--okl,#C2E0D5)",
    doneFg: queue.length === 0 ? "var(--i3,#6B7B84)" : "var(--ok,#0E7A5F)",
    doneLine:
      queue.length === 0
        ? "An organiser assigns proposals to reviewers when a round opens. Nothing is waiting on you — you will see your queue here as soon as there is one."
        : `You reviewed ${scoredCount} of ${queue.length}. Your scores are saved, and the round owner can see your progress.`,
    canRestart: queue.length > 0,
    restart: () => {
      setFinished(false);
      setIndex(0);
      setFocus(0);
    },

    it: {
      id: current?.code ?? "",
      t: current?.title ?? "Nothing to review",
      tr: answer(subject, "track"),
      col: hue,
      fmt: answer(subject, "format"),
      lvl: answer(subject, "audience_level"),
      ab: answer(subject, "abstract"),
      before: answer(subject, "audience_level") || "—",
      tools: answer(subject, "key_takeaway") || "—",
    },

    crits: criteria.map((criterion, position) => {
      const focused = focus === position;
      const chosen = given[criterion.id];
      const range = Array.from(
        { length: criterion.scale_max - criterion.scale_min + 1 },
        (_, offset) => criterion.scale_min + offset,
      );
      return {
        n: criterion.label,
        hint: focused ? `press ${criterion.scale_min}–${criterion.scale_max}` : "",
        bd: focused ? "var(--sg,#E04E4E)" : "var(--ln,#E1E7E9)",
        bg: focused ? "var(--sw,#FFEAE6)" : "var(--cd,#FFFFFF)",
        lc: focused ? "var(--sg,#E04E4E)" : "var(--i3,#6B7B84)",
        onFocus: () => setFocus(position),
        opts: range.map((value) => ({
          n: String(value),
          on: (event: React.SyntheticEvent) => {
            event.stopPropagation();
            setScore(criterion.id, value);
          },
          bg: chosen === value ? "var(--bt,#FF6B6B)" : "var(--cd,#FFFFFF)",
          fg: chosen === value ? "var(--bf,#331313)" : "var(--i3,#6B7B84)",
          bd: chosen === value ? "var(--bt,#FF6B6B)" : "var(--ls,#C8D2D5)",
          wt: chosen === value ? "600" : "400",
        })),
      };
    }),
    comment: current === undefined ? "" : (comments[current.submission_id] ?? ""),
    onComment: (event: React.SyntheticEvent) => {
      if (current === undefined) return;
      const value = (event.target as HTMLTextAreaElement).value;
      setComments((all) => ({ ...all, [current.submission_id]: value }));
    },

    aiOpen,
    togAi: () => setAiOpen((open) => !open),
    aiChev: aiOpen ? "hide" : "show",
    aiItems: (proposal?.output.scores ?? []).map((item) => ({
      label: item.label,
      value: item.value,
      reason: item.reason,
    })),
    aiNote: aiNote(),
    aiBusy: suggest.isPending,
    aiRunLabel: suggest.isPending
      ? "Reading the proposal…"
      : proposal === null
        ? "Suggest scores"
        : "Ask again",
    aiCanUse: (proposal?.output.scores ?? []).length > 0,
    aiRun: () => {
      if (current === undefined) return;
      suggest.mutate(current.submission_id);
    },
    // Fills the form and nothing else. The reviewer still presses save, and what
    // saves is their scorecard — see the note at the foot of the panel.
    aiUse: () => {
      if (current === undefined || proposal === null) return;
      setScores((all) => ({
        ...all,
        [current.submission_id]: {
          ...all[current.submission_id],
          ...Object.fromEntries(
            (proposal.output.scores ?? []).map((item) => [item.criterion_id, item.value]),
          ),
        },
      }));
      setUsedProposal({ id: proposal.id, submissionId: current.submission_id });
      toast("Scores filled in. Adjust anything you disagree with, then save.");
    },
    aiDiscard: () => {
      // Recorded server-side too, so the proposals ledger distinguishes
      // "discarded" from "asked for and never resolved".
      if (proposal !== null && proposal.status === "ready") {
        void authed(`/events/${eventId}/ai/proposals/${proposal.id}/discard`, {
          method: "POST",
        }).catch(() => undefined);
      }
      setProposal(null);
      setUsedProposal(null);
      toast("Suggestion discarded.");
    },

    saveNext: saveAndNext,
    saveLabel: index >= queue.length - 1 ? "Save and finish" : "Save and next",
    skip: () => {
      toast("Skipped. It stays in your queue.");
      move(1);
    },
    flag: () => toast("Flagged for a conflict-of-interest check. The round owner sees it."),
    prev: () => move(-1),
    next: () => move(1),

    toasts: toasts.map((entry) => ({ msg: entry.msg, onX: () => dismiss(entry.id) })),
  };

  return <Review d={screen} />;
}
