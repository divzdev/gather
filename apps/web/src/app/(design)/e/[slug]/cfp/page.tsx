"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { use, useEffect, useRef, useState } from "react";

import { Cfp, type CfpData } from "@/components/design/Cfp";
import { resolveVisibility, type FormSchema } from "@/lib/formLogic";
import { ApiError, apiFetch } from "@/lib/api";

type PublicForm = {
  event_name: string;
  event_slug: string;
  form_id: string;
  form_name: string;
  schema: FormSchema;
  closes_at: string | null;
  is_open: boolean;
  closed_reason: string | null;
};

/** Collected on the Speakers step, so it is not repeated in the proposal list. */
const SPEAKER_FIELDS = new Set(["speaker_bio"]);

const LINE_TYPES = new Set(["short_text", "url", "email", "number", "date"]);
const AREA_TYPES = new Set(["long_text"]);
const CHOICE_TYPES = new Set(["select", "radio", "multi_select", "checkbox_group"]);
const MULTI_TYPES = new Set(["multi_select", "checkbox_group"]);
const CONSENT_TYPES = new Set(["checkbox", "consent"]);
const HTML_INPUT: Record<string, string> = {
  url: "url",
  email: "email",
  number: "number",
  date: "date",
};

// Panel 0 is the welcome screen; the numbered rail starts at panel 1.
const STEPS = ["You", "Your proposal", "Speakers", "Review and submit"] as const;
const LAST = STEPS.length; // panel index of "Review and submit"
const DRAFT_KEY = "gather.cfp-draft";
const AUTOSAVE_MS = 20_000;

type Draft = {
  email: string;
  title: string;
  abstract: string;
  track: string;
  format: string;
  name: string;
  company: string;
  bio: string;
  coName: string;
  coEmail: string;
  hasCo: boolean;
  terms: boolean;
};

const EMPTY: Draft = {
  email: "",
  title: "",
  abstract: "",
  track: "",
  format: "",
  name: "",
  company: "",
  bio: "",
  coName: "",
  coEmail: "",
  hasCo: false,
  terms: false,
};

/** The submission's own title column, which the API needs alongside the answers. */
function titleFrom(values: Record<string, unknown>): string {
  const value = values["title"];
  return typeof value === "string" ? value : "";
}

const words = (text: string) => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);

/** The public call for papers. No account: the speaker's email is their
 *  identity, and an anonymous draft token lets them come back to an unfinished
 *  proposal. */
