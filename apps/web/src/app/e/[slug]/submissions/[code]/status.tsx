"use client";

/** A submitter's own proposal: where it stands, and how to fix it.
 *
 *  Two things had an API and no way in. Status by code has existed since the
 *  first sprint and nothing on the web ever called it, so "check your status any
 *  time with that code" was true only of the API. And a submitted proposal could
 *  not be corrected at all — a typo in a title meant asking an organiser.
 *
 *  The code is a lookup key and explicitly not a secret, so it gets the status
 *  and nothing else. Editing needs the proposal's own resume token, which the
 *  confirmation email carries and the browser that submitted it kept.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState, useSyncExternalStore } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { resolveVisibility, type FormSchema } from "@/lib/formLogic";

type Status = {
  code: string;
  title: string;
  stage: string;
  outcome: string | null;
  submitted_at: string | null;
  can_edit: boolean;
};

type Opened = {
  code: string;
  title: string;
  answers: Record<string, unknown>;
  stage: string;
  can_edit: boolean;
};

type PublicForm = { schema: FormSchema; event_name: string };

const DRAFT_KEY = "gather.cfp-draft";

/** The link in the confirmation email carries the token; the browser that
 *  submitted kept one too. Either gets you in, which is what makes this work
 *  from a phone that was not the phone you submitted on.
 *
 *  Read through `useSyncExternalStore` rather than an effect: neither the query
 *  string nor localStorage changes while this page is open, so there is nothing
 *  to subscribe to, and the server render has no browser to ask. */
const subscribeToken = () => () => {};
const readToken = () =>
  new URLSearchParams(window.location.search).get("t") ?? window.localStorage.getItem(DRAFT_KEY);
const noTokenOnTheServer = () => null;

const STAGE: Record<string, string> = {
  submitted: "Received. It has not gone to reviewers yet.",
  in_review: "With the reviewers.",
  decided: "A decision has been sent to you by email.",
};

const OUTCOME: Record<string, { label: string; fg: string; bg: string }> = {
  accepted: { label: "Accepted", fg: "var(--ok)", bg: "var(--okw)" },
  waitlisted: { label: "Waitlisted", fg: "var(--pd)", bg: "var(--pdw)" },
  rejected: { label: "Not this time", fg: "var(--e-muted, #9A9FB1)", bg: "var(--sk)" },
  withdrawn: { label: "Withdrawn", fg: "var(--e-muted, #9A9FB1)", bg: "var(--sk)" },
};

const LINE_TYPES = new Set(["short_text", "url", "email", "number", "date"]);
const CHOICE_TYPES = new Set(["select", "radio"]);
const HTML_INPUT: Record<string, string> = {
  url: "url",
  email: "email",
  number: "number",
  date: "date",
};

const shell: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "48px 20px 80px",
  font: "400 15px/1.6 var(--font-manrope), sans-serif",
  color: "var(--e-text, #F3F4F8)",
};

const field: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--e-edge-strong, rgba(255,255,255,.18))",
  background: "var(--e-raised, #101018)",
  font: "400 14px var(--font-manrope), sans-serif",
  color: "var(--e-text, #F3F4F8)",
};

const button: React.CSSProperties = {
  height: 42,
  padding: "0 20px",
  borderRadius: 999,
  border: "none",
  background: "var(--e-text, #F3F4F8)",
  color: "var(--e-page, #07080E)",
  font: "600 14px var(--font-manrope), sans-serif",
  cursor: "pointer",
};

