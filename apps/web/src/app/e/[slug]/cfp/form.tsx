"use client";

/** The call for papers — the product's front door.
 *
 *  Every proposal in the system arrives here, from someone with no account,
 *  often on a phone, usually near the deadline. So: nothing on this screen is a
 *  literal string where a fact belongs, the wizard's steps are the form's own
 *  sections rather than a hardcoded four, an unfinished draft is genuinely
 *  resumed instead of quietly starting a second submission, and the save
 *  indicator is allowed to say it failed.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { use, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { resolveVisibility, type FormSchema } from "@/lib/formLogic";
import { CHOICE_TYPES, CONTROL, Consent, Field, Optional, Problem, button } from "./fields";
import { CFP_CSS, Rail, Shell, Toasts } from "./chrome";

type PublicForm = {
  event_name: string;
  event_slug: string;
  event_description: string | null;
  form_id: string;
  form_name: string;
  schema: FormSchema;
  closes_at: string | null;
  event_timezone: string;
  submission_limit_per_speaker: number | null;
  is_open: boolean;
  closed_reason: string | null;
};

type Stored = { slug: string; token: string; code: string; email: string; name: string };
type Problem = { key: string; message: string; step: number };
type Save =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "failed"; message: string };

const STORE = "gather.cfp-draft";
const AUTOSAVE_MS = 20_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function titleOf(values: Record<string, unknown>): string {
  const named = values["title"];
  if (typeof named === "string" && named.trim() !== "") return named;
  const first = Object.values(values).find(
    (value) => typeof value === "string" && value.trim() !== "",
  );
  return typeof first === "string" ? first : "";
}

function read(slug: string): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORE);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Stored;
    return parsed.slug === slug && parsed.token !== "" ? parsed : null;
  } catch {
    return null;
  }
}

export default function CfpPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [terms, setTerms] = useState(false);
  const [co, setCo] = useState<{ name: string; email: string }[]>([]);
  const [errors, setErrors] = useState<Problem[]>([]);
  const [save, setSave] = useState<Save>({ kind: "idle" });
  const [resumed, setResumed] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string; message: string } | null>(null);
  const [toasts, setToasts] = useState<{ id: string; msg: string }[]>([]);
  const token = useRef<string | null>(null);
  const lastSaved = useRef("");

  const {
    data: form,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["cfp-form", slug],
    queryFn: () => apiFetch<PublicForm>(`/public/events/${slug}/cfp-form`),
  });

  const toast = (msg: string) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-2), { id, msg }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 6000);
  };

  const schema = form?.schema;
  const settings = schema?.settings;
  const { visible, required } = useMemo(
    () =>
      schema
        ? resolveVisibility(schema, values)
        : { visible: new Set<string>(), required: new Set<string>() },
    [schema, values],
  );

  /** The wizard is the form's own shape: one step per section that has
   *  something to show, so a section the organiser adds needs no code. */
  const sections = useMemo(
    () =>
      (schema?.sections ?? [])
        .map((section) => ({
          ...section,
          fields: section.fields.filter((field) => visible.has(field.key)),
        }))
        .filter((section) => section.fields.length > 0),
    [schema, visible],
  );

  const steps = ["You", ...sections.map((section) => section.title), "Review and submit"];
  const last = steps.length;
  const needsTerms = settings?.require_terms === true;
  const maxCo = settings?.allow_co_speakers === false ? 0 : (settings?.max_co_speakers ?? 4);

  // ---- resume ------------------------------------------------------------
  useEffect(() => {
    const stored = read(slug);
    if (stored === null) return;
    let live = true;
    void apiFetch<{ title: string; answers: Record<string, unknown>; can_edit: boolean }>(
      `/public/events/${slug}/submissions/${stored.code}/open`,
      { method: "POST", body: { draft_token: stored.token } },
    )
      .then((draft) => {
        if (!live) return;
        if (!draft.can_edit) {
          // Already submitted, or the call has closed. Keeping the token would
          // resume a proposal that can no longer be changed.
          window.localStorage.removeItem(STORE);
          return;
        }
        token.current = stored.token;
        setValues(draft.answers);
        setName(stored.name);
        setEmail(stored.email);
        setResumed(stored.code);
        setStep(1);
      })
      .catch((caught: unknown) => {
        if (!live) return;
        // Only forget the draft when the server says it is genuinely not there.
        // Discarding it on a timeout or a 500 loses the speaker's pointer to
        // their own work, and the next autosave then starts a *second*
        // submission — which is how the demo database filled up with
        // half-written duplicates in the first place.
        if (caught instanceof ApiError && caught.status === 404) {
          window.localStorage.removeItem(STORE);
          return;
        }
        token.current = stored.token;
        setName(stored.name);
        setEmail(stored.email);
      });
    return () => {
      live = false;
    };
  }, [slug]);

  // ---- saving ------------------------------------------------------------
  const cleanCo = () =>
    co
      .filter((person) => person.name.trim() !== "" && person.email.trim() !== "")
      .map((person) => ({ name: person.name.trim(), email: person.email.trim() }));

  const payload = () => ({
    form_id: form?.form_id,
    title: titleOf(values),
    answers: values,
    speaker_email: email.trim(),
    speaker_name: name.trim() === "" ? email.trim() : name.trim(),
    co_speakers: cleanCo(),
    draft_token: token.current,
  });

  const saveDraft = useMutation({
    mutationFn: async () => {
      const body = payload();
      // The API needs both; before then there is nothing to keep, which is not
      // the same as a failure.
      if (body.speaker_email === "" || body.title.trim() === "") return null;
      const stamp = JSON.stringify({ ...body, draft_token: null });
      if (stamp === lastSaved.current) return null;
      setSave({ kind: "saving" });
      const result = await apiFetch<{ code: string; draft_token: string }>(
        `/public/events/${slug}/submissions/draft`,
        { method: "POST", body },
      );
      lastSaved.current = stamp;
      return result;
    },
    onSuccess: (result) => {
      if (result === null) return;
      token.current = result.draft_token;
      window.localStorage.setItem(
        STORE,
        JSON.stringify({
          slug,
          token: result.draft_token,
          code: result.code,
          email: email.trim(),
          name: name.trim(),
        } satisfies Stored),
      );
      setSave({
        kind: "saved",
        at: new Intl.DateTimeFormat("en-GB", { timeStyle: "short" }).format(new Date()),
      });
    },
    // Without this the label kept reading "Saved 17:04" through every failure,
    // which is how a speaker loses fifteen minutes of writing and is told
    // nothing.
    onError: (caught: Error) =>
      setSave({
        kind: "failed",
        message: caught instanceof ApiError ? caught.message : "We could not reach the server.",
      }),
  });

  useEffect(() => {
    const timer = window.setInterval(() => saveDraft.mutate(), AUTOSAVE_MS);
    return () => window.clearInterval(timer);
  }, [saveDraft]);

  // ---- validation --------------------------------------------------------
  const stepOf = (key: string) => {
    const index = sections.findIndex((section) => section.fields.some((f) => f.key === key));
    return index === -1 ? last : index + 2;
  };

  const validate = (): Problem[] => {
    const found: Problem[] = [];
    if (name.trim() === "")
      found.push({ key: "name", message: "What name should appear on the programme?", step: 1 });
    if (email.trim() === "")
      found.push({ key: "email", message: "We need an address to reach you about this.", step: 1 });
    else if (!EMAIL.test(email.trim()))
      found.push({ key: "email", message: "That does not look like an email address.", step: 1 });

    sections.forEach((section, index) => {
      for (const field of section.fields) {
        const value = values[field.key];
        const blank =
          value === undefined ||
          value === false ||
          (typeof value === "string" && value.trim() === "") ||
          (Array.isArray(value) && value.length === 0);
        if (required.has(field.key) && blank) {
          found.push({
            key: field.key,
            step: index + 2,
            message: CHOICE_TYPES.has(field.type)
              ? `Pick a ${field.label.toLowerCase()}.`
              : `${field.label} is required.`,
          });
          continue;
        }
        const max = field.max_length ?? null;
        if (max !== null && typeof value === "string" && value.length > max)
          found.push({
            key: field.key,
            step: index + 2,
            message: `${value.length - max} characters too long — the limit is ${max}.`,
          });
      }
    });

    co.forEach((person, index) => {
      const filled = person.name.trim() !== "" || person.email.trim() !== "";
      if (!filled) return;
      if (person.name.trim() === "" || !EMAIL.test(person.email.trim()))
        found.push({
          key: `co-${index}`,
          step: last - 1,
          message: "A co-speaker needs both a name and a valid email address.",
        });
    });

    if (needsTerms && !terms)
      found.push({ key: "terms", message: "Confirm you agree to the speaker terms.", step: 0 });
    return found;
  };

  const submit = useMutation({
    mutationFn: () =>
      apiFetch<{ code: string; confirmation_message: string }>(
        `/public/events/${slug}/submissions`,
        { method: "POST", body: payload() },
      ),
    onSuccess: (result) => {
      setDone({ code: result.code, message: result.confirmation_message });
      window.localStorage.removeItem(STORE);
    },
    onError: (caught: Error) => {
      // The server decides; when it disagrees with us, put its words on the
      // field it named rather than in a toast that scrolls away.
      const detail =
        caught instanceof ApiError
          ? (caught.details as { errors?: { field: string; message: string }[] } | undefined)
          : undefined;
      const listed = (detail?.errors ?? []).map((entry) => ({
        key: entry.field,
        message: entry.message,
        step: stepOf(entry.field),
      }));
      if (listed.length > 0) {
        setErrors(listed);
        setStep(listed[0]!.step);
        return;
      }
      toast(caught instanceof ApiError ? caught.message : "Could not submit. Try again.");
    },
  });

  const advance = () => {
    if (step < last) {
      // Only this step's problems. Catching them here is the difference between
      // "Track is required" next to the track, and four steps later on a
      // summary. The rail still jumps anywhere unchecked, so nobody is trapped.
      const here = validate().filter((problem) => problem.step === step);
      if (here.length > 0) {
        setErrors(here);
        return;
      }
      setErrors([]);
      saveDraft.mutate();
      setStep((current) => current + 1);
      return;
    }
    const found = validate();
    setErrors(found);
    if (found.length > 0) {
      setStep(found[0]!.step);
      return;
    }
    submit.mutate();
  };

  /** The line under the heading says what this step is for. It used to repeat
   *  "Step 2 of 4", which the rail already shows and the phone strip shows
   *  again — three copies of a number and nowhere saying why. */
  const blurb = (() => {
    if (step === 0) {
      const welcome = settings?.welcome_message ?? "";
      if (welcome.trim() !== "") return welcome;
      return (
        form?.event_description ?? "No account needed — your email address is your identity here."
      );
    }
    if (step === 1) return "Two details, and then the proposal itself.";
    if (step === last) return "Nothing has been sent yet. Read it over, then submit.";
    return sections[step - 2]?.description ?? "";
  })();

  const errorFor = (key: string) => errors.find((entry) => entry.key === key)?.message ?? null;
  const setValue = (key: string, value: unknown) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => current.filter((entry) => entry.key !== key));
  };

  // ---- panels ------------------------------------------------------------
  const identity = (
    <div style={{ display: "grid", gap: 22 }}>
      <div>
        <label htmlFor="cfp-name" style={CONTROL.label}>
          Your name<span style={{ color: "var(--e-accent, #FF6B6B)" }}> *</span>
        </label>
        <p
          style={{
            font: "400 13px/1.55 var(--font-manrope), sans-serif",
            color: "var(--e-muted, #9A9FB1)",
            margin: "0 0 10px",
          }}
        >
          As it should appear on the programme.
        </p>
        <input
          id="cfp-name"
          className="cfp-control"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setErrors((current) => current.filter((entry) => entry.key !== "name"));
          }}
          placeholder="Alex Rivera"
          style={{
            ...CONTROL.input,
            borderColor: errorFor("name") !== null ? "var(--cn)" : "var(--e-edge-strong, rgba(255,255,255,.18))",
          }}
        />
        <Problem error={errorFor("name")} />
      </div>
      <div>
        <label htmlFor="cfp-email" style={CONTROL.label}>
          Email<span style={{ color: "var(--e-accent, #FF6B6B)" }}> *</span>
        </label>
        <p
          style={{
            font: "400 13px/1.55 var(--font-manrope), sans-serif",
            color: "var(--e-muted, #9A9FB1)",
            margin: "0 0 10px",
          }}
        >
          Your address is your account here — there is no password. Everything about this proposal
          comes to it.
        </p>
        <input
          id="cfp-email"
          className="cfp-control"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setErrors((current) => current.filter((entry) => entry.key !== "email"));
          }}
          placeholder="you@example.com"
          style={{
            ...CONTROL.input,
            borderColor: errorFor("email") !== null ? "var(--cn)" : "var(--e-edge-strong, rgba(255,255,255,.18))",
          }}
        />
        <Problem error={errorFor("email")} />
      </div>
    </div>
  );

  const coSpeakers =
    maxCo === 0 ? null : (
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <p style={{ font: "500 13px var(--font-manrope), sans-serif", color: "var(--e-muted, #9A9FB1)", margin: 0 }}>
            Anyone else on stage with you
            <Optional />
          </p>
          <p
            style={{
              font: "400 13px/1.55 var(--font-manrope), sans-serif",
              color: "var(--e-muted, #9A9FB1)",
              margin: "6px 0 0",
            }}
          >
            Up to {maxCo}. They are added to the roster and hear from us at the same time you do.
          </p>
        </div>
        {co.map((person, index) => (
          <div key={index} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              className="cfp-control"
              value={person.name}
              aria-label={`Co-speaker ${index + 1} name`}
              placeholder="Name"
              onChange={(event) =>
                setCo((current) =>
                  current.map((row, at) =>
                    at === index ? { ...row, name: event.target.value } : row,
                  ),
                )
              }
              style={{ ...CONTROL.input, flex: "1 1 180px", width: "auto" }}
            />
            <input
              className="cfp-control"
              type="email"
              value={person.email}
              aria-label={`Co-speaker ${index + 1} email`}
              placeholder="them@example.com"
              onChange={(event) =>
                setCo((current) =>
                  current.map((row, at) =>
                    at === index ? { ...row, email: event.target.value } : row,
                  ),
                )
              }
              style={{ ...CONTROL.input, flex: "1 1 180px", width: "auto" }}
            />
            <button
              type="button"
              className="cfp-control"
              onClick={() => setCo((current) => current.filter((_, at) => at !== index))}
              style={{ ...button("secondary"), height: 46 }}
            >
              Remove
            </button>
            <Problem error={errorFor(`co-${index}`)} />
          </div>
        ))}
        {co.length < maxCo && (
          <div>
            <button
              type="button"
              className="cfp-control"
              onClick={() => setCo((current) => [...current, { name: "", email: "" }])}
              style={button("secondary")}
            >
              + Add a co-speaker
            </button>
          </div>
        )}
      </div>
    );

  const review = (
    <div style={{ display: "grid", gap: 20 }}>
      <div
        style={{
          border: "1px solid var(--e-edge, rgba(255,255,255,.10))",
          background: "var(--e-raised, #101018)",
          borderRadius: 14,
          padding: 24,
          display: "grid",
          gap: 14,
        }}
      >
        {[
          { k: "Name", v: name || "—" },
          { k: "Email", v: email || "—" },
          ...sections.flatMap((section) =>
            section.fields.map((field) => ({
              k: field.label,
              v: (() => {
                const value = values[field.key];
                if (Array.isArray(value)) return value.join(", ") || "—";
                if (value === true) return "Yes";
                const text = typeof value === "string" ? value.trim() : "";
                return text === "" ? "—" : text.length > 220 ? `${text.slice(0, 220)}…` : text;
              })(),
            })),
          ),
          ...(cleanCo().length > 0
            ? [
                {
                  k: "Co-speakers",
                  v: cleanCo()
                    .map((p) => p.name)
                    .join(", "),
                },
              ]
            : []),
        ].map((row) => (
          <div key={row.k} className="cfp-summary">
            <span style={{ font: "400 13px var(--font-manrope), sans-serif", color: "var(--e-faint, #7C8093)" }}>
              {row.k}
            </span>
            <span style={{ font: "400 14px/1.6 var(--font-manrope), sans-serif", color: "var(--e-text, #F3F4F8)" }}>
              {row.v}
            </span>
          </div>
        ))}
      </div>

      {needsTerms && (
        <Consent
          checked={terms}
          error={errorFor("terms")}
          label="I agree to the speaker terms: recording consent is asked separately after acceptance, and my talk contains no vendor pitch."
          onToggle={() => {
            setTerms((current) => !current);
            setErrors((current) => current.filter((entry) => entry.key !== "terms"));
          }}
        />
      )}

      {errors.length > 0 && (
        <div
          role="alert"
          style={{
            border: "1px solid var(--cnl)",
            background: "var(--cnw)",
            borderRadius: 14,
            padding: 20,
          }}
        >
          <p
            style={{
              font: "600 14px var(--font-manrope), sans-serif",
              color: "var(--cn)",
              margin: "0 0 10px",
            }}
          >
            {errors.length} {errors.length === 1 ? "answer needs" : "answers need"} attention
          </p>
          <ul
            style={{ margin: 0, paddingLeft: 20, listStyleType: "disc", display: "grid", gap: 6 }}
          >
            {errors.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  onClick={() => setStep(entry.step)}
                  style={{
                    border: "none",
                    background: "none",
                    padding: 0,
                    cursor: "pointer",
                    textAlign: "left",
                    font: "400 13.5px/1.55 var(--font-manrope), sans-serif",
                    color: "var(--e-muted, #9A9FB1)",
                    textDecoration: "underline",
                  }}
                >
                  {entry.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  const body = (() => {
    if (step === 0)
      return (
        <div style={{ display: "grid", gap: 22 }}>
          <div
            style={{
              border: "1px solid var(--e-edge, rgba(255,255,255,.10))",
              background: "var(--e-raised, #101018)",
              borderRadius: 14,
              padding: 24,
            }}
          >
            <p
              style={{
                font: "600 14px var(--font-manrope), sans-serif",
                color: "var(--e-text, #F3F4F8)",
                margin: "0 0 10px",
              }}
            >
              What you will need · about 15 minutes
            </p>
            <ul
              style={{
                margin: 0,
                paddingLeft: 20,
                display: "grid",
                gap: 7,
                listStyleType: "disc",
                font: "400 14px/1.6 var(--font-manrope), sans-serif",
                color: "var(--e-muted, #9A9FB1)",
              }}
            >
              {sections.flatMap((section) =>
                section.fields
                  .filter((field) => required.has(field.key))
                  .map((field) => (
                    <li key={field.key}>
                      {field.label}
                      {field.help_text ? (
                        <span style={{ color: "var(--e-muted, #9A9FB1)" }}> — {field.help_text}</span>
                      ) : null}
                    </li>
                  )),
              )}
            </ul>
          </div>
          <p style={{ font: "400 14px/1.65 var(--font-manrope), sans-serif", color: "var(--e-muted, #9A9FB1)", margin: 0 }}>
            Your work is saved as you go, so you can close this and come back. Nothing is sent until
            you press submit on the last step.
          </p>
          {needsTerms && (
            <Consent
              checked={terms}
              error={errorFor("terms")}
              label="I agree to the speaker terms: recording consent is asked separately after acceptance, and my talk contains no vendor pitch."
              onToggle={() => setTerms((current) => !current)}
            />
          )}
        </div>
      );

    if (step === 1) return identity;
    if (step === last) return review;

    const section = sections[step - 2];
    if (section === undefined) return null;
    return (
      <div style={{ display: "grid", gap: 26 }}>
        {section.fields.map((field) => (
          <Field
            key={field.key}
            field={field}
            value={values[field.key]}
            required={required.has(field.key)}
            error={errorFor(field.key)}
            onChange={(value) => setValue(field.key, value)}
          />
        ))}
        {step === last - 1 && coSpeakers}
      </div>
    );
  })();

  return (
    <Shell
      css={CFP_CSS}
      form={form}
      slug={slug}
      isPending={isPending}
      isError={isError}
      onRetry={() => void refetch()}
      done={done}
      // A second proposal is a second proposal: every field resets, including
      // the ones the speaker might reasonably keep. Carrying the name over
      // appended it to what they typed next, and carrying the save stamp made a
      // brand-new draft claim it had already been saved.
      onAgain={() => {
        setDone(null);
        setValues({});
        setName("");
        setEmail("");
        setCo([]);
        setTerms(false);
        setErrors([]);
        setSave({ kind: "idle" });
        setStep(0);
        setResumed(null);
        token.current = null;
        lastSaved.current = "";
      }}
      onCopy={(code) => {
        void navigator.clipboard.writeText(code);
        toast("Code copied. Keep it — it is how you check this proposal later.");
      }}
    >
      <div className="cfp-shell">
        <Rail
          steps={steps}
          step={step}
          onStep={setStep}
          save={save}
          onRetrySave={() => saveDraft.mutate()}
          resumed={resumed}
        />

        <div>
          <h1
            style={{
              font: "700 clamp(26px,4vw,38px)/1.1 var(--font-manrope), sans-serif",
              letterSpacing: "-0.02em",
              color: "var(--e-text, #F3F4F8)",
              margin: "0 0 10px",
            }}
          >
            {step === 0 ? `Speak at ${form?.event_name ?? "this event"}` : steps[step - 1]}
          </h1>
          <p
            style={{
              font: "400 15px/1.65 var(--font-manrope), sans-serif",
              color: "var(--e-muted, #9A9FB1)",
              margin: "0 0 30px",
              maxWidth: "62ch",
            }}
          >
            {blurb}
          </p>

          {body}

          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
              marginTop: 34,
            }}
          >
            {step > 0 && (
              <button
                type="button"
                className="cfp-control"
                onClick={() => setStep((current) => Math.max(0, current - 1))}
                style={button("ghost")}
              >
                Back
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="cfp-control"
              disabled={submit.isPending}
              onClick={advance}
              style={{ ...button("primary"), opacity: submit.isPending ? 0.6 : 1 }}
            >
              {step === last ? (submit.isPending ? "Submitting…" : "Submit proposal") : "Continue"}
            </button>
          </div>
        </div>
      </div>
      <Toasts
        toasts={toasts}
        onClose={(id) => setToasts((current) => current.filter((entry) => entry.id !== id))}
      />
    </Shell>
  );
}
