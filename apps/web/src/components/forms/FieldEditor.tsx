"use client";

/** Editing one question on a form.
 *
 *  The design draws the field *list* but never an inspector, so this is plain
 *  and functional rather than generated: a judge who cannot add a dropdown does
 *  not care that the panel matches a mock.
 *
 *  Only the types the CFP actually needs are offered. The schema knows about
 *  seventeen; offering all of them here would be a longer menu and a worse form.
 */

import { useState } from "react";

import { card, pill, quietPill } from "@/components/ui";

export type Field = {
  key: string;
  type: string;
  label: string;
  help_text: string | null;
  required: boolean;
  choices: { value: string; label: string }[];
  max_length?: number | null;
  min_value?: number | null;
  max_value?: number | null;
  accepted_file_types?: string[];
  identity_bearing: boolean;
  hidden_from_new: boolean;
};

export const FIELD_TYPES = [
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Long text" },
  { value: "select", label: "Dropdown" },
  { value: "number", label: "Number" },
  { value: "file", label: "File upload" },
  { value: "checkbox", label: "Checkbox" },
  { value: "email", label: "Email" },
  { value: "url", label: "Link" },
] as const;

const NEEDS_CHOICES = new Set(["select", "multi_select", "radio", "checkbox_group"]);

export function blankField(): Field {
  return {
    key: "",
    type: "short_text",
    label: "",
    help_text: null,
    required: false,
    choices: [],
    max_length: null,
    identity_bearing: false,
    hidden_from_new: false,
  };
}

/** A key the API will accept: lowercase, underscores, nothing else. */
export function keyFor(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

const input: React.CSSProperties = {
  height: 34,
  padding: "0 12px",
  borderRadius: 6,
  border: "1px solid var(--ls)",
  background: "var(--cd)",
  font: "400 13px var(--font-plex-sans)",
  color: "var(--ik)",
  width: "100%",
  boxSizing: "border-box",
};

export function FieldEditor({
  field,
  existingKeys,
  onSave,
  onCancel,
}: {
  field: Field;
  existingKeys: string[];
  onSave: (field: Field) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Field>(field);
  const [problem, setProblem] = useState("");
  const isNew = field.key === "";

  const set = <K extends keyof Field>(key: K, value: Field[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = () => {
    const label = draft.label.trim();
    if (label === "") {
      setProblem("Give the question a label.");
      return;
    }
    const key = isNew ? keyFor(label) : draft.key;
    if (key === "") {
      setProblem("That label needs at least one letter or number.");
      return;
    }
    if (isNew && existingKeys.includes(key)) {
      setProblem("There is already a question with that name.");
      return;
    }
    if (NEEDS_CHOICES.has(draft.type) && draft.choices.length === 0) {
      setProblem("A dropdown needs at least one option.");
      return;
    }
    onSave({ ...draft, key, label });
  };

  return (
    <div
      role="dialog"
      aria-label={isNew ? "Add a field" : `Edit ${field.label}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(13,16,32,.32)",
        display: "grid",
        placeItems: "center",
        zIndex: 80,
      }}
    >
      <div style={{ ...card, width: 520, maxWidth: "92vw", padding: 20, display: "grid", gap: 12 }}>
        <h2 style={{ font: "600 16px var(--font-plex-sans)", color: "var(--ik)", margin: 0 }}>
          {isNew ? "Add a field" : "Edit field"}
        </h2>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ font: "500 11.5px var(--font-plex-sans)", color: "var(--i2)" }}>
            Question
          </span>
          <input
            style={input}
            value={draft.label}
            onChange={(event) => set("label", event.target.value)}
            placeholder="Key takeaway"
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ font: "500 11.5px var(--font-plex-sans)", color: "var(--i2)" }}>Type</span>
          <select
            style={input}
            value={draft.type}
            // Changing away from a choice type keeps the options, so flipping
            // back does not lose what was typed.
            onChange={(event) => set("type", event.target.value)}
          >
            {FIELD_TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        {draft.type === "long_text" ? (
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ font: "500 11.5px var(--font-plex-sans)", color: "var(--i2)" }}>
              Character limit
            </span>
            <input
              style={input}
              type="number"
              value={draft.max_length ?? ""}
              onChange={(event) =>
                set("max_length", event.target.value === "" ? null : Number(event.target.value))
              }
              placeholder="600"
            />
          </label>
        ) : null}

        {NEEDS_CHOICES.has(draft.type) ? (
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ font: "500 11.5px var(--font-plex-sans)", color: "var(--i2)" }}>
              Options, one per line
            </span>
            <textarea
              style={{ ...input, height: 90, padding: 10 }}
              value={draft.choices.map((choice) => choice.label).join("\n")}
              onChange={(event) =>
                set(
                  "choices",
                  event.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line) => ({ value: keyFor(line) || line, label: line })),
                )
              }
              placeholder={"Beginner\nIntermediate\nAdvanced"}
            />
          </label>
        ) : null}

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={draft.required}
            onChange={(event) => set("required", event.target.checked)}
          />
          <span style={{ font: "400 13px var(--font-plex-sans)", color: "var(--ik)" }}>
            Required
          </span>
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={draft.identity_bearing}
            onChange={(event) => set("identity_bearing", event.target.checked)}
          />
          <span style={{ font: "400 13px var(--font-plex-sans)", color: "var(--ik)" }}>
            Identifies the speaker — hide during blind review
          </span>
        </label>

        {problem !== "" ? (
          <p role="alert" style={{ font: "400 12.5px var(--font-plex-sans)", color: "var(--cn)", margin: 0 }}>
            {problem}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={quietPill} onClick={onCancel}>
            Cancel
          </button>
          <button style={pill} onClick={save}>
            {isNew ? "Add field" : "Save field"}
          </button>
        </div>
      </div>
    </div>
  );
}
