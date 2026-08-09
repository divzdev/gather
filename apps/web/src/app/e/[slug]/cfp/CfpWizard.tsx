"use client";

/**
 * Public CFP submission. Ported from CFP.dc.html: welcome, form, review stepper,
 * with the deadline and per-speaker limit stated up front.
 *
 * The form renders entirely from the server's JSON schema, so adding a field in
 * the builder changes this page with no code. Conditional logic is evaluated
 * here for immediate feedback and again on the server, which is what decides.
 */

import { useMemo, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { resolveVisibility, type FormSchema } from "@/lib/formLogic";

type PublicForm = {
  event_name: string;
  event_slug: string;
  event_description: string | null;
  form_id: string;
  form_name: string;
  schema: FormSchema;
  closes_at: string | null;
  is_open: boolean;
  closed_reason: string | null;
};

type Step = "welcome" | "form" | "done";
type Answers = Record<string, unknown>;

const DRAFT_KEY = (slug: string) => `gather.draft.${slug}`;

export function CfpWizard({ form }: { form: PublicForm }) {
  const [step, setStep] = useState<Step>("welcome");
  const [answers, setAnswers] = useState<Answers>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const fields = useMemo(
    () => form.schema.sections.flatMap((s) => s.fields),
    [form.schema],
  );
  const visibility = useMemo(
    () => resolveVisibility(form.schema, answers),
    [form.schema, answers],
  );

  const deadline = form.closes_at
    ? new Date(form.closes_at).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  function set(key: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    // Clear this field's error as soon as the speaker touches it again.
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)));
  }

  function draftToken(): string | null {
    return window.localStorage.getItem(DRAFT_KEY(form.event_slug));
  }

  async function saveDraft() {
    if (!email || !name) {
      setBanner("Add your name and email first, then we can save your progress.");
      return;
    }
    setBusy(true);
    try {
      const saved = await apiFetch<{ draft_token: string; code: string }>(
        `/public/events/${form.event_slug}/submissions/draft`,
        {
          method: "POST",
          body: {
            form_id: form.form_id,
            title: String(answers.title ?? "Untitled proposal"),
            answers,
            speaker_email: email,
            speaker_name: name,
            draft_token: draftToken(),
          },
        },
      );
      window.localStorage.setItem(DRAFT_KEY(form.event_slug), saved.draft_token);
      setSavedAt(new Date().toLocaleTimeString());
      setBanner(null);
    } catch (caught) {
      setBanner(caught instanceof ApiError ? caught.message : "Could not save your draft.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    setBanner(null);
    try {
      const result = await apiFetch<{ code: string; confirmation_message: string }>(
        `/public/events/${form.event_slug}/submissions`,
        {
          method: "POST",
          body: {
            form_id: form.form_id,
            title: String(answers.title ?? ""),
            answers,
            speaker_email: email,
            speaker_name: name,
            draft_token: draftToken(),
          },
        },
      );
      window.localStorage.removeItem(DRAFT_KEY(form.event_slug));
      setCode(result.code);
      setBanner(result.confirmation_message);
      setStep("done");
    } catch (caught) {
      if (caught instanceof ApiError) {
        const details = caught.details as { errors?: { field: string; message: string }[] } | undefined;
        if (details?.errors?.length) {
          setErrors(Object.fromEntries(details.errors.map((e) => [e.field, e.message])));
          const first = details.errors[0];
          document.getElementById(`field-${first?.field}`)?.focus();
        }
        setBanner(caught.message);
      } else {
        setBanner("Could not submit. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const card: React.CSSProperties = {
    background: "var(--cd, #FFFFFF)",
    border: "1px solid var(--ln, #E1E7E9)",
    borderRadius: 14,
    padding: 24,
  };
  const label: React.CSSProperties = {
    display: "block",
    marginBottom: 6,
    font: "500 12.5px var(--font-plex-sans), sans-serif",
    color: "var(--i2, #3E4E58)",
  };
  const control = (invalid: boolean): React.CSSProperties => ({
    width: "100%",
    padding: "9px 10px",
    borderRadius: 6,
    border: `1px solid ${invalid ? "var(--cn, #D8432B)" : "var(--ls, #C8D2D5)"}`,
    background: "var(--cd, #FFFFFF)",
    color: "var(--ik, #16232B)",
    font: "400 13px var(--font-plex-sans), sans-serif",
  });
  const primary: React.CSSProperties = {
    height: 38,
    padding: "0 20px",
    borderRadius: 999,
    border: "none",
    background: "var(--bt, #FF6B6B)",
    color: "var(--bf, #331313)",
    font: "600 13px var(--font-plex-sans), sans-serif",
  };
  const quiet: React.CSSProperties = {
    height: 38,
    padding: "0 16px",
    borderRadius: 999,
    border: "1px solid var(--ls, #C8D2D5)",
    background: "none",
    color: "var(--i2, #3E4E58)",
    font: "500 13px var(--font-plex-sans), sans-serif",
  };

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px 96px", fontSize: 16 }}>
      <p
        style={{
          font: "600 10px var(--font-plex-condensed), sans-serif",
          letterSpacing: "0.12em",
          color: "var(--i4, #99A6AD)",
          margin: 0,
        }}
      >
        CALL FOR PAPERS
      </p>
      <h1
        style={{
          font: "600 36px var(--font-bricolage), sans-serif",
          color: "var(--ik, #16232B)",
          margin: "6px 0 8px",
        }}
      >
        {form.event_name}
      </h1>
      {form.event_description !== null && (
        <p style={{ color: "var(--i2, #3E4E58)", margin: "0 0 20px", fontSize: 15 }}>
          {form.event_description}
        </p>
      )}

      {!form.is_open ? (
        <div
          style={{
            ...card,
            background: "var(--pdw, #F9EDDF)",
            borderColor: "var(--pdl, #EFD3B6)",
          }}
        >
          <h2 style={{ font: "600 18px var(--font-plex-sans)", margin: "0 0 6px", color: "var(--pd, #B96A1F)" }}>
            Submissions are closed
          </h2>
          <p style={{ margin: 0, color: "var(--i2)", fontSize: 14 }}>
            {form.closed_reason ?? "This call for papers is no longer accepting proposals."}
          </p>
        </div>
      ) : step === "welcome" ? (
        <div style={card}>
          {deadline !== null && (
            <p
              className="tabular"
              style={{
                display: "inline-block",
                margin: "0 0 14px",
                padding: "5px 12px",
                borderRadius: 999,
                background: "var(--sw, #FFEAE6)",
                color: "var(--sg, #E04E4E)",
                font: "500 12px var(--font-plex-mono), monospace",
              }}
            >
              Open until {deadline}
            </p>
          )}
          <h2 style={{ font: "600 20px var(--font-plex-sans)", margin: "0 0 8px" }}>
            Before you start
          </h2>
          <p style={{ color: "var(--i2)", fontSize: 14, margin: "0 0 16px" }}>
            No account needed. Your email is your identity, and you can save a draft and come
            back to it. We will email you a reference code as soon as you submit.
          </p>
          <button type="button" style={primary} onClick={() => setStep("form")}>
            Start a proposal
          </button>
        </div>
      ) : step === "done" ? (
        <div style={card}>
          <h2 style={{ font: "600 20px var(--font-plex-sans)", margin: "0 0 8px", color: "var(--ok, #0E7A5F)" }}>
            Your proposal is in
          </h2>
          <p style={{ color: "var(--i2)", fontSize: 14, margin: "0 0 14px" }}>{banner}</p>
          <p style={{ margin: "0 0 4px", font: "500 12.5px var(--font-plex-sans)", color: "var(--i3)" }}>
            Your reference
          </p>
          <p
            className="tabular"
            style={{
              margin: 0,
              font: "500 28px var(--font-plex-mono), monospace",
              color: "var(--ik)",
              letterSpacing: "0.06em",
            }}
          >
            {code}
          </p>
          <p style={{ color: "var(--i3)", fontSize: 13, marginTop: 14 }}>
            Keep that code. You can check the status of your proposal with it at any time.
          </p>
        </div>
      ) : (
        <form
          style={card}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {banner !== null && (
            <p
              role="alert"
              style={{
                margin: "0 0 16px",
                padding: "9px 12px",
                borderRadius: 6,
                background: "var(--cnw, #FBE8E6)",
                border: "1px solid var(--cnl, #F3C7C2)",
                color: "var(--cn, #D8432B)",
                fontSize: 13,
              }}
            >
              {banner}
            </p>
          )}

          <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
            <div>
              <label htmlFor="speaker-name" style={label}>
                Your name
              </label>
              <input
                id="speaker-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={control(false)}
              />
            </div>
            <div>
              <label htmlFor="speaker-email" style={label}>
                Your email
              </label>
              <input
                id="speaker-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={control(false)}
              />
            </div>
          </div>

          {form.schema.sections.map((section) => (
            <fieldset key={section.key} style={{ border: "none", padding: 0, margin: "0 0 8px" }}>
              <legend
                style={{
                  font: "600 15px var(--font-plex-sans), sans-serif",
                  color: "var(--ik)",
                  padding: 0,
                  marginBottom: 12,
                }}
              >
                {section.title}
              </legend>
              <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
                {section.fields
                  .filter((field) => visibility.visible.has(field.key))
                  .map((field) => {
                    const invalid = field.key in errors;
                    const required = visibility.required.has(field.key);
                    return (
                      <div key={field.key}>
                        <label htmlFor={`field-${field.key}`} style={label}>
                          {field.label}
                          {required && <span style={{ color: "var(--cn)" }}> *</span>}
                        </label>
                        {field.type === "long_text" ? (
                          <textarea
                            id={`field-${field.key}`}
                            rows={5}
                            value={String(answers[field.key] ?? "")}
                            onChange={(e) => set(field.key, e.target.value)}
                            style={control(invalid)}
                          />
                        ) : field.type === "select" ? (
                          <select
                            id={`field-${field.key}`}
                            value={String(answers[field.key] ?? "")}
                            onChange={(e) => set(field.key, e.target.value)}
                            style={control(invalid)}
                          >
                            <option value="">Choose one…</option>
                            {field.choices.map((choice) => (
                              <option key={choice.value} value={choice.value}>
                                {choice.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={`field-${field.key}`}
                            type={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
                            value={String(answers[field.key] ?? "")}
                            onChange={(e) => set(field.key, e.target.value)}
                            style={control(invalid)}
                          />
                        )}
                        {field.help_text !== null && !invalid && (
                          <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--i3)" }}>
                            {field.help_text}
                          </p>
                        )}
                        {invalid && (
                          <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--cn)" }}>
                            {errors[field.key]}
                          </p>
                        )}
                      </div>
                    );
                  })}
              </div>
            </fieldset>
          ))}

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button type="submit" disabled={busy} style={{ ...primary, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Sending…" : "Submit proposal"}
            </button>
            <button type="button" onClick={() => void saveDraft()} disabled={busy} style={quiet}>
              Save draft
            </button>
            {savedAt !== null && (
              <span className="tabular" style={{ fontSize: 12, color: "var(--i3)" }}>
                Draft saved at {savedAt}
              </span>
            )}
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--i4)" }}>
            {fields.length} questions. You can save and finish later.
          </p>
        </form>
      )}
    </main>
  );
}
