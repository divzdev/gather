"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useConsoleChrome } from "@/components/console/chrome";
import { Messages, type MessagesData } from "@/components/design/Messages";
import { ApiError } from "@/lib/api";
import { authed, getEventId } from "@/lib/session";

type Recipient = {
  submission_id: string;
  code: string;
  title: string;
  outcome: string;
  name: string;
  email: string;
  subject: string;
  body: string;
};
type Preview = { total: number; by_outcome: Record<string, number>; recipients: Recipient[] };
type OutboxRow = {
  id: string;
  to_email: string;
  subject: string;
  status: string;
  created_at: string;
  error_detail: string | null;
};

const OUTCOMES = [
  { key: "accepted", label: "Accepted", fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)" },
  { key: "waitlisted", label: "Waitlisted", fg: "var(--pd,#B96A1F)", bg: "var(--pdw,#F9EDDF)" },
  { key: "rejected", label: "Rejected", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)" },
] as const;

const SENT_STATES = new Set(["sent", "delivered"]);
const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export default function MessagesPage() {
  const { toasts, toast, dismiss } = useConsoleChrome();
  const queryClient = useQueryClient();
  const eventId = typeof window === "undefined" ? null : getEventId();

  const [tab, setTab] = useState<"compose" | "outbox" | "templates">("compose");
  const [chosen, setChosen] = useState<string[]>(["accepted", "waitlisted", "rejected"]);
  const [whoOpen, setWhoOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [previewAt, setPreviewAt] = useState(0);

  const { data: preview } = useQuery({
    queryKey: ["decision-recipients", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Preview>(`/events/${eventId}/messages/decision-recipients`),
  });

  const { data: outbox } = useQuery({
    queryKey: ["outbox", eventId],
    enabled: eventId !== null,
    // Paginated: ask for a screenful, and the meta says how many there are.
    queryFn: () =>
      authed<{ data: OutboxRow[]; meta: { total: number } }>(
        `/events/${eventId}/messages/outbox?per_page=200`,
      ),
  });

  const selected = (preview?.recipients ?? []).filter((row) => chosen.includes(row.outcome));
  // Clamped rather than reset: changing the outcome filter should not silently
  // jump the preview back to the first person every time.
  const shown = selected[Math.min(previewAt, Math.max(0, selected.length - 1))];

  const send = useMutation({
    mutationFn: () =>
      authed<{ sent: number }>(`/events/${eventId}/messages/send-decisions`, {
        method: "POST",
        body: { confirm_recipient_count: selected.length, outcomes: chosen },
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["decision-recipients", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["outbox", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["program-stats", eventId] });
      setConfirmed(false);
      setTab("outbox");
      toast(`Sent to ${result.sent}. Every one is in the outbox.`);
    },
    onError: (error: Error) => {
      // The guard fired: somebody decided more while this screen was open.
      void queryClient.invalidateQueries({ queryKey: ["decision-recipients", eventId] });
      setConfirmed(false);
      toast(
        error instanceof ApiError && error.code === "RECIPIENT_COUNT_MISMATCH"
          ? `${error.message} Nothing was sent.`
          : error.message,
      );
    },
  });

  const sendable = selected.length > 0 && confirmed && !send.isPending;
  const queued = outbox?.data ?? [];
  const bounced = queued.filter((row) => row.status === "bounced" || row.status === "failed");

  const tile = (label: string, count: number, active: boolean, on: () => void) => ({
    c: count,
    on,
    bd: active ? "var(--sg,#E04E4E)" : "var(--ln,#E1E7E9)",
    ring: active ? "0 0 0 3px var(--sw,#FFEAE6)" : "0 1px 2px rgba(13,16,32,.04)",
    numFg: active ? "var(--sg,#E04E4E)" : "var(--ik,#16232B)",
  });
  const notBuilt = (what: string) => () => toast(`${what} is not built yet.`);

  const screen: MessagesData = {
    tabs: (
      [
        ["compose", "Send decisions"],
        ["outbox", "Outbox"],
        ["templates", "Templates"],
      ] as const
    ).map(([key, label]) => ({
      n: label,
      on: () => setTab(key),
      bg: tab === key ? "var(--cd,#FFFFFF)" : "none",
      fg: tab === key ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
      wt: tab === key ? "600" : "500",
      sh: tab === key ? "0 1px 2px rgba(13,16,32,.08)" : "none",
    })),
    tabCompose: tab === "compose",
    tabOutbox: tab === "outbox",
    tabTpl: tab === "templates",

    tAllM: tile("Queued", preview?.total ?? 0, tab === "compose", () => setTab("compose")),
    tQd: tile("Selected", selected.length, false, () => setTab("compose")),
    tSent: tile("Sent", queued.filter((row) => SENT_STATES.has(row.status)).length, false, () =>
      setTab("outbox"),
    ),
    tBn: tile("Bounced", bounced.length, false, () => setTab("outbox")),

    // Who is about to be emailed, by outcome. This is the number the server
    // re-checks before it sends anything.
    segs: OUTCOMES.map((outcome) => {
      const count = preview?.by_outcome[outcome.key] ?? 0;
      const on = chosen.includes(outcome.key);
      return {
        n: outcome.label,
        c: count,
        on: () => {
          setConfirmed(false);
          setChosen((current) =>
            current.includes(outcome.key)
              ? current.filter((entry) => entry !== outcome.key)
              : [...current, outcome.key],
          );
        },
        bg: on ? outcome.bg : "var(--cd,#FFFFFF)",
        fg: on ? outcome.fg : "var(--i3,#6B7B84)",
        bd: on ? outcome.fg : "var(--ls,#C8D2D5)",
        rd: on ? "✓" : "",
        rb: on ? outcome.fg : "var(--cd,#FFFFFF)",
      };
    }),
    segCount: selected.length,
    whoLabel:
      selected.length === 0
        ? "Nobody is queued"
        : `${selected.length} ${selected.length === 1 ? "person" : "people"}`,
    togWho: () => setWhoOpen((open) => !open),
    whoOpen,
    whoList: selected.map((row) => `${row.name} · ${row.email} · ${row.code}`).join("\n"),

    // The real mail for one real person, rendered by the API from the same
    // constants the send path uses. This screen used to show a placeholder and
    // an editable box whose contents were discarded, which is the worst place
    // in the product to be vague about what is about to happen.
    subj: shown?.subject ?? "Nobody is queued",
    body:
      shown === undefined
        ? "Choose an outcome above to see the message its speakers will receive."
        : shown.body,
    pvSubj: shown?.subject ?? "Nobody is queued",
    pvBody:
      shown === undefined
        ? "Choose an outcome above to see the message its speakers will receive."
        : shown.body,
    // Stepping through the queue one recipient at a time: the wording differs
    // by outcome and carries a name and a talk title, so one sample is not a
    // preview of the batch.
    vars:
      selected.length < 2
        ? []
        : [
            {
              n: `◂ ${previewAt + 1} of ${selected.length} ▸`,
              on: () => setPreviewAt((at) => (at + 1) % selected.length),
            },
          ],

    ck: confirmed ? "✓" : "",
    ckOn: confirmed,
    ckLabel:
      selected.length === 0
        ? "I have reviewed the recipient list"
        : `I have reviewed the ${selected.length} ${selected.length === 1 ? "person" : "people"} above`,
    ckBg: confirmed ? "var(--sg,#E04E4E)" : "var(--cd,#FFFFFF)",
    ckBd: confirmed ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)",
    togCk: () => setConfirmed((on) => !on),

    // Was a checkbox reading "Attach calendar invite (.ics)". It was never in
    // the send payload — `SendRequest` forbids unknown fields, so it could not
    // have been — and a decision notice is the wrong place for one anyway:
    // accepting does not create a session and creating one does not place it,
    // so at decision time there is no time to invite anyone to. The invite that
    // does exist goes out from the agenda, and now the screen says so.
    icsNote:
      "No calendar invite goes with a decision — an accepted talk has no time yet. " +
      "Invites are sent from the agenda when you publish the schedule.",

    doSend: () => {
      if (selected.length === 0) {
        toast("Nothing is queued to send.");
        return;
      }
      if (!confirmed) {
        toast(`Tick the confirmation first. This will email ${selected.length}.`);
        return;
      }
      send.mutate();
    },
    sendLabel: send.isPending ? "Sending…" : `Send to ${selected.length}`,
    sendBg: sendable ? "var(--bt,#FF6B6B)" : "var(--ls,#C8D2D5)",
    sendFg: sendable ? "var(--bf,#331313)" : "var(--i3,#6B7B84)",

    outbox: queued.map((row) => {
      const failed = row.status === "bounced" || row.status === "failed";
      return {
        to: row.to_email,
        subj: row.subject,
        st: row.status,
        at: WHEN.format(new Date(row.created_at)),
        fg: failed ? "var(--cn,#D8432B)" : "var(--i3,#6B7B84)",
        bg: failed ? "var(--cnw,#FBE8E6)" : "var(--sk,#EDF1F2)",
        canResend: failed,
        onResend: notBuilt("Resending"),
      };
    }),
    sumOut: `${queued.length} messages · ${queued.filter((row) => SENT_STATES.has(row.status)).length} away · ${bounced.length} bounced`,
    bounceN: bounced.length,
    hasBounce: bounced.length > 0,
    resendAll: notBuilt("Resending everything that bounced"),

    tpls: [],
    tplRows: [],
    tplName: "",
    pvWho:
      shown === undefined
        ? "LIVE PREVIEW"
        : `LIVE PREVIEW · AS ${shown.name.toUpperCase()} SEES IT`,
    pvTo: shown?.email ?? "nobody yet",
    // The wording is fixed per outcome, so there is no template name to quote —
    // saying which outcomes are queued is the useful sentence instead.
    sendNote: `emails, one per speaker, worded by outcome (${chosen.join(", ") || "none chosen"}).`,

    toasts: toasts.map((entry) => ({ msg: entry.msg, onX: () => dismiss(entry.id) })),
  };

  return <Messages d={screen} />;
}
