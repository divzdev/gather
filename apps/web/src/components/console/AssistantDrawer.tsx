"use client";

/** Ask a question about this event, in words.
 *
 *  Mounted by the console layout, not by a page or the rail: every screen mounts
 *  its own rail, so a mount there would unmount the drawer on navigation and
 *  take the thread with it. The whole point is looking at the agenda while
 *  asking about it.
 *
 *  The transcript lives here and nowhere else. Six turns are posted with each
 *  question so a follow-up ("what about Thursday?") resolves, and the whole
 *  thing is gone on reload. That is deliberate: no thread table, no retention
 *  policy, and no question about who can read whose transcript.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { SideDrawer } from "@/components/console/SideDrawer";
import { askStream, type AskEvent, type Turn } from "@/lib/ask";
import { getEventId } from "@/lib/session";

export const ASSISTANT_EVENT = "gather:assistant";

/** Opened from three places (header control, ⌘K palette, keyboard shortcut) and
 *  the drawer is three levels away from all of them. A window event beats a
 *  provider for one boolean and one string. */
export function openAssistant(seed?: string): void {
  window.dispatchEvent(new CustomEvent(ASSISTANT_EVENT, { detail: seed ?? "" }));
}

/** What the model was asked to look at, in words an organiser recognises from
 *  the navigation rather than the source. */
const QUERY_LABELS: Record<string, string> = {
  tasks_outstanding: "outstanding tasks",
  sessions_in_window: "the schedule",
  accepted_without_session: "accepted talks without a session",
  agenda_conflicts: "agenda conflicts",
  review_progress: "review progress",
  submissions_by: "submission counts",
  decisions_pending_send: "decisions waiting to send",
  outbox_delivery: "message delivery",
  speakers_by_status: "speaker statuses",
  event_overview: "the event details",
  files_awaiting_review: "files awaiting review",
  published_vs_draft_diff: "published vs draft schedule",
};

type Exchange = {
  /** Stable across re-renders, unlike the array index: the last exchange is
   *  re-rendered on every streamed token, and an index key makes React reuse
   *  the wrong node when an earlier one is still filling in. */
  id: string;
  question: string;
  answer: string;
  queries: string[];
  isStub: boolean;
  /** Set when the assistant asked back or declined, so those render as the
   *  assistant speaking rather than as a failed answer. */
  aside: "clarify" | "refusal" | null;
  error: string | null;
  streaming: boolean;
  /** What answered, what it cost and how long it took. Shown under the
   *  composer, because "is this even using the key I configured?" should be
   *  answerable from the screen rather than from the database. */
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  elapsedMs: number | null;
};

const SUGGESTIONS = [
  "Who still owes me a headshot?",
  "Which accepted talks have no session yet?",
  "What conflicts are on the agenda?",
  "How many submissions did we get?",
];

