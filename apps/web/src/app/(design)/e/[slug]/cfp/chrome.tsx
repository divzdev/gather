"use client";

/** Everything around the questions: the page frame, the header, the step rail,
 *  and the four states the wizard is not in — loading, unreachable, closed,
 *  and submitted.
 *
 *  The screen keeps `data-screen-label="Public CFP wizard"`, which pins the
 *  light token map (see `styles/tokens.css`). Public pages are light by
 *  decision, not by accident.
 */

import Link from "next/link";

import { button } from "./fields";

export const CFP_CSS = `
.cfp-control:focus-visible{outline:2px solid var(--sg);outline-offset:2px;border-radius:10px}
.cfp-control::placeholder{color:var(--i4)}
.cfp-shell{display:grid;grid-template-columns:212px minmax(0,1fr);gap:44px;align-items:start}
.cfp-rail{position:sticky;top:26px}
.cfp-summary{display:grid;grid-template-columns:150px minmax(0,1fr);gap:16px;align-items:baseline}
/* Geometry stays in the sheet, never inline: an inline display wins over a
   media query, which is how the phone progress bar once showed on a desktop. */
.cfp-wide{display:grid;gap:2px}
.cfp-narrow{display:none;gap:8px}
@media (max-width:820px){
  .cfp-shell{grid-template-columns:minmax(0,1fr);gap:26px}
  .cfp-rail{position:static}
  .cfp-wide{display:none}
  .cfp-narrow{display:grid}
  .cfp-summary{grid-template-columns:minmax(0,1fr);gap:4px}
}
`;

type FormInfo = {
  event_name: string;
  event_slug: string;
  closes_at: string | null;
  event_timezone: string;
  submission_limit_per_speaker: number | null;
  is_open: boolean;
  closed_reason: string | null;
};

type Save =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "failed"; message: string };

/** An instant means nothing without the zone it is read in, so both are shown.
 *
 *  The abbreviation comes from a second, US-English formatter purely because
 *  that is the locale that renders "PDT" — en-GB gives "GMT-7", which is
 *  correct and unrecognisable, and its `shortGeneric` gives "Los Angeles Time". */
function deadline(iso: string, zone: string): string {
  const when = new Date(iso);
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zone,
  }).format(when);
  const abbreviation = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(when)
    .find((part) => part.type === "timeZoneName")?.value;
  return abbreviation === undefined ? date : `${date} ${abbreviation}`;
}

function remaining(iso: string): string | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return `${days} days left`;
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `${hours} hours left` : "Closing within the hour";
}

const page: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--pp)",
  color: "var(--ik)",
};
const wrap: React.CSSProperties = { maxWidth: 1000, margin: "0 auto", padding: "34px 24px 96px" };

