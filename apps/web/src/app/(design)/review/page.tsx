"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

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

const TRACK_HUES = ["#3E8896", "#A85788", "#5A6BA8", "#7E5CB8", "#C4703A", "#34526B"];

function answer(subject: Subject | undefined, key: string): string {
  const value = subject?.answers[key];
  return typeof value === "string" ? value : "";
}

/** The reviewer's queue: one proposal at a time, scored against the round's
 *  rubric. Blind rounds arrive already stripped of identity by the API, so
 *  there is nothing to hide here. */
export default function ReviewPage() {
  const { chrome, toasts, dismiss, toast } = useConsoleChrome();
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

  const save = useMutation({
    mutationFn: async (submissionId: string) =>
      authed(`/events/${eventId}/review/submissions/${submissionId}/scores?round_id=${round?.id}`, {
        method: "PUT",
        body: {
          values: scores[submissionId] ?? {},
          comment: comments[submissionId] ?? null,
          conflict_of_interest: false,
        },
      }),
    onSuccess: () => {
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

  const given = current === undefined ? {} : (scores[current.submission_id] ?? {});
  const hue = TRACK_HUES[0]!;

  const screen: ReviewData = {
    ...chrome,

    // Blind review is enforced by the API, which strips identity before it
    // reaches here; the banner reports what the round actually is.
    blindLabel:
      subject?.is_blind === true
        ? "BLIND REVIEW ON · SPEAKER DETAILS HIDDEN"
        : `${round?.name ?? "Review"} · OPEN`,
    speakerLine:
      subject?.is_blind === true
        ? "Hidden by blind review"
        : (firstSpeakerName(subject) ?? "—"),
    closesLine:
      round?.closes_at == null ? "no close date set" : `round closes ${DAY.format(new Date(round.closes_at))}`,

    working: !finished && queue.length > 0,
    done: finished || queue.length === 0,
    pos:
      queue.length === 0
        ? "Nothing assigned to you yet"
        : `${Math.min(index + 1, queue.length)} of ${queue.length} in your queue`,
    progress: `${scoredCount} of ${queue.length} reviewed`,
    progW: queue.length === 0 ? "0%" : `${Math.round((scoredCount / queue.length) * 100)}%`,
    doneLine: `You reviewed ${scoredCount} of ${queue.length}.`,
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
      a1: "Who is this for?",
      a1r: answer(subject, "audience_level") || "—",
      a2: "What will they leave with?",
      a2r: answer(subject, "key_takeaway") || "—",
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
