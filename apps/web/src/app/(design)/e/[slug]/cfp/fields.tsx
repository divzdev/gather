"use client";

/** The schema-driven half of the call for papers.
 *
 *  Every control here is rendered from a `FormField`, so a question the
 *  organiser adds in the builder appears without a code change. The page owns
 *  the wizard, the answers and the validation; this file owns what one answer
 *  looks like.
 */

import type { FormField } from "@/lib/formLogic";

export const LINE_TYPES = new Set(["short_text", "url", "email", "number", "date"]);
export const AREA_TYPES = new Set(["long_text"]);
export const CHOICE_TYPES = new Set(["select", "radio", "multi_select", "checkbox_group"]);
export const MULTI_TYPES = new Set(["multi_select", "checkbox_group"]);
export const CONSENT_TYPES = new Set(["checkbox", "consent"]);

const HTML_INPUT: Record<string, string> = {
  url: "url",
  email: "email",
  number: "number",
  date: "date",
};

export const words = (text: string) => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);

/** Shared control geometry. Heights are the floors from
 *  `.claude/rules/design-standards.md`, not the prototype's 28px defaults. */
export const CONTROL = {
  input: {
    width: "100%",
    boxSizing: "border-box",
    height: 46,
    padding: "0 15px",
    borderRadius: 10,
    border: "1px solid var(--e-edge-strong, rgba(255,255,255,.18))",
    background: "var(--e-raised, #101018)",
    color: "var(--e-text, #F3F4F8)",
    font: "400 15px var(--font-manrope), sans-serif",
  },
  label: {
    display: "block",
    font: "500 13px var(--font-manrope), sans-serif",
    color: "var(--e-muted, #9A9FB1)",
    marginBottom: 8,
  },
} satisfies Record<string, React.CSSProperties>;

export const AREA: React.CSSProperties = {
  ...CONTROL.input,
  height: "auto",
  minHeight: 148,
  padding: "13px 15px",
  lineHeight: 1.6,
  resize: "vertical",
};

/** Buttons carry weight in proportion to what they do: the one irreversible
 *  action on the screen is the tallest thing on it. */
export function button(kind: "primary" | "secondary" | "ghost"): React.CSSProperties {
  const base: React.CSSProperties = {
    height: kind === "primary" ? 50 : 46,
    padding: kind === "ghost" ? "0 16px" : "0 24px",
    borderRadius: 999,
    font: `600 ${kind === "primary" ? 15 : 14}px var(--font-manrope), sans-serif`,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
  if (kind === "primary")
    return { ...base, border: "none", background: "var(--e-accent, #FF6B6B)", color: "var(--e-on-accent, #331313)" };
  if (kind === "secondary")
    return {
      ...base,
      border: "1px solid var(--e-edge-strong, rgba(255,255,255,.18))",
      background: "var(--e-raised, #101018)",
      color: "var(--e-muted, #9A9FB1)",
    };
  return { ...base, border: "none", background: "none", color: "var(--e-muted, #9A9FB1)" };
}

export type FieldProps = {
  field: FormField;
  value: unknown;
  required: boolean;
  error: string | null;
  onChange: (value: unknown) => void;
};

/** A word count is what the organiser asked for ("150-400 words"); a character
 *  count only matters as you approach the ceiling the API will reject at. */
function counter(field: FormField, text: string): { text: string; over: boolean } | null {
  const max = field.max_length ?? null;
  if (max !== null && text.length > max * 0.8)
    return { text: `${text.length} / ${max} characters`, over: text.length > max };
  if (AREA_TYPES.has(field.type)) return { text: `${words(text)} words`, over: false };
  return null;
}

export function Field({ field, value, required, error, onChange }: FieldProps) {
  const id = `f-${field.key}`;
  const text = typeof value === "string" ? value : "";
  const chosen = Array.isArray(value) ? (value as string[]) : [];
  const isMulti = MULTI_TYPES.has(field.type);
  const border = error !== null ? "var(--cn)" : "var(--e-edge-strong, rgba(255,255,255,.18))";
  const count = counter(field, text);

  const help =
    field.help_text !== null && field.help_text !== "" ? (
      <p
        id={`${id}-help`}
        style={{
          font: "400 13px/1.55 var(--font-manrope), sans-serif",
          color: "var(--e-muted, #9A9FB1)",
          margin: "0 0 10px",
        }}
      >
        {field.help_text}
      </p>
    ) : null;

  if (CONSENT_TYPES.has(field.type))
    return (
      <div>
        <Consent
          checked={value === true}
          error={error}
          label={field.help_text ?? field.label}
          onToggle={() => onChange(value !== true)}
        />
        <Problem error={error} />
      </div>
    );

  return (
    <div>
      <label htmlFor={id} style={CONTROL.label}>
        {field.label}
        {required ? <span style={{ color: "var(--e-accent, #FF6B6B)" }}> *</span> : <Optional />}
      </label>
      {help}

      {LINE_TYPES.has(field.type) && (
        <input
          id={id}
          className="cfp-control"
          type={HTML_INPUT[field.type] ?? "text"}
          value={text}
          aria-invalid={error !== null}
          aria-describedby={field.help_text ? `${id}-help` : undefined}
          onChange={(event) => onChange(event.target.value)}
          style={{ ...CONTROL.input, borderColor: border }}
        />
      )}

      {AREA_TYPES.has(field.type) && (
        <textarea
          id={id}
          className="cfp-control"
          value={text}
          aria-invalid={error !== null}
          aria-describedby={field.help_text ? `${id}-help` : undefined}
          onChange={(event) => onChange(event.target.value)}
          style={{ ...AREA, borderColor: border }}
        />
      )}

      {CHOICE_TYPES.has(field.type) && (
        <div
          role={isMulti ? "group" : "radiogroup"}
          aria-label={field.label}
          style={{ display: "flex", flexWrap: "wrap", gap: 10 }}
        >
          {field.choices.map((choice) => {
            const picked = isMulti ? chosen.includes(choice.value) : value === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                role={isMulti ? "checkbox" : "radio"}
                aria-checked={picked}
                className="cfp-control"
                onClick={() =>
                  onChange(
                    isMulti
                      ? picked
                        ? chosen.filter((entry) => entry !== choice.value)
                        : [...chosen, choice.value]
                      : choice.value,
                  )
                }
                style={{
                  height: 44,
                  padding: "0 18px",
                  borderRadius: 999,
                  cursor: "pointer",
                  font: `${picked ? 600 : 400} 14px var(--font-manrope), sans-serif`,
                  border: `1px solid ${picked ? "var(--e-accent, #FF6B6B)" : error !== null ? "var(--cn)" : "var(--e-edge-strong, rgba(255,255,255,.18))"}`,
                  background: picked ? "color-mix(in srgb, var(--e-accent, #FF6B6B) 15%, transparent)" : "var(--e-raised, #101018)",
                  color: picked ? "var(--e-accent, #FF6B6B)" : "var(--e-muted, #9A9FB1)",
                }}
              >
                {picked ? "✓ " : ""}
                {choice.label}
              </button>
            );
          })}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 8,
          minHeight: 18,
        }}
      >
        <Problem error={error} style={{ margin: 0 }} />
        {count !== null && (
          <span
            className="tabular"
            style={{
              font: "400 12px ui-monospace,'SF Mono',Menlo,monospace, monospace",
              color: count.over ? "var(--cn)" : "var(--e-muted, #9A9FB1)",
              marginLeft: "auto",
            }}
          >
            {count.text}
          </span>
        )}
      </div>
    </div>
  );
}

