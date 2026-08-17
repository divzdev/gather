"use client";

/** The scorecard a round is scored against.
 *
 *  `/admin/review` exists to set up review, and the rubric is the thing review
 *  is *for* — yet the screen only ever printed a criteria count read from the
 *  API, with nothing anywhere in the product able to write one. A round with no
 *  criteria gives reviewers a queue and no way to score it.
 *
 *  There is deliberately no delete. `review_scores` rows reference a criterion,
 *  so removing one would either orphan scores already given or destroy them;
 *  the API offers create and edit only, and the screen says why rather than
 *  offering a button that would fail.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authed } from "@/lib/session";

export type CriterionKind = "rating" | "select" | "text";

export type Criterion = {
  id: string;
  label: string;
  description: string | null;
  kind: CriterionKind;
  choices: { value: number; label: string }[];
  scale_min: number;
  scale_max: number;
  weight: string;
  is_required: boolean;
  sort_order: number;
};

/** The three things a scorecard question can be. The model has carried all
 *  three since the schema; this editor only ever offered the first, so an
 *  organiser who wanted "Accept / Maybe / Reject" had to fake it with numbers
 *  and one who wanted a written answer could not ask for one at all. */
const KINDS: { value: CriterionKind; label: string; hint: string }[] = [
  { value: "rating", label: "Rating", hint: "A number on a scale. Enters the weighted mean." },
  {
    value: "select",
    label: "Dropdown",
    hint: "A named choice with a value behind it. Enters the mean.",
  },
  {
    value: "text",
    label: "Free text",
    hint: "A written answer. Carries no number and never enters the mean.",
  },
];

/** "Strong accept = 5" written the way an organiser types it. */
function parseChoices(text: string): { value: number; label: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line, index) => {
      const at = line.lastIndexOf("=");
      if (at === -1) return { value: index + 1, label: line };
      const value = Number(line.slice(at + 1).trim());
      return {
        value: Number.isNaN(value) ? index + 1 : value,
        label: line.slice(0, at).trim(),
      };
    });
}

const field: React.CSSProperties = {
  boxSizing: "border-box",
  height: "var(--control-h-md, 44px)",
  padding: "0 13px",
  borderRadius: 10,
  border: "1px solid var(--ls)",
  background: "var(--cd)",
  color: "var(--ik)",
  font: "400 13.5px var(--font-plex-sans)",
};

const label: React.CSSProperties = {
  display: "block",
  font: "500 11.5px var(--font-plex-sans)",
  color: "var(--i3)",
  marginBottom: 5,
};