export default function CfpPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  // Answers are keyed by field, so a question the organiser adds needs no code.
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [visited, setVisited] = useState<number[]>([0]);
  const [savedAt, setSavedAt] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ t: string; field: string; step: number }[]>([]);
  const [toasts, setToasts] = useState<{ id: string; msg: string }[]>([]);
  const draftToken = useRef<string | null>(null);

  const { data: form } = useQuery({
    queryKey: ["cfp-form", slug],
    queryFn: () => apiFetch<PublicForm>(`/public/events/${slug}/cfp-form`),
  });

  const toast = (msg: string) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-2), { id, msg }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 6000);
  };

  const answers = () => ({ ...values, speaker_bio: draft.bio });

  const saveDraft = useMutation({
    mutationFn: async () => {
      if (draft.email.trim() === "" || title().trim() === "") return null;
      return apiFetch<{ code: string; draft_token: string }>(
        `/public/events/${slug}/submissions/draft`,
        {
          method: "POST",
          body: {
            form_id: form?.form_id,
            title: title(),
            answers: answers(),
            speaker_email: draft.email,
            speaker_name: draft.name || draft.email,
            draft_token: draftToken.current,
          },
        },
      );
    },
    onSuccess: (result) => {
      if (result === null) return;
      draftToken.current = result.draft_token;
      window.localStorage.setItem(DRAFT_KEY, result.draft_token);
      setSavedAt(new Intl.DateTimeFormat("en-GB", { timeStyle: "short" }).format(new Date()));
    },
  });

  const submit = useMutation({
    mutationFn: () =>
      apiFetch<{ code: string }>(
        `/public/events/${slug}/submissions`,
        {
          method: "POST",
          body: {
            form_id: form?.form_id,
            title: title(),
            answers: answers(),
            speaker_email: draft.email,
            speaker_name: draft.name,
            draft_token: draftToken.current,
          },
        },
      ),
    onSuccess: (result) => {
      setCode(result.code);
      window.localStorage.removeItem(DRAFT_KEY);
    },
    onError: (caught: Error) =>
      toast(caught instanceof ApiError ? caught.message : "Could not submit. Try again."),
  });

  useEffect(() => {
    // Autosave on the prototype's cadence, so a closed tab does not lose work.
    const timer = window.setInterval(() => saveDraft.mutate(), AUTOSAVE_MS);
    return () => window.clearInterval(timer);
  }, [saveDraft]);

  const set = <K extends keyof Draft>(key: K) =>
    (event: React.SyntheticEvent) => {
      const target = event.target as HTMLInputElement | HTMLTextAreaElement;
      setDraft((current) => ({ ...current, [key]: target.value }) as Draft);
    };

  const validate = (): typeof errors => {
    const found: typeof errors = [];
    if (draft.email.trim() === "") found.push({ t: "Your email address is required", field: "email", step: 1 });
    if (draft.abstract.trim() === "") found.push({ t: "An abstract is required", field: "abstract", step: 2 });
    if (draft.track === "") found.push({ t: "Pick a track", field: "track", step: 2 });
    if (draft.format === "") found.push({ t: "Pick a session format", field: "format", step: 2 });
    for (const field of visibleFields) {
      if (!requiredKeys.has(field.key)) continue;
      const value = values[field.key];
      const blank =
        value === undefined ||
        value === false ||
        (typeof value === "string" && value.trim() === "") ||
        (Array.isArray(value) && value.length === 0);
      if (blank) found.push({ t: `${field.label} is required`, field: field.key, step: 2 });
    }
    if (draft.name.trim() === "") found.push({ t: "Your name is required", field: "name", step: 3 });
    if (!draft.terms) found.push({ t: "Confirm you agree to the speaker terms", field: "terms", step: 0 });
    return found;
  };

  const advance = () => {
    if (step < LAST) {
      saveDraft.mutate();
      setStep((current) => current + 1);
      setVisited((current) => [...new Set([...current, step + 1])]);
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

  const title = () => titleFrom(values);

  const setValue = (key: string, value: unknown) =>
    setValues((current) => ({ ...current, [key]: value }));

  const schema = form?.schema;
  const { visible, required } = schema
    ? resolveVisibility(schema, values)
    : { visible: new Set<string>(), required: new Set<string>() };
  const requiredKeys = required;
  const visibleFields = (schema?.sections ?? [])
    .flatMap((section) => section.fields)
    .filter((field) => visible.has(field.key) && !SPEAKER_FIELDS.has(field.key));

  const invalid = (field: string) =>
    errors.some((entry) => entry.field === field) ? "#D8432B" : "#C8D2D5";

  const pill = (chosen: boolean) => ({
    bg: chosen ? "#FFEAE6" : "#FFFFFF",
    fg: chosen ? "#E04E4E" : "#3E4E58",
    bd: chosen ? "#E04E4E" : "#C8D2D5",
  });

  // A closed call shows the confirmation panel's shape with the server's reason,
  // rather than a wizard that cannot submit. The server clock decides; the
  // client only reports it.
  const closed = form !== undefined && !form.is_open;

  const screen: CfpData = {
    working: code === null && !closed,
    doneV: code !== null || closed,
    hasCode: code !== null,
    doneTitle: code !== null ? "Proposal received" : "Submissions are closed",
    doneNote:
      code !== null
        ? "Keep your code — it is how you check the status of this proposal."
        : (form?.closed_reason ?? "This call for papers is not accepting proposals."),
    code: code ?? "",
    copyCode: () => {
      if (code !== null) void navigator.clipboard.writeText(code);
      toast("Code copied. Keep it to check your status later.");
    },
    again: () => {
      setCode(null);
      setDraft(EMPTY);
      setStep(0);
      draftToken.current = null;
    },
    welcomeMsg:
      form === undefined
        ? "Loading the call for papers…"
        : form.is_open
          ? `Proposals for ${form.event_name}. No account needed — your email is your identity, and an unfinished draft waits for you.`
          : (form.closed_reason ?? "The call for papers is closed."),

    steps: STEPS.map((label, position) => {
      const index = position + 1;
      const done = visited.includes(index) && index < step;
      const active = index === step;
      return {
        n: label,
        mark: done ? "✓" : String(index),
        on: () => setStep(index),
        fg: active ? "#16232B" : "#6B7B84",
        wt: active ? "600" : "400",
        dotBg: active ? "#E04E4E" : done ? "#0E7A5F" : "transparent",
        dotFg: active || done ? "#FFFFFF" : "#6B7B84",
        dotBd:
          active || done ? "transparent" : "#C8D2D5",
      };
    }),
    p0: step === 0,
    p1: step === 1,
    p2: step === 2,
    p3: step === 3,
    p4: step === 4,
    back: () => setStep((current) => Math.max(0, current - 1)),
    canBack: step > 0,
    next: advance,
    nextLabel:
      step === LAST
        ? submit.isPending
          ? "Submitting…"
          : "Submit proposal"
        : "Continue",

    email: draft.email,
    onEmail: set("email"),
    emailBd: invalid("email"),
    name: draft.name,
    onName: set("name"),
    nameBd: invalid("name"),
    company: draft.company,
    onCompany: set("company"),
    bio: draft.bio,
    onBio: set("bio"),
    bioBd: invalid("bio"),

    fields: visibleFields.map((field) => {
      const value = values[field.key];
      const required = requiredKeys.has(field.key);
      const invalidHere = errors.some((entry) => entry.field === field.key);
      const border = invalidHere ? "#D8432B" : "#C8D2D5";
      const isMulti = MULTI_TYPES.has(field.type);
      const chosen = Array.isArray(value) ? value : [];
      return {
        label: field.label,
        reqD: required ? "inline" : "none",
        bd: border,
        placeholder: field.help_text ?? "",
        inputType: HTML_INPUT[field.type] ?? "text",
        isLine: LINE_TYPES.has(field.type),
        isArea: AREA_TYPES.has(field.type),
        isChoice: CHOICE_TYPES.has(field.type),
        isConsent: CONSENT_TYPES.has(field.type),
        value: typeof value === "string" ? value : "",
        onChange: (event: React.SyntheticEvent) =>
          setValue(field.key, (event.target as HTMLInputElement).value),
        onToggle: () => setValue(field.key, value !== true),
        tick: value === true ? "✓" : "",
        tickBg: value === true ? "#E04E4E" : "#FFFFFF",
        consentText: field.help_text ?? field.label,
        options: field.choices.map((choice) => {
          const picked = isMulti ? chosen.includes(choice.value) : value === choice.value;
          return {
            label: choice.label,
            on: () =>
              setValue(
                field.key,
                isMulti
                  ? picked
                    ? chosen.filter((entry) => entry !== choice.value)
                    : [...chosen, choice.value]
                  : choice.value,
              ),
            ...pill(picked),
          };
        }),
        hasCount: field.type === "long_text",
        count: `${words(typeof value === "string" ? value : "")} words`,
        hasHelp: field.help_text !== null && !LINE_TYPES.has(field.type),
        help: field.help_text ?? "",
      };
    }),

    hasCo: draft.hasCo,
    noCo: !draft.hasCo,
    addCo: () => setDraft((current) => ({ ...current, hasCo: true })),
    rmCo: () => setDraft((current) => ({ ...current, hasCo: false, coName: "", coEmail: "" })),
    coName: draft.coName,
    onCoName: set("coName"),
    coEmail: draft.coEmail,
    onCoEmail: set("coEmail"),

    tCk: draft.terms ? "✓" : "",
    tBg: draft.terms ? "#E04E4E" : "#FFFFFF",
    tBd: draft.terms ? "#E04E4E" : "#C8D2D5",
    togTerms: () => setDraft((current) => ({ ...current, terms: !current.terms })),

    summary: [
      { k: "Title", v: title() || "—", fg: "#16232B" },
      ...visibleFields
        .filter((field) => field.key !== "title" && CHOICE_TYPES.has(field.type))
        .map((field) => ({
          k: field.label,
          v: String(values[field.key] ?? "—"),
          fg: "#16232B",
        })),
      { k: "Speaker", v: draft.name || "—", fg: "#16232B" },
      { k: "Email", v: draft.email || "—", fg: "#3E4E58" },
    ],
    errors: errors.map((entry) => ({ t: entry.t, on: () => setStep(entry.step) })),
    errCount: errors.length,
    hasErrors: errors.length > 0,
    savedAt: savedAt === "" ? "Not saved yet" : `Saved ${savedAt}`,

    toasts: toasts.map((entry) => ({
      msg: entry.msg,
      onX: () => setToasts((current) => current.filter((x) => x.id !== entry.id)),
    })),
  };

  return <Cfp d={screen} />;
}