export function AssistantDrawer() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const eventId = typeof window === "undefined" ? null : getEventId();
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  /** Aborts the in-flight stream when the drawer closes, so a long answer
   *  nobody is reading stops costing tokens. */
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const seed = (event as CustomEvent<string>).detail;
      setOpen(true);
      if (seed) setQuestion(seed);
    };
    const onKey = (event: KeyboardEvent) => {
      // ⌘/ rather than ⌘K, which the palette owns.
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener(ASSISTANT_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(ASSISTANT_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (open) field.current?.focus();
    else inflight.current?.abort();
  }, [open]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [exchanges]);

  const send = useCallback(
    async (asked: string) => {
      const trimmed = asked.trim();
      if (trimmed === "" || busy || eventId === null) return;

      // Six turns, matching the server's own bound. Sending more would be
      // silently trimmed there, which is worse than not sending it.
      const history: Turn[] = exchanges
        .slice(-3)
        .flatMap((exchange) => [
          { role: "user" as const, content: exchange.question },
          { role: "assistant" as const, content: exchange.answer },
        ])
        .filter((turn) => turn.content !== "");

      setQuestion("");
      setBusy(true);
      setExchanges((current) => [
        ...current,
        {
          id: `${current.length}-${trimmed.slice(0, 24)}`,
          question: trimmed,
          answer: "",
          queries: [],
          isStub: false,
          aside: null,
          error: null,
          streaming: true,
          model: null,
          inputTokens: null,
          outputTokens: null,
          elapsedMs: null,
        },
      ]);

      /** Every update lands on the exchange being streamed into, which is
       *  always the last one. Takes an updater rather than a patch object so
       *  appending a token — which needs the previous value — goes through the
       *  same path as everything else. */
      const patch = (change: Partial<Exchange> | ((previous: Exchange) => Partial<Exchange>)) =>
        setExchanges((current) =>
          current.map((exchange, index) =>
            index === current.length - 1
              ? { ...exchange, ...(typeof change === "function" ? change(exchange) : change) }
              : exchange,
          ),
        );

      const controller = new AbortController();
      inflight.current = controller;
      try {
        await askStream(
          eventId,
          { question: trimmed, history },
          (event: AskEvent) => {
            // Named the moment the adapter is resolved, so the line is filled
            // in during the wait rather than only after an answer lands — and
            // on refusals, which never reach `done` at all.
            if (event.kind === "model") patch({ model: event.name });
            else if (event.kind === "queries") patch({ queries: event.names });
            else if (event.kind === "token")
              patch((previous) => ({ answer: previous.answer + event.text }));
            else if (event.kind === "clarify")
              patch({
                answer: event.question,
                aside: "clarify",
                isStub: event.isStub,
                ...event.run,
              });
            else if (event.kind === "refusal")
              patch({
                answer: event.message,
                aside: "refusal",
                isStub: event.isStub,
                ...event.run,
              });
            else if (event.kind === "done")
              patch({
                queries: event.queries,
                isStub: event.isStub,
                model: event.model,
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
                elapsedMs: event.elapsedMs,
              });
            else if (event.kind === "error") patch({ error: event.message });
          },
          controller.signal,
        );
      } catch (error) {
        // An aborted stream is the user closing the drawer, not a failure.
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          patch({ error: error instanceof Error ? error.message : "The answer was interrupted." });
        }
      } finally {
        patch({ streaming: false });
        setBusy(false);
        inflight.current = null;
      }
    },
    [busy, eventId, exchanges],
  );

  /** The last answer's provenance, as one line: which model, what the planning
   *  call cost, how long the whole thing took. Tokens are the plan's only —
   *  the streamed prose reports none — so the line says so rather than
   *  presenting half the cost as the total. */
  const last = exchanges[exchanges.length - 1];
  const lastRun =
    last === undefined || last.model === null
      ? null
      : [
          last.model,
          last.inputTokens !== null && last.outputTokens !== null
            ? `${last.inputTokens.toLocaleString()}→${last.outputTokens.toLocaleString()} tok (plan)`
            : null,
          last.elapsedMs !== null ? `${(last.elapsedMs / 1000).toFixed(1)}s` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <SideDrawer
      open={open}
      title="Ask about this event"
      subtitle="Answers come from live queries against this event. It reads; it never changes anything."
      onClose={() => setOpen(false)}
      width="min(560px, 96vw)"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
        <div
          ref={scroller}
          style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}
        >
          {exchanges.length === 0 ? <Empty onPick={(text) => void send(text)} /> : null}
          {exchanges.map((exchange) => (
            <Answer
              key={exchange.id}
              exchange={exchange}
              onRetry={() => void send(exchange.question)}
            />
          ))}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(question);
          }}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <textarea
            ref={field}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(question);
              }
            }}
            rows={2}
            placeholder="Who still owes me a headshot?"
            aria-label="Your question"
            style={{
              width: "100%",
              minHeight: 62,
              resize: "vertical",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid var(--ln,#e3e3e7)",
              background: "var(--cd,#fff)",
              color: "var(--ik,#141417)",
              font: "400 13.5px/1.55 var(--font-plex-sans),sans-serif",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                font: "400 11.5px var(--font-plex-mono),monospace",
                color: "var(--i4,#5e5e66)",
              }}
              title={lastRun ?? undefined}
            >
              {lastRun ?? "⏎ asks · ⇧⏎ new line"}
            </span>
            <button
              type="submit"
              disabled={busy || question.trim() === ""}
              style={{
                height: 40,
                padding: "0 20px",
                borderRadius: 999,
                border: "none",
                background: busy ? "var(--sk,#efeff2)" : "var(--bt,#141417)",
                color: busy ? "var(--i4,#5e5e66)" : "var(--bf,#fff)",
                font: "600 13px var(--font-plex-sans),sans-serif",
                cursor: busy || question.trim() === "" ? "not-allowed" : "pointer",
                opacity: question.trim() === "" && !busy ? 0.5 : 1,
              }}
            >
              {busy ? "Looking…" : "Ask"}
            </button>
          </div>
        </form>
      </div>
    </SideDrawer>
  );
}