export function RubricEditor({ eventId, roundId }: { eventId: string; roundId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scale, setScale] = useState("5");
  const [weight, setWeight] = useState("1");
  const [kind, setKind] = useState<CriterionKind>("rating");
  const [choices, setChoices] = useState("Strong accept = 5\nMaybe = 3\nReject = 1");
  const [problem, setProblem] = useState("");

  const key = ["rubric", eventId, roundId];
  const { data: criteria, isPending } = useQuery({
    queryKey: key,
    enabled: open,
    queryFn: () => authed<Criterion[]>(`/events/${eventId}/review-rounds/${roundId}/criteria`),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ["round-plans", eventId] });
  };

  const add = useMutation({
    mutationFn: () =>
      authed<Criterion>(`/events/${eventId}/review-rounds/${roundId}/criteria`, {
        method: "POST",
        body: {
          label: name.trim(),
          kind,
          // A text criterion has no scale and no weight in any meaningful
          // sense — it is excluded from the mean — so sending 1 keeps the
          // API's validation happy without implying it counts.
          ...(kind === "select" ? { choices: parseChoices(choices) } : {}),
          scale_min: 1,
          scale_max: kind === "rating" ? Number(scale) : 5,
          weight: kind === "text" ? "0.00" : Number(weight).toFixed(2),
          sort_order: criteria?.length ?? 0,
        },
      }),
    onSuccess: () => {
      setName("");
      setProblem("");
      refresh();
    },
    onError: (error: Error) => setProblem(error.message),
  });

  const edit = useMutation({
    mutationFn: (change: { id: string; body: Record<string, unknown> }) =>
      authed(`/events/${eventId}/review-rounds/${roundId}/criteria/${change.id}`, {
        method: "PATCH",
        body: change.body,
      }),
    onSuccess: refresh,
    onError: (error: Error) => setProblem(error.message),
  });

  const rows = [...(criteria ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const totalWeight = rows.reduce((sum, row) => sum + Number(row.weight), 0);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          height: "var(--control-h-sm, 36px)",
          padding: "0 15px",
          borderRadius: 999,
          border: "1px solid var(--ls)",
          background: "var(--cd)",
          font: "500 12.5px var(--font-plex-sans)",
          color: "var(--i2)",
          cursor: "pointer",
        }}
      >
        Edit the rubric
      </button>
    );
  }

  return (
    <section
      style={{
        marginTop: 14,
        border: "1px solid var(--ln)",
        borderRadius: 12,
        background: "var(--cd)",
        padding: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
        <h3
          style={{
            font: "600 10.5px var(--font-plex-sans)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--i3)",
            margin: 0,
            flex: 1,
          }}
        >
          Rubric · what reviewers score against
        </h3>
        <button
          onClick={() => setOpen(false)}
          style={{
            height: "var(--control-h-sm, 36px)",
            padding: "0 14px",
            borderRadius: 999,
            border: "none",
            background: "none",
            font: "500 12.5px var(--font-plex-sans)",
            color: "var(--i3)",
            cursor: "pointer",
          }}
        >
          Done
        </button>
      </div>

      {isPending ? (
        <p style={{ font: "400 13px var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}>
          Loading the rubric…
        </p>
      ) : rows.length === 0 ? (
        <p
          style={{
            font: "400 13.5px/1.6 var(--font-plex-sans)",
            color: "var(--i2)",
            margin: "0 0 16px",
          }}
        >
          No criteria yet. Reviewers opening this round would get a queue and nothing to score it
          with — add at least one below.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          {rows.map((row) => (
            <div
              key={row.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                padding: "10px 12px",
                borderRadius: 10,
                background: "var(--sk)",
              }}
            >
              <span
                style={{
                  font: "500 13.5px var(--font-plex-sans)",
                  color: "var(--ik)",
                  flex: "1 1 180px",
                  minWidth: 0,
                }}
              >
                {row.label}
              </span>
              <span
                className="tabular"
                style={{ font: "400 12px var(--font-plex-mono)", color: "var(--i3)" }}
              >
                {row.kind === "rating"
                  ? `${row.scale_min}–${row.scale_max}`
                  : row.kind === "select"
                    ? `${row.choices.length} choices`
                    : "free text"}
              </span>
              {/* A text criterion has no weight to set: it carries no number and
                  is excluded from the mean, so a weight box on it would be a
                  control that changes nothing. */}
              {row.kind === "text" ? null : (
                <label style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ font: "400 12px var(--font-plex-sans)", color: "var(--i3)" }}>
                    weight
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="9"
                    step="0.5"
                    defaultValue={Number(row.weight)}
                    aria-label={`Weight for ${row.label}`}
                    onBlur={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isNaN(next) || next === Number(row.weight)) return;
                      edit.mutate({ id: row.id, body: { weight: next.toFixed(2) } });
                    }}
                    style={{ ...field, width: 78, height: "var(--control-h-sm, 36px)" }}
                  />
                </label>
              )}
              <button
                role="checkbox"
                aria-checked={row.is_required}
                onClick={() => edit.mutate({ id: row.id, body: { is_required: !row.is_required } })}
                style={{
                  height: "var(--control-h-sm, 36px)",
                  padding: "0 13px",
                  borderRadius: 999,
                  cursor: "pointer",
                  font: "500 12px var(--font-plex-sans)",
                  border: `1px solid ${row.is_required ? "var(--sl)" : "var(--ls)"}`,
                  background: row.is_required ? "var(--sw)" : "var(--cd)",
                  color: row.is_required ? "var(--sg)" : "var(--i3)",
                }}
              >
                {row.is_required ? "✓ required" : "optional"}
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px" }}>
          <label htmlFor={`crit-${roundId}`} style={label}>
            Add a criterion
          </label>
          <input
            id={`crit-${roundId}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Relevance to the track"
            style={{ ...field, width: "100%" }}
          />
        </div>
        <div>
          <label htmlFor={`kind-${roundId}`} style={label}>
            Answer type
          </label>
          <select
            id={`kind-${roundId}`}
            value={kind}
            onChange={(event) => setKind(event.target.value as CriterionKind)}
            style={{ ...field, width: 128 }}
          >
            {KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {kind !== "rating" ? null : (
          <div>
            <label htmlFor={`scale-${roundId}`} style={label}>
              Top of scale
            </label>
            <select
              id={`scale-${roundId}`}
              value={scale}
              onChange={(event) => setScale(event.target.value)}
              style={{ ...field, width: 92 }}
            >
              {["3", "5", "10"].map((value) => (
                <option key={value} value={value}>
                  1–{value}
                </option>
              ))}
            </select>
          </div>
        )}
        {kind === "text" ? null : (
          <div>
            <label htmlFor={`weight-${roundId}`} style={label}>
              Weight
            </label>
            <input
              id={`weight-${roundId}`}
              type="number"
              min="0"
              max="9"
              step="0.5"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
              style={{ ...field, width: 88 }}
            />
          </div>
        )}
        <button
          disabled={name.trim() === "" || add.isPending}
          onClick={() => add.mutate()}
          style={{
            height: "var(--control-h-md, 44px)",
            padding: "0 20px",
            borderRadius: 999,
            border: "none",
            background: name.trim() === "" ? "var(--ls)" : "var(--bt)",
            color: name.trim() === "" ? "var(--i3)" : "var(--bf)",
            font: "600 13.5px var(--font-plex-sans)",
            cursor: name.trim() === "" ? "not-allowed" : "pointer",
          }}
        >
          {add.isPending ? "Adding…" : "Add"}
        </button>
      </div>

      {kind !== "select" ? null : (
        <div style={{ marginTop: 12 }}>
          <label htmlFor={`choices-${roundId}`} style={label}>
            The choices, one per line
          </label>
          <textarea
            id={`choices-${roundId}`}
            value={choices}
            onChange={(event) => setChoices(event.target.value)}
            rows={4}
            style={{
              ...field,
              width: "100%",
              maxWidth: 420,
              height: "auto",
              padding: "10px 13px",
              lineHeight: 1.5,
              resize: "vertical",
            }}
          />
          <p
            style={{
              font: "400 12px/1.6 var(--font-plex-sans)",
              color: "var(--i3)",
              margin: "6px 0 0",
            }}
          >
            {"Write them as "}
            <code>Strong accept = 5</code>
            {
              ". The number is what enters the weighted mean; leave it off and the choices count 1, 2, 3 in order."
            }
          </p>
        </div>
      )}

      <p
        style={{
          font: "400 12px/1.6 var(--font-plex-sans)",
          color: "var(--i3)",
          margin: "10px 0 0",
        }}
      >
        {KINDS.find((option) => option.value === kind)?.hint}
      </p>

      {problem !== "" && (
        <p
          role="alert"
          style={{ font: "400 13px var(--font-plex-sans)", color: "var(--cn)", margin: "12px 0 0" }}
        >
          {problem}
        </p>
      )}

      <p
        style={{
          font: "400 12px/1.6 var(--font-plex-sans)",
          color: "var(--i3)",
          margin: "14px 0 0",
        }}
      >
        {rows.length === 0
          ? "Weights are relative: a criterion at 2 counts twice one at 1."
          : `Weights are relative — these ${rows.length} sum to ${totalWeight.toFixed(1)}, and the score shown on a submission is their weighted mean. Editing wording or weight never touches scores already given; the mean simply recomputes. Criteria cannot be deleted, because reviews reference them.`}
      </p>
    </section>
  );
}
