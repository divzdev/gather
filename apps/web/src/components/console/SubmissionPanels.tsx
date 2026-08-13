"use client";

/** The two halves of deciding on a proposal: the internal record, and the call.
 *
 *  Both were wireframe stubs — a 28px note input and three 30px pills that fired
 *  a decision on a single click with nowhere to say why. An organiser works this
 *  screen 214 times and defends the outcome months later, so the note composer
 *  is sized for a considered sentence and no decision is recorded without the
 *  chance to explain it.
 *
 *  These own their own draft state deliberately: the generated console markup
 *  passes props through a single `d` object, and threading six more fields
 *  through it to hold a textarea's value would spread one component's internals
 *  across two files.
 */

import { useState } from "react";

export type Outcome = "accepted" | "waitlisted" | "rejected";

export type Note = {
  id: string;
  body: string;
  author_name: string;
  created_at: string;
  /** Present when this note is the rationale recorded with a decision. */
  decision_outcome: Outcome | null;
};

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const OUTCOME: Record<
  Outcome,
  { label: string; verb: string; fg: string; bg: string; bd: string }
> = {
  accepted: {
    label: "Accept",
    verb: "Accepted",
    fg: "var(--ok,#0E7A5F)",
    bg: "var(--okw,#E2F1EC)",
    bd: "var(--okl,#C2E0D5)",
  },
  waitlisted: {
    label: "Waitlist",
    verb: "Waitlisted",
    fg: "var(--pd,#B96A1F)",
    bg: "var(--pdw,#F9EDDF)",
    bd: "var(--pdl,#EFD3B6)",
  },
  rejected: {
    label: "Reject",
    verb: "Rejected",
    fg: "var(--cn,#D8432B)",
    bg: "var(--cnw,#FBE8E6)",
    bd: "var(--cnl,#F3C7C2)",
  },
};

const LABEL = {
  font: "600 10px 'IBM Plex Sans Condensed',sans-serif",
  letterSpacing: "0.08em",
  color: "var(--i4,#99A6AD)",
} as const;

/* ─────────────────────────────  internal notes  ───────────────────────────── */