function Empty({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
      <p
        style={{
          margin: 0,
          font: "400 13px/1.6 var(--font-plex-sans),sans-serif",
          color: "var(--i2,#3f3f46)",
        }}
      >
        Ask about submissions, speakers, tasks, the schedule or what is waiting to send. Every
        number in an answer comes from a query run just now, not from a model&rsquo;s memory.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            style={{
              height: 36,
              padding: "0 14px",
              borderRadius: 999,
              border: "1px solid var(--ln,#e3e3e7)",
              background: "var(--cd,#fff)",
              color: "var(--i2,#3f3f46)",
              font: "400 12.5px var(--font-plex-sans),sans-serif",
              cursor: "pointer",
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Answer({ exchange, onRetry }: { exchange: Exchange; onRetry: () => void }) {
  const looked = exchange.queries.map((name) => QUERY_LABELS[name] ?? name);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p
        style={{
          margin: 0,
          alignSelf: "flex-end",
          maxWidth: "85%",
          padding: "10px 14px",
          borderRadius: "14px 14px 4px 14px",
          background: "var(--sk,#efeff2)",
          color: "var(--ik,#141417)",
          font: "500 13px/1.5 var(--font-plex-sans),sans-serif",
        }}
      >
        {exchange.question}
      </p>

      {exchange.error !== null ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 10,
            padding: "12px 14px",
            borderRadius: 12,
            background: "var(--cnw,#fbeaee)",
            border: "1px solid var(--cnl,#f4c8d2)",
          }}
        >
          <p
            style={{
              margin: 0,
              color: "var(--cn,#b3243f)",
              font: "400 12.5px/1.55 var(--font-plex-sans),sans-serif",
            }}
          >
            {exchange.error}
          </p>
          {/* The question is right there in the transcript, so retrying costs
           *  one click rather than retyping it. */}
          <button
            type="button"
            onClick={onRetry}
            style={{
              height: 36,
              padding: "0 16px",
              borderRadius: 999,
              border: "1px solid var(--cnl,#f4c8d2)",
              background: "var(--cd,#fff)",
              color: "var(--cn,#b3243f)",
              font: "500 12.5px var(--font-plex-sans),sans-serif",
              cursor: "pointer",
            }}
          >
            Ask again
          </button>
        </div>
      ) : (
        <>
          {exchange.answer === "" && exchange.streaming ? (
            <span
              style={{
                font: "400 12.5px var(--font-plex-sans),sans-serif",
                color: "var(--i4,#5e5e66)",
              }}
            >
              {exchange.queries.length === 0 ? "Working out what to look at…" : "Reading the rows…"}
            </span>
          ) : null}
          {exchange.answer !== "" ? (
            <p
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                font: "400 13.5px/1.65 var(--font-plex-sans),sans-serif",
                color: "var(--ik,#141417)",
              }}
            >
              {exchange.answer}
            </p>
          ) : null}
          {looked.length > 0 ? (
            <span
              style={{
                font: "400 11px var(--font-plex-mono),monospace",
                letterSpacing: ".04em",
                color: "var(--i4,#5e5e66)",
              }}
            >
              Looked at {looked.join(" · ")}
            </span>
          ) : null}
          {exchange.isStub ? (
            <span
              style={{
                alignSelf: "flex-start",
                padding: "4px 10px",
                borderRadius: 999,
                background: "var(--pdw,#faf0dc)",
                border: "1px solid var(--pdl,#efdbb2)",
                color: "var(--pd,#92590a)",
                font: "500 11px var(--font-plex-sans),sans-serif",
              }}
            >
              Sample answer — no model ran
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