function Header({ form, slug }: { form: FormInfo | undefined; slug: string }) {
  const closes = form?.closes_at ?? null;
  const left = closes === null ? null : remaining(closes);
  return (
    <div style={{ borderBottom: "1px solid var(--ln)", background: "var(--cd)" }}>
      <div
        style={{
          maxWidth: 1000,
          margin: "0 auto",
          padding: "0 24px",
          minHeight: 64,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
          <rect width="24" height="24" rx="6.5" fill="#12142E" />
          <circle cx="14.7" cy="14.7" r="5.7" fill="#FF6B6B" />
          <circle cx="6.3" cy="6.3" r="2.3" fill="#EBEDF7" />
          <circle cx="14.4" cy="5.4" r="1.5" fill="#EBEDF7" />
          <circle cx="5.4" cy="14.4" r="1.5" fill="#EBEDF7" />
        </svg>
        <Link
          href={`/e/${form?.event_slug ?? slug}`}
          style={{
            font: "700 16px var(--font-bricolage), sans-serif",
            letterSpacing: "-0.01em",
            color: "var(--ik)",
            textDecoration: "none",
          }}
        >
          {form?.event_name ?? "Call for papers"}
        </Link>
        <div style={{ flex: 1 }} />
        {closes !== null && (
          <span
            className="tabular"
            style={{
              font: "400 12.5px var(--font-plex-mono), monospace",
              color: left === null ? "var(--cn)" : "var(--i3)",
            }}
          >
            {left === null ? "Closed" : left}
          </span>
        )}
      </div>
    </div>
  );
}

export function Rail({
  steps,
  step,
  onStep,
  save,
  onRetrySave,
  resumed,
}: {
  steps: string[];
  step: number;
  onStep: (step: number) => void;
  save: Save;
  onRetrySave: () => void;
  resumed: string | null;
}) {
  const state = (() => {
    if (save.kind === "saving") return { text: "Saving…", tone: "var(--i3)" };
    if (save.kind === "saved") return { text: `Saved ${save.at}`, tone: "var(--ok)" };
    if (save.kind === "failed") return { text: `Not saved — ${save.message}`, tone: "var(--cn)" };
    return { text: "Not saved yet", tone: "var(--i3)" };
  })();

  return (
    <div className="cfp-rail">
      <div className="cfp-wide">
        {steps.map((label, index) => {
          const position = index + 1;
          const active = position === step;
          const complete = position < step;
          return (
            <button
              key={label}
              type="button"
              className="cfp-control"
              onClick={() => onStep(position)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                minHeight: 40,
                padding: "0 10px",
                borderRadius: 9,
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                background: active ? "var(--sw)" : "transparent",
                font: `${active ? 600 : 400} 13.5px var(--font-plex-sans)`,
                color: active ? "var(--sg)" : complete ? "var(--i2)" : "var(--i3)",
              }}
            >
              <span
                aria-hidden
                style={{
                  flex: "none",
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  display: "grid",
                  placeItems: "center",
                  font: "600 11px var(--font-plex-sans)",
                  background: active ? "var(--bt)" : complete ? "var(--ok)" : "transparent",
                  color: active || complete ? "#FFFFFF" : "var(--i3)",
                  border: active || complete ? "none" : "1px solid var(--ls)",
                }}
              >
                {complete ? "✓" : position}
              </span>
              {label}
            </button>
          );
        })}
      </div>

      {/* A phone gets a bar and a name, not four tabs it has to scroll. */}
      <div className="cfp-narrow">
        <div style={{ height: 5, borderRadius: 999, background: "var(--sk)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${Math.round((Math.max(step, 0) / steps.length) * 100)}%`,
              background: "var(--bt)",
              transition: "width var(--dur-base) var(--ease)",
            }}
          />
        </div>
        <p
          className="tabular"
          style={{ font: "400 12.5px var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}
        >
          {step === 0 ? "Before you start" : `Step ${step} of ${steps.length} · ${steps[step - 1]}`}
        </p>
      </div>

      <div style={{ marginTop: 18, display: "grid", gap: 6 }}>
        <p style={{ font: "400 12px var(--font-plex-sans)", color: state.tone, margin: 0 }}>
          {state.text}
        </p>
        {save.kind === "failed" && (
          <button
            type="button"
            className="cfp-control"
            onClick={onRetrySave}
            style={{
              ...button("secondary"),
              height: 36,
              padding: "0 14px",
              font: "500 12.5px var(--font-plex-sans)",
              justifySelf: "start",
            }}
          >
            Try saving again
          </button>
        )}
        {resumed !== null && (
          <p style={{ font: "400 12px var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}>
            Picked up your draft <span className="tabular">{resumed}</span>.
          </p>
        )}
      </div>
    </div>
  );
}

export function Toasts({
  toasts,
  onClose,
}: {
  toasts: { id: string; msg: string }[];
  onClose: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: "fixed",
        left: 20,
        bottom: 20,
        display: "grid",
        gap: 10,
        zIndex: 40,
        maxWidth: 420,
      }}
    >
      {toasts.map((entry) => (
        <div
          key={entry.id}
          role="status"
          style={{
            display: "flex",
            gap: 14,
            alignItems: "center",
            padding: "13px 16px",
            borderRadius: 12,
            background: "var(--cd)",
            border: "1px solid var(--ln)",
            boxShadow: "0 10px 30px rgba(13,16,32,.14)",
            font: "400 13.5px var(--font-plex-sans)",
            color: "var(--i2)",
          }}
        >
          {entry.msg}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => onClose(entry.id)}
            style={{
              marginLeft: "auto",
              width: 36,
              height: 36,
              flex: "none",
              borderRadius: 999,
              border: "none",
              background: "none",
              cursor: "pointer",
              color: "var(--i3)",
              font: "400 15px var(--font-plex-sans)",
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 560,
        border: "1px solid var(--ln)",
        background: "var(--cd)",
        borderRadius: 16,
        padding: 32,
      }}
    >
      {children}
    </div>
  );
}

const heading: React.CSSProperties = {
  font: "700 26px/1.15 var(--font-bricolage), sans-serif",
  letterSpacing: "-0.02em",
  color: "var(--ik)",
  margin: "0 0 12px",
};
const prose: React.CSSProperties = {
  font: "400 15px/1.65 var(--font-plex-sans)",
  color: "var(--i2)",
  margin: 0,
};

export function Shell({
  css,
  form,
  slug,
  isPending,
  isError,
  onRetry,
  done,
  onAgain,
  onCopy,
  children,
}: {
  css: string;
  form: FormInfo | undefined;
  slug: string;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  done: { code: string; message: string } | null;
  onAgain: () => void;
  onCopy: (code: string) => void;
  children: React.ReactNode;
}) {
  const inner = (() => {
    if (isError)
      return (
        <Card>
          <h1 style={heading}>We cannot reach the call for papers.</h1>
          <p style={prose}>
            The server did not answer. Nothing you have typed is lost — try again in a moment.
          </p>
          <button
            type="button"
            className="cfp-control"
            onClick={onRetry}
            style={{ ...button("primary"), marginTop: 22 }}
          >
            Try again
          </button>
        </Card>
      );

    if (isPending || form === undefined)
      return (
        <div style={{ display: "grid", gap: 16, maxWidth: 560 }} aria-busy>
          <p style={{ font: "400 14px var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}>
            Loading the call for papers…
          </p>
          {[64, 220, 120].map((height, index) => (
            <div
              key={index}
              style={{ height, borderRadius: 14, background: "var(--sk)", opacity: 0.75 }}
            />
          ))}
        </div>
      );

    if (done !== null)
      return (
        <Card>
          <p
            style={{
              font: "600 11px var(--font-plex-mono), monospace",
              letterSpacing: "0.14em",
              color: "var(--ok)",
              margin: "0 0 12px",
            }}
          >
            PROPOSAL RECEIVED
          </p>
          <h1 style={heading}>Thank you — it is in.</h1>
          <p style={prose}>{done.message}</p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              margin: "24px 0",
              padding: "16px 20px",
              borderRadius: 12,
              background: "var(--sk)",
              flexWrap: "wrap",
            }}
          >
            <span
              className="tabular"
              style={{ font: "600 22px var(--font-plex-mono), monospace", color: "var(--ik)" }}
            >
              {done.code}
            </span>
            <button
              type="button"
              className="cfp-control"
              onClick={() => onCopy(done.code)}
              style={{ ...button("secondary"), marginLeft: "auto" }}
            >
              Copy code
            </button>
          </div>
          <p style={{ ...prose, font: "400 13.5px/1.6 var(--font-plex-sans)", color: "var(--i3)" }}>
            Keep that code — it is how you check this proposal&rsquo;s status. We have emailed it to
            you as well.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
            <Link
              href={`/e/${form.event_slug}/submissions/${done.code}`}
              className="cfp-control"
              style={{
                ...button("primary"),
                display: "grid",
                placeItems: "center",
                textDecoration: "none",
              }}
            >
              Check its status
            </Link>
            <button
              type="button"
              className="cfp-control"
              onClick={onAgain}
              style={button("secondary")}
            >
              Submit another
            </button>
          </div>
        </Card>
      );

    if (!form.is_open)
      return (
        <Card>
          <h1 style={heading}>Submissions are closed.</h1>
          <p style={prose}>
            {form.closed_reason ?? "This call for papers is not accepting proposals."}
          </p>
          {form.closes_at !== null && (
            <p style={{ ...prose, color: "var(--i3)", marginTop: 12 }}>
              The deadline was {deadline(form.closes_at, form.event_timezone)}.
            </p>
          )}
          <Link
            href={`/e/${form.event_slug}`}
            className="cfp-control"
            style={{
              ...button("secondary"),
              display: "inline-grid",
              placeItems: "center",
              marginTop: 22,
              textDecoration: "none",
            }}
          >
            See the event
          </Link>
        </Card>
      );

    return (
      <>
        <div
          style={{
            display: "flex",
            gap: 20,
            flexWrap: "wrap",
            padding: "13px 18px",
            borderRadius: 12,
            border: "1px solid var(--ifl)",
            background: "var(--ifw)",
            marginBottom: 30,
            font: "400 13px var(--font-plex-sans)",
            color: "var(--i2)",
          }}
        >
          {form.closes_at !== null && (
            <span>
              Closes{" "}
              <span
                className="tabular"
                style={{ font: "500 12.5px var(--font-plex-mono), monospace" }}
              >
                {deadline(form.closes_at, form.event_timezone)}
              </span>
            </span>
          )}
          {typeof form.submission_limit_per_speaker === "number" && (
            <span>
              Limit{" "}
              <span
                className="tabular"
                style={{ font: "500 12.5px var(--font-plex-mono), monospace" }}
              >
                {form.submission_limit_per_speaker} per speaker
              </span>
              , drafts included
            </span>
          )}
          <span>No account needed — your email is your identity</span>
        </div>
        {children}
      </>
    );
  })();

  return (
    <div data-screen-label="Public CFP wizard" style={page}>
      <style>{css}</style>
      <Header form={form} slug={slug} />
      <div style={wrap}>{inner}</div>
    </div>
  );
}
