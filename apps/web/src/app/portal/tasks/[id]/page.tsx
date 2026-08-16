"use client";

/** One form task, filled in (spec 0007).
 *
 *  Its own route rather than a drawer so a nudge email can link straight at the
 *  task, and so a long form on a phone is a page that scrolls rather than a
 *  panel scrolling inside a page that also scrolls.
 *
 *  The questions are drawn by the call for papers' own `Field` renderer and its
 *  logic evaluator. Reusing them is the point: two renderers for one schema
 *  engine is how "required" starts meaning different things on two screens.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Field, Problem, button } from "@/app/e/[slug]/cfp/fields";
import { resolveVisibility, type FormSchema } from "@/lib/formLogic";
import { portal } from "@/lib/session";

type TaskDetail = {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  is_required: boolean;
  due_at: string | null;
  status: string;
  form_response: Record<string, unknown> | null;
  schema: FormSchema | null;
};

/** The CFP renderer styles itself from the public site's `--e-*` family. The
 *  portal runs on the console family, so the wrapper maps one onto the other
 *  rather than forking `fields.tsx` into a second copy that drifts. */
const FIELD_TOKENS: React.CSSProperties = {
  ["--e-text" as string]: "var(--ik)",
  ["--e-muted" as string]: "var(--i3)",
  ["--e-faint" as string]: "var(--i4)",
  ["--e-raised" as string]: "var(--cd)",
  ["--e-edge" as string]: "var(--ln)",
  ["--e-edge-strong" as string]: "var(--ls)",
  ["--e-accent" as string]: "var(--bt)",
  ["--e-on-accent" as string]: "var(--bf)",
};

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const AUTOSAVE_MS = 20_000;

/** One frozen empty object, so "no answers yet" is a stable reference and does
 *  not retrigger every memo on each render. */
const EMPTY: Record<string, unknown> = Object.freeze({});

export default function TaskFormPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isPending, error } = useQuery({
    queryKey: ["portal-task", id],
    retry: false,
    queryFn: () => portal<TaskDetail>(`/tasks/${id}`),
  });

  const [typed, setTyped] = useState<Record<string, unknown> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);

  /* `null` means "nothing typed yet", and the saved answer is read straight
   * through rather than copied into state by an effect.
   *
   * Seeding via `useEffect` + `setState` was the obvious shape and the wrong
   * one: it renders once with an empty form before the effect runs, and it
   * needs `answers` in its own dependency list to avoid re-seeding over what
   * the speaker is typing — a loop guarded by a condition rather than by the
   * data flow. Deriving it has neither problem. */
  const answers = typed ?? data?.form_response ?? EMPTY;

  const schema = data?.schema ?? null;
  const resolution = useMemo(
    () =>
      schema === null
        ? { visible: new Set<string>(), required: new Set<string>() }
        : resolveVisibility(schema, answers),
    [schema, answers],
  );

  const autosave = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      portal<TaskDetail>(`/tasks/${id}`, {
        method: "PATCH",
        body: { form_response: body },
      }),
    onSuccess: () => setSavedAt(new Date().toLocaleTimeString()),
    // Deliberately silent. Autosave failing is not something to interrupt
    // someone mid-sentence about; Send reports for real, and the speaker has
    // lost nothing they can see.
    onError: () => undefined,
  });

  const send = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      portal<TaskDetail>(`/tasks/${id}`, {
        method: "PUT",
        body: { form_response: body },
      }),
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: ["portal-home"] });
      queryClient.setQueryData(["portal-task", id], row);
      router.push("/portal");
    },
    onError: (failed: Error & { field?: string }) => {
      setProblem(failed.message);
      if (failed.field !== undefined) setFieldErrors({ [failed.field]: failed.message });
    },
  });

  // A ref so the autosave timer always sees the latest answers without being
  // torn down and rebuilt on every keystroke. Written in an effect, never during
  // render — a ref mutated mid-render is a value React cannot see changing.
  const latest = useRef<Record<string, unknown>>(EMPTY);
  useEffect(() => {
    latest.current = answers;
  }, [answers]);

  useEffect(() => {
    if (schema === null) return;
    const timer = setInterval(() => {
      autosave.mutate(latest.current);
    }, AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, [schema, autosave]);

  const set = useCallback((key: string, value: unknown) => {
    // Falls back to the saved answer, so the first keystroke on a task the
    // speaker has already sent edits their answer rather than blanking it.
    setTyped((current) => ({ ...(current ?? data?.form_response ?? EMPTY), [key]: value }));
    setFieldErrors((current) => {
      if (current[key] === undefined) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, [data]);

  if (isPending) {
    return (
      <Shell>
        <p style={muted}>Loading this task…</p>
      </Shell>
    );
  }

  if (error !== null) {
    // The API distinguishes "the form was deleted" from "something broke", and
    // the speaker can act on the first, so it is shown rather than flattened.
    return (
      <Shell>
        <h1 style={heading}>This form is not available</h1>
        <p style={muted}>{error.message}</p>
        <BackLink />
      </Shell>
    );
  }

  if (data.kind !== "form" || schema === null) {
    return (
      <Shell>
        <h1 style={heading}>{data.name}</h1>
        <p style={muted}>This task is not a form. Open it from your task list instead.</p>
        <BackLink />
      </Shell>
    );
  }

  const done = data.status === "complete" || data.status === "submitted";

  return (
    <Shell>
      <BackLink />
      <h1 style={heading}>{data.name}</h1>
      <p style={muted}>
        {data.is_required ? "Required" : "Optional"}
        {data.due_at === null ? "" : ` · due ${DAY.format(new Date(data.due_at))}`}
        {done ? " · already sent — changing it sends it again" : ""}
      </p>
      {data.description === null ? null : (
        <p style={{ ...muted, marginTop: 12 }}>{data.description}</p>
      )}

      <form
        style={{ ...FIELD_TOKENS, display: "grid", gap: 24, marginTop: 28 }}
        onSubmit={(submitted) => {
          submitted.preventDefault();
          setProblem(null);
          send.mutate(answers);
        }}
      >
        {schema.sections.flatMap((section) =>
          section.fields
            .filter((field) => resolution.visible.has(field.key))
            .map((field) => (
              <Field
                key={field.key}
                field={field}
                value={answers[field.key]}
                required={resolution.required.has(field.key)}
                error={fieldErrors[field.key] ?? null}
                onChange={(value: unknown) => set(field.key, value)}
              />
            )),
        )}

        <Problem error={problem} />

        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <button type="submit" disabled={send.isPending} style={button("primary")}>
            {send.isPending ? "Sending…" : done ? "Send again" : "Send to the team"}
          </button>
          <span style={{ ...muted, margin: 0 }}>
            {savedAt === null ? "Saved as you type." : `Saved ${savedAt}`}
          </span>
        </div>
      </form>
    </Shell>
  );
}

const heading: React.CSSProperties = {
  font: "600 26px/1.2 var(--font-plex-sans)",
  letterSpacing: "-0.01em",
  color: "var(--ik)",
  margin: "16px 0 6px",
};

const muted: React.CSSProperties = {
  font: "400 13.5px/1.6 var(--font-plex-sans)",
  color: "var(--i3)",
  margin: 0,
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "32px 20px 80px" }}>{children}</main>
  );
}

function BackLink() {
  return (
    <a href="/portal" style={{ ...muted, textDecoration: "none", display: "inline-block" }}>
      ← Back to your tasks
    </a>
  );
}