export default function SubmissionPage({
  params,
}: {
  params: Promise<{ slug: string; code: string }>;
}) {
  const { slug, code } = use(params);
  const token = useSyncExternalStore(subscribeToken, readToken, noTokenOnTheServer);
  const [edits, setEdits] = useState<{ title: string; answers: Record<string, unknown> } | null>(
    null,
  );
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState("");

  const {
    data: status,
    isPending: statusPending,
    isError: statusFailed,
    error: statusError,
    refetch: retryStatus,
  } = useQuery({
    queryKey: ["submission-status", slug, code],
    queryFn: () => apiFetch<Status>(`/public/events/${slug}/submissions/${code}/status`),
    // A mistyped six-character code is the most likely way to arrive here, and
    // it 404s. Retrying a 404 four times only makes the dead end slower.
    retry: (attempt, error) => !(error instanceof ApiError && error.status === 404) && attempt < 2,
  });
  // A 404 means the code is wrong — nothing to retry, say so plainly. Anything
  // else (a 500, a dropped connection) is a real failure and was, until now,
  // presented with the exact same "No proposal with the code" copy: a backend
  // outage read as "you mistyped it" on the one page a speaker checks when
  // something else has already gone wrong.
  const codeNotFound = statusError instanceof ApiError && statusError.status === 404;

  const { data: form } = useQuery({
    queryKey: ["cfp-form", slug],
    queryFn: () => apiFetch<PublicForm>(`/public/events/${slug}/cfp-form`),
  });

  const { data: opened } = useQuery({
    queryKey: ["submission-open", slug, code, token],
    enabled: token !== null,
    retry: false,
    queryFn: () =>
      apiFetch<Opened>(`/public/events/${slug}/submissions/${code}/open`, {
        method: "POST",
        body: { draft_token: token },
      }).catch(() => null),
  });

  /** What the boxes show: the submitter's unsaved edits if they have typed
   *  anything, otherwise whatever the server last handed back. Derived rather
   *  than copied into state, so a refetch cannot leave the form showing a stale
   *  answer nobody edited. */
  const draft = edits ?? (opened ? { title: opened.title, answers: { ...opened.answers } } : null);

  const save = useMutation({
    // Most CFP forms carry their own title field, and the submission's title
    // column is meant to mirror it. Offering both boxes invites them to
    // disagree, so the schema's field wins where it exists.
    mutationFn: () =>
      apiFetch(`/public/events/${slug}/submissions/${code}`, {
        method: "PUT",
        body: {
          draft_token: token,
          title: String(draft?.answers.title ?? draft?.title ?? ""),
          answers: draft?.answers ?? {},
        },
      }),
    onSuccess: () => {
      setSaved(true);
      setProblem("");
    },
    onError: (error: Error) =>
      setProblem(error instanceof ApiError ? error.message : "Could not save. Try again."),
  });

  /* `data` never populates on error, so this used to sit on "Looking up
   * ZZZZZZ…" forever for any code that does not exist — on the one page whose
   * entire purpose is "check your status any time with that code", where a
   * mistyped code is the most likely thing a speaker does. */
  if (statusFailed) {
    return (
      <main style={shell}>
        {/* The only public route that does not use PublicShell, so until now
            there was no way off it but the browser's back button. */}
        <Link
          href={`/e/${slug}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 36,
            marginBottom: 20,
            font: "500 13.5px var(--font-manrope), sans-serif",
            color: "var(--e-muted, #9A9FB1)",
            textDecoration: "none",
          }}
        >
          ‹ {"Back to the event"}
        </Link>
        <div
          role="alert"
          style={{
            border: "1px solid var(--e-edge, rgba(255,255,255,.10))",
            background: "var(--e-raised, #101018)",
            borderRadius: "var(--radius-card)",
            padding: 32,
          }}
        >
          <h1
            style={{
              font: "700 22px/1.25 var(--font-manrope), sans-serif",
              color: "var(--e-text, #F3F4F8)",
              margin: "0 0 10px",
            }}
          >
            {codeNotFound ? `No proposal with the code ${code}.` : "This page did not load."}
          </h1>
          <p
            style={{
              font: "400 14.5px/1.65 var(--font-manrope), sans-serif",
              color: "var(--e-muted, #9A9FB1)",
              margin: 0,
            }}
          >
            {codeNotFound
              ? "Check it against your confirmation email — it is six characters, letters and digits. If the code is right, the call for papers may belong to a different event."
              : "The server did not answer. It is usually a dropped request rather than anything wrong with the code — try again in a moment."}
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 24 }}>
            <button
              onClick={() => void retryStatus()}
              style={{
                height: 44,
                padding: "0 22px",
                borderRadius: 999,
                border: "none",
                background: "var(--e-text, #F3F4F8)",
                color: "var(--e-page, #07080E)",
                font: "600 14px var(--font-manrope), sans-serif",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <Link
              href={`/e/${slug}`}
              style={{
                height: 44,
                padding: "0 22px",
                borderRadius: 999,
                display: "inline-flex",
                alignItems: "center",
                color: "var(--e-muted, #9A9FB1)",
                font: "500 14px var(--font-manrope), sans-serif",
                textDecoration: "none",
              }}
            >
              Back to the event
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (statusPending || status === undefined) {
    return <main style={shell}>Looking up {code}…</main>;
  }

  const outcome = status.outcome === null ? null : OUTCOME[status.outcome];
  const editable = status.can_edit && opened?.can_edit === true && draft !== null;
  const fields = (form?.schema.sections ?? []).flatMap((section) => section.fields);
  // The same visibility rules the CFP form uses, so a field the logic hides on
  // the way in cannot reappear on the way back to edit it.
  const visible =
    draft === null || form === undefined
      ? new Set<string>()
      : resolveVisibility(form.schema, draft.answers).visible;

  return (
    <main style={shell}>
      <p
        style={{ font: "500 11px ui-monospace,'SF Mono',Menlo,monospace, monospace", color: "var(--e-faint, #7C8093)", margin: 0 }}
      >
        {(form?.event_name ?? "").toUpperCase()} · PROPOSAL {status.code}
      </p>
      <h1 style={{ font: "600 28px/1.2 var(--font-manrope), sans-serif", margin: "8px 0 12px" }}>
        {status.title}
      </h1>

      <p style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 6px" }}>
        {outcome === undefined || outcome === null ? null : (
          <span
            style={{
              padding: "3px 10px",
              borderRadius: 999,
              background: outcome.bg,
              color: outcome.fg,
              font: "600 12px var(--font-manrope), sans-serif",
            }}
          >
            {outcome.label}
          </span>
        )}
        <span style={{ color: "var(--e-muted, #9A9FB1)" }}>{STAGE[status.stage] ?? "Received."}</span>
      </p>
      {status.submitted_at === null ? null : (
        <p style={{ color: "var(--e-faint, #7C8093)", font: "400 13px var(--font-manrope), sans-serif", margin: 0 }}>
          Submitted{" "}
          {new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }).format(new Date(status.submitted_at))}
        </p>
      )}

      {editable ? (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ font: "600 17px var(--font-manrope), sans-serif", margin: "0 0 4px" }}>
            Change something
          </h2>
          <p
            style={{
              color: "var(--e-muted, #9A9FB1)",
              font: "400 13px var(--font-manrope), sans-serif",
              margin: "0 0 18px",
            }}
          >
            You can edit this until the call for papers closes. After that, and once reviewing
            starts, it is fixed.
          </p>

          {fields
            .filter((entry) => visible.has(entry.key))
            .map((entry) => {
              const value = draft.answers[entry.key];
              const set = (next: unknown) =>
                setEdits({ ...draft, answers: { ...draft.answers, [entry.key]: next } });
              return (
                <label key={entry.key} style={{ display: "block", marginBottom: 14 }}>
                  <span
                    style={{
                      display: "block",
                      font: "500 13px var(--font-manrope), sans-serif",
                      marginBottom: 5,
                    }}
                  >
                    {entry.label}
                    {entry.required === true ? " *" : ""}
                  </span>
                  {CHOICE_TYPES.has(entry.type) ? (
                    <select
                      value={String(value ?? "")}
                      onChange={(e) => set(e.target.value)}
                      style={field}
                    >
                      <option value="">Choose one</option>
                      {(entry.choices ?? []).map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                  ) : LINE_TYPES.has(entry.type) ? (
                    <input
                      type={HTML_INPUT[entry.type] ?? "text"}
                      value={String(value ?? "")}
                      onChange={(e) => set(e.target.value)}
                      style={field}
                    />
                  ) : (
                    <textarea
                      rows={6}
                      value={String(value ?? "")}
                      onChange={(e) => set(e.target.value)}
                      style={{ ...field, resize: "vertical" }}
                    />
                  )}
                </label>
              );
            })}

          {problem === "" ? null : (
            <p role="alert" style={{ color: "var(--cn)", font: "400 13px var(--font-manrope), sans-serif" }}>
              {problem}
            </p>
          )}
          <button style={button} disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
          {saved ? (
            <span
              style={{ marginLeft: 12, color: "var(--ok)", font: "500 13px var(--font-manrope), sans-serif" }}
            >
              Saved. The organisers see the new version.
            </span>
          ) : null}
        </section>
      ) : (
        <p style={{ marginTop: 28, color: "var(--e-muted, #9A9FB1)", font: "400 13.5px var(--font-manrope), sans-serif" }}>
          {status.can_edit
            ? "Open the link in your confirmation email on this device to make changes."
            : "This proposal can no longer be edited — the call for papers has closed, or reviewing has started."}
        </p>
      )}
    </main>
  );
}
