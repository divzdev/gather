"use client";

/** Conditional logic, which the product has always been able to run and never
 *  been able to write.
 *
 *  `LogicRule` is in the API schema with its own validation, `resolveVisibility`
 *  in `lib/formLogic.ts` evaluates it, and the public CFP honours it field by
 *  field — an engine wired end to end with no way in. `logic: []` was hardcoded
 *  where a new form is created.
 *
 *  Rules read as sentences because that is how an organiser thinks about them:
 *  *when Track is AI Engineering, show Demo URL*. The select boxes are the
 *  sentence, not a form describing one.
 */

import { useState } from "react";

import type { Field } from "@/components/forms/FieldEditor";
import { pill, quietPill } from "@/components/ui";

export type Rule = {
  field: string;
  operator: string;
  value: unknown;
  action: string;
  target: string;
};

const OPERATORS = [
  { value: "is", label: "is", needsValue: true },
  { value: "is_not", label: "is not", needsValue: true },
  { value: "is_empty", label: "is empty", needsValue: false },
  { value: "is_not_empty", label: "is answered", needsValue: false },
  { value: "gt", label: "is more than", needsValue: true },
  { value: "lt", label: "is less than", needsValue: true },
] as const;

const ACTIONS = [
  { value: "show", label: "show" },
  { value: "hide", label: "hide" },
  { value: "require", label: "require" },
] as const;

const CHOICE_TYPES = new Set(["select", "radio", "multi_select", "checkbox_group"]);

const control: React.CSSProperties = {
  boxSizing: "border-box",
  height: "var(--control-h-sm, 36px)",
  padding: "0 10px",
  borderRadius: 8,
  border: "1px solid var(--ls)",
  background: "var(--cd)",
  color: "var(--ik)",
  font: "400 13px var(--font-plex-sans)",
  maxWidth: 220,
};

const word: React.CSSProperties = {
  font: "400 13px var(--font-plex-sans)",
  color: "var(--i3)",
  whiteSpace: "nowrap",
};

function labelOf(fields: Field[], key: string): string {
  return fields.find((entry) => entry.key === key)?.label ?? key;
}

/** The rule `docs/APP_CONTEXT.md` states: a required field that logic can hide
 *  silently blocks submission, because the submitter can neither see it nor
 *  satisfy it. It is a warning rather than a refusal — the organiser may be
 *  about to make the field optional — but it must be said at the moment the
 *  combination is created, which is the only moment anyone is looking. */
export function hideWarnings(rules: Rule[], fields: Field[]): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    if (rule.action !== "hide") continue;
    const target = fields.find((entry) => entry.key === rule.target);
    if (target === undefined || !target.required) continue;
    out.push(
      `“${target.label}” is required but this rule can hide it. A submitter who never sees it cannot answer it, and the form will refuse to submit with no explanation. Make it optional, or hide something else.`,
    );
  }
  return out;
}

export function LogicEditor({
  fields,
  rules,
  onChange,
}: {
  fields: Field[];
  rules: Rule[];
  onChange: (next: Rule[]) => void;
}) {
  const [when, setWhen] = useState("");
  const [operator, setOperator] = useState<string>("is");
  const [value, setValue] = useState("");
  const [action, setAction] = useState<string>("show");
  const [target, setTarget] = useState("");
  const [problem, setProblem] = useState("");

  const source = fields.find((entry) => entry.key === when) ?? null;
  const needsValue = OPERATORS.find((entry) => entry.value === operator)?.needsValue ?? true;
  const warnings = hideWarnings(rules, fields);

  const add = () => {
    if (when === "" || target === "") {
      setProblem("Pick the question to watch and the question to act on.");
      return;
    }
    // The API refuses this too; being told here costs no round trip.
    if (when === target) {
      setProblem("A rule cannot act on the question it is watching.");
      return;
    }
    if (needsValue && value.trim() === "") {
      setProblem("Say what the answer has to be.");
      return;
    }
    setProblem("");
    onChange([
      ...rules,
      { field: when, operator, value: needsValue ? value.trim() : null, action, target },
    ]);
    setValue("");
    setTarget("");
  };

  if (fields.length < 2) {
    return (
      <p style={{ font: "400 13px/1.6 var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}>
        Conditional logic needs at least two questions — one to watch and one to act on.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {rules.length === 0 ? (
        <p style={{ font: "400 13px/1.6 var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}>
          Every question is shown to everyone. Add a rule to show, hide or require one based on an
          earlier answer.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {rules.map((rule, index) => (
            <div
              key={`${rule.field}-${rule.target}-${index}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                padding: "10px 12px",
                borderRadius: 10,
                background: "var(--sk)",
              }}
            >
              <span
                style={{ font: "400 13px/1.5 var(--font-plex-sans)", color: "var(--ik)", flex: 1 }}
              >
                When <strong>{labelOf(fields, rule.field)}</strong>{" "}
                {OPERATORS.find((entry) => entry.value === rule.operator)?.label ?? rule.operator}
                {rule.value === null || rule.value === "" ? "" : ` “${String(rule.value)}”`},{" "}
                <strong>{rule.action}</strong> {labelOf(fields, rule.target)}
              </span>
              <button
                style={{ ...quietPill, height: "var(--control-h-sm, 36px)" }}
                onClick={() => onChange(rules.filter((_, at) => at !== index))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {warnings.map((message) => (
        <p
          key={message}
          role="alert"
          style={{
            font: "400 12.5px/1.6 var(--font-plex-sans)",
            color: "var(--pd)",
            background: "var(--pdw)",
            border: "1px solid var(--pdl)",
            borderRadius: 10,
            padding: "10px 13px",
            margin: 0,
          }}
        >
          {message}
        </p>
      ))}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={word}>When</span>
        <select
          aria-label="Question to watch"
          value={when}
          onChange={(event) => {
            setWhen(event.target.value);
            setValue("");
          }}
          style={control}
        >
          <option value="">pick a question</option>
          {fields.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Condition"
          value={operator}
          onChange={(event) => setOperator(event.target.value)}
          style={{ ...control, maxWidth: 140 }}
        >
          {OPERATORS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
        {needsValue &&
          (source !== null && CHOICE_TYPES.has(source.type) && source.choices.length > 0 ? (
            <select
              aria-label="Answer"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              style={control}
            >
              <option value="">pick an answer</option>
              {source.choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label="Answer"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="answer"
              style={control}
            />
          ))}
        <select
          aria-label="Action"
          value={action}
          onChange={(event) => setAction(event.target.value)}
          style={{ ...control, maxWidth: 120 }}
        >
          {ACTIONS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Question to act on"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          style={control}
        >
          <option value="">pick a question</option>
          {fields
            .filter((entry) => entry.key !== when)
            .map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
        </select>
        <button style={pill} onClick={add}>
          Add rule
        </button>
      </div>

      {problem !== "" && (
        <p
          role="alert"
          style={{ font: "400 12.5px var(--font-plex-sans)", color: "var(--cn)", margin: 0 }}
        >
          {problem}
        </p>
      )}

      <p style={{ font: "400 12px/1.6 var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}>
        Rules run in order and later ones win. A question no rule mentions is always shown.
      </p>
    </div>
  );
}