export function Optional() {
  return (
    <span style={{ font: "400 12px var(--font-manrope), sans-serif", color: "var(--e-faint, #7C8093)" }}> optional</span>
  );
}

/** Per-field, under the field that failed, in words a human wrote. */
export function Problem({ error, style }: { error: string | null; style?: React.CSSProperties }) {
  if (error === null) return null;
  return (
    <p
      role="alert"
      style={{
        font: "400 13px var(--font-manrope), sans-serif",
        color: "var(--cn)",
        margin: "8px 0 0",
        ...style,
      }}
    >
      {error}
    </p>
  );
}

/** A 14px native tickbox is not a target. This is 26px inside a 44px row. */
export function Consent({
  checked,
  error,
  label,
  onToggle,
}: {
  checked: boolean;
  error: string | null;
  label: React.ReactNode;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className="cfp-control"
      onClick={onToggle}
      style={{
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
        width: "100%",
        minHeight: 44,
        padding: "12px 16px",
        borderRadius: 12,
        cursor: "pointer",
        textAlign: "left",
        background: checked ? "color-mix(in srgb, var(--e-accent, #FF6B6B) 15%, transparent)" : "var(--e-raised, #101018)",
        border: `1px solid ${checked ? "var(--e-edge-strong, rgba(255,255,255,.18))" : error !== null ? "var(--cn)" : "var(--e-edge, rgba(255,255,255,.10))"}`,
      }}
    >
      <span
        aria-hidden
        style={{
          flex: "none",
          width: 26,
          height: 26,
          borderRadius: 7,
          display: "grid",
          placeItems: "center",
          font: "600 14px var(--font-manrope), sans-serif",
          background: checked ? "var(--e-accent, #FF6B6B)" : "var(--e-raised, #101018)",
          color: "var(--e-on-accent, #331313)",
          border: `1px solid ${checked ? "var(--e-accent, #FF6B6B)" : "var(--e-edge-strong, rgba(255,255,255,.18))"}`,
        }}
      >
        {checked ? "✓" : ""}
      </span>
      <span
        style={{
          font: "400 14px/1.55 var(--font-manrope), sans-serif",
          color: "var(--e-muted, #9A9FB1)",
          paddingTop: 3,
        }}
      >
        {label}
      </span>
    </button>
  );
}