export function NotesPanel({
  notes,
  onAdd,
  busy,
}: {
  notes: readonly Note[];
  onAdd: (body: string) => Promise<unknown>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState(false);

  const post = async () => {
    const body = draft.trim();
    if (body === "" || busy) return;
    try {
      await onAdd(body);
      setDraft("");
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <section style={{ marginBottom: "22px" }}>
      <div style={{ ...LABEL, marginBottom: "8px" }}>INTERNAL NOTES</div>

      {/* The confidentiality rule is the first thing you read, and it is a
       *  statement rather than a warning — nothing has gone wrong. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "7px",
          padding: "7px 11px",
          borderRadius: "7px 7px 0 0",
          border: "1px solid var(--ln,#E1E7E9)",
          borderBottom: "none",
          background: "var(--sk,#EDF1F2)",
        }}
      >
        <LockGlyph />
        <span
          style={{
            font: "500 11px 'IBM Plex Sans',sans-serif",
            color: "var(--i3,#6B7B84)",
          }}
        >
          Organizers and reviewers only. A speaker never sees this.
        </span>
      </div>

      <div
        style={{
          border: "1px solid var(--ln,#E1E7E9)",
          borderRadius: "0 0 7px 7px",
          background: "var(--cd,#FFFFFF)",
          overflow: "hidden",
        }}
      >
        {notes.length > 0 ? (
          <ol style={{ listStyle: "none", margin: "0", padding: "0" }}>
            {notes.map((note) => (
              <li
                key={note.id}
                style={{
                  padding: "11px 13px",
                  borderBottom: "1px solid var(--ln,#E1E7E9)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "8px",
                    flexWrap: "wrap",
                    marginBottom: "3px",
                  }}
                >
                  <span
                    style={{
                      font: "600 12px 'IBM Plex Sans',sans-serif",
                      color: "var(--ik,#16232B)",
                    }}
                  >
                    {note.author_name}
                  </span>
                  {note.decision_outcome === null ? null : (
                    <span
                      style={{
                        font: "500 9.5px 'IBM Plex Mono',monospace",
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        padding: "1px 6px",
                        borderRadius: "3px",
                        background: OUTCOME[note.decision_outcome].bg,
                        color: OUTCOME[note.decision_outcome].fg,
                      }}
                    >
                      {OUTCOME[note.decision_outcome].verb}
                    </span>
                  )}
                  <span
                    style={{
                      font: "400 10.5px 'IBM Plex Mono',monospace",
                      color: "var(--i4,#99A6AD)",
                    }}
                  >
                    {WHEN.format(new Date(note.created_at))}
                  </span>
                </div>
                <p
                  style={{
                    font: "400 12.5px/19px 'IBM Plex Sans',sans-serif",
                    color: "var(--i2,#3E4E58)",
                    margin: "0",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {note.body}
                </p>
              </li>
            ))}
          </ol>
        ) : null}

        {failed ? (
          <p
            role="alert"
            style={{
              font: "500 11.5px 'IBM Plex Sans',sans-serif",
              color: "var(--cn,#D8432B)",
              background: "var(--cnw,#FBE8E6)",
              margin: "0",
              padding: "7px 13px",
            }}
          >
            That didn&rsquo;t save. Your note is still here &mdash; try again.
          </p>
        ) : null}

        <div style={{ padding: "10px 13px" }}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void post();
            }}
            rows={3}
            aria-label="Add an internal note"
            placeholder="Why this scored the way it did, who followed up, what to check before deciding…"
            style={{
              width: "100%",
              minHeight: "62px",
              resize: "vertical",
              padding: "9px 11px",
              borderRadius: "7px",
              border: "1px solid var(--ls,#C8D2D5)",
              background: "var(--pp,#F4F6F7)",
              color: "var(--ik,#16232B)",
              font: "400 12.5px/19px 'IBM Plex Sans',sans-serif",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginTop: "8px",
            }}
          >
            <span
              style={{
                font: "400 10.5px 'IBM Plex Mono',monospace",
                color: "var(--i4,#99A6AD)",
              }}
            >
              ⌘⏎ to post
            </span>
            <span style={{ flex: "1" }} />
            <button
              type="button"
              onClick={() => void post()}
              disabled={draft.trim() === "" || busy}
              style={{
                height: "32px",
                padding: "0 15px",
                borderRadius: "7px",
                border: "none",
                background: draft.trim() === "" ? "var(--sk,#EDF1F2)" : "var(--ik,#16232B)",
                color: draft.trim() === "" ? "var(--i4,#99A6AD)" : "var(--cd,#FFFFFF)",
                font: "600 12px 'IBM Plex Sans',sans-serif",
              }}
            >
              {busy ? "Saving…" : "Add note"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────  decision  ──────────────────────────────── */

export function DecisionBar({
  current,
  onDecide,
  busy,
  onPromote,
  promoted,
}: {
  current: Outcome | null;
  onDecide: (outcome: Outcome, reason: string) => Promise<unknown>;
  busy: boolean;
  /** Accepting does not create a session — promotion is its own step, and
   *  until now the API's promote endpoint had no button anywhere in the
   *  console. Only offered on an accepted submission. */
  onPromote?: (() => void) | null;
  promoted?: boolean;
}) {
  const [picked, setPicked] = useState<Outcome | null>(null);
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState(false);

  const cancel = () => {
    setPicked(null);
    setReason("");
    setFailed(false);
  };

  const confirm = async () => {
    if (picked === null || busy) return;
    try {
      await onDecide(picked, reason.trim());
      cancel();
    } catch {
      setFailed(true);
    }
  };

  if (picked !== null) {
    const look = OUTCOME[picked];
    // Rejecting and waitlisting are the ones somebody asks about later, and the
    // ones a speaker will push back on. Accepting rarely needs defending.
    const required = picked !== "accepted";
    const ready = !required || reason.trim() !== "";

    return (
      <div
        style={{
          borderTop: `2px solid ${look.fg}`,
          background: "var(--cd,#FFFFFF)",
          padding: "13px 18px 15px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "9px",
            marginBottom: "9px",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              font: "600 12.5px 'IBM Plex Sans',sans-serif",
              color: look.fg,
            }}
          >
            {look.verb}
          </span>
          <span
            style={{
              font: "400 12px 'IBM Plex Sans',sans-serif",
              color: "var(--i3,#6B7B84)",
            }}
          >
            {required
              ? "Say why. This is recorded internally, not sent to the speaker."
              : "Add a note if it helps. Recorded internally, not sent to the speaker."}
          </span>
        </div>

        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") cancel();
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && ready) void confirm();
          }}
          autoFocus
          rows={2}
          aria-label={`Why this proposal is being ${look.verb.toLowerCase()}`}
          placeholder={
            picked === "rejected"
              ? "Overlaps three stronger CI talks; reviewers split on the depth."
              : picked === "waitlisted"
                ? "Strong, but the track is full. Revisit if a slot frees up."
                : "Anything the programme team should know."
          }
          style={{
            width: "100%",
            minHeight: "54px",
            resize: "vertical",
            padding: "9px 11px",
            borderRadius: "7px",
            border: `1px solid ${look.bd}`,
            background: "var(--pp,#F4F6F7)",
            color: "var(--ik,#16232B)",
            font: "400 12.5px/19px 'IBM Plex Sans',sans-serif",
          }}
        />

        {failed ? (
          <p
            role="alert"
            style={{
              font: "500 11.5px 'IBM Plex Sans',sans-serif",
              color: "var(--cn,#D8432B)",
              margin: "8px 0 0",
            }}
          >
            That didn&rsquo;t save. Nothing was recorded &mdash; try again.
          </p>
        ) : null}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "9px",
            marginTop: "9px",
          }}
        >
          <span
            style={{
              font: "400 11px 'IBM Plex Sans',sans-serif",
              color: "var(--i4,#99A6AD)",
            }}
          >
            Queues an email. Nothing sends until you send it from Messages.
          </span>
          <span style={{ flex: "1" }} />
          <button
            type="button"
            onClick={cancel}
            style={{
              height: "34px",
              padding: "0 14px",
              borderRadius: "8px",
              border: "1px solid var(--ls,#C8D2D5)",
              background: "none",
              font: "500 12.5px 'IBM Plex Sans',sans-serif",
              color: "var(--i2,#3E4E58)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!ready || busy}
            style={{
              height: "34px",
              padding: "0 17px",
              borderRadius: "8px",
              border: "none",
              background: ready ? look.fg : "var(--sk,#EDF1F2)",
              color: ready ? "var(--cd,#FFFFFF)" : "var(--i4,#99A6AD)",
              font: "600 12.5px 'IBM Plex Sans',sans-serif",
            }}
          >
            {busy ? "Recording…" : `Record ${look.verb.toLowerCase()}`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "9px",
        flexWrap: "wrap",
        borderTop: "1px solid var(--ln,#E1E7E9)",
        background: "var(--cd,#FFFFFF)",
        padding: "13px 18px",
      }}
    >
      <span style={{ ...LABEL, marginRight: "2px" }}>DECISION</span>
      {(["accepted", "waitlisted", "rejected"] as const).map((outcome) => {
        const look = OUTCOME[outcome];
        const active = current === outcome;
        return (
          <button
            key={outcome}
            type="button"
            onClick={() => setPicked(outcome)}
            aria-pressed={active}
            style={{
              height: "36px",
              padding: "0 16px",
              borderRadius: "8px",
              border: `1px solid ${active ? look.fg : look.bd}`,
              background: active ? look.bg : "transparent",
              color: look.fg,
              font: `${active ? "600" : "500"} 13px 'IBM Plex Sans',sans-serif`,
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
            }}
          >
            {active ? <TickGlyph /> : null}
            {look.label}
            <kbd
              style={{
                font: "500 10px 'IBM Plex Mono',monospace",
                opacity: 0.6,
                border: "none",
                background: "none",
              }}
            >
              {outcome[0]}
            </kbd>
          </button>
        );
      })}
      <span style={{ flex: "1" }} />
      {current === "accepted" && onPromote != null ? (
        promoted === true ? (
          <span
            style={{
              font: "500 11.5px 'IBM Plex Sans',sans-serif",
              color: "var(--ok,#0E7A5F)",
            }}
          >
            Already a session — it&apos;s on the Sessions screen.
          </span>
        ) : (
          <button
            type="button"
            onClick={onPromote}
            disabled={busy}
            style={{
              height: "36px",
              padding: "0 16px",
              borderRadius: "8px",
              border: "1px solid var(--okl,#BFE0D6)",
              background: "var(--okw,#E2F1EC)",
              color: "var(--ok,#0E7A5F)",
              font: "600 13px 'IBM Plex Sans',sans-serif",
            }}
          >
            Make it a session
          </button>
        )
      ) : null}
      <span
        style={{
          font: "400 11.5px 'IBM Plex Sans',sans-serif",
          color: "var(--i4,#99A6AD)",
        }}
      >
        {current === null
          ? "No decision recorded yet."
          : `${OUTCOME[current].verb} — queued, not sent.`}
      </span>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="2.5" y="6" width="9" height="6.5" rx="1.5" fill="var(--i3,#6B7B84)" />
      <path
        d="M4.5 6V4.3a2.5 2.5 0 0 1 5 0V6"
        stroke="var(--i3,#6B7B84)"
        strokeWidth="1.3"
        fill="none"
      />
    </svg>
  );
}

function TickGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 7.4l2.6 2.6L11 4.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
