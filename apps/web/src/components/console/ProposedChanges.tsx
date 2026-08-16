"use client";

/** The changes the assistant is offering, and the only way to make them.
 *
 *  Split out of `AssistantDrawer` because it is self-contained and that file was
 *  well past the 400-line limit. Deliberately verbose about what each change
 *  will do: this is the last thing read before a row exists, and the whole
 *  safety argument of spec 0008 is that a wrong proposal is caught here, by a
 *  person, reading. A card that said "Create room" and nothing else would be a
 *  button with no label.
 */

import type { ProposedAction } from "@/lib/ask";

/** Values as a person reads them, not as JSON. `capacity: 60` is a field name
 *  leaking; "capacity 60" is a sentence. */
function readable(key: string, value: unknown): string {
  const label = key.replace(/_/g, " ").replace(/ local$/, "");
  if (value === null || value === undefined || value === "") return `${label} cleared`;
  if (typeof value === "boolean") return value ? label : `not ${label}`;
  return `${label} ${String(value)}`;
}

/** The changes on offer, and the only way to make them.
 *
 *  Deliberately verbose about what each one will do: this is the last thing read
 *  before a row exists, and the whole safety argument of the feature is that a
 *  wrong proposal is caught here, by a person, reading. A card that said
 *  "Create room" and nothing else would be a button with no label.
 */
export function Changes({
  actions,
  onApply,
  onDiscard,
  discarded,
  isPending,
}: {
  actions: ProposedAction[];
  onApply: (chosen: ProposedAction[]) => void;
  onDiscard: () => void;
  discarded: boolean;
  isPending: (action: ProposedAction) => boolean;
}) {
  const unapplied = actions.filter((action) => action.status === "proposed");
  // Story 4: the verb matches what the button will do. "Apply all" over three
  // creates reads like a different feature.
  const verb = unapplied.every((action) => action.verb === "create") ? "Create" : "Apply";
  return (
    <div
      data-assistant-changes
      style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}
    >
      {actions.map((action) => (
        <Change
          key={action.index}
          action={action}
          pending={isPending(action)}
          discarded={discarded}
          onApply={() => onApply([action])}
        />
      ))}
      {discarded ? (
        <span
          style={{
            font: "400 12px var(--font-plex-sans),sans-serif",
            color: "var(--i4,#5e5e66)",
          }}
        >
          Discarded — nothing was changed.
        </span>
      ) : null}
      {unapplied.length > 1 && !discarded ? (
        <button
          type="button"
          onClick={() => onApply(unapplied)}
          style={{
            alignSelf: "flex-start",
            height: 36,
            padding: "0 16px",
            borderRadius: 999,
            border: "1px solid var(--ln,#e3e3e7)",
            background: "var(--cd,#fff)",
            color: "var(--ik,#141417)",
            font: "500 12.5px var(--font-plex-sans),sans-serif",
            cursor: "pointer",
          }}
        >
          {verb} all {unapplied.length}
        </button>
      ) : null}
      {unapplied.length > 0 && !discarded ? (
        <button
          type="button"
          onClick={onDiscard}
          style={{
            alignSelf: "flex-start",
            height: 36,
            padding: "0 14px",
            borderRadius: 999,
            border: "none",
            background: "transparent",
            color: "var(--i4,#5e5e66)",
            font: "500 12.5px var(--font-plex-sans),sans-serif",
            cursor: "pointer",
          }}
        >
          Discard {unapplied.length > 1 ? "these" : "this"}
        </button>
      ) : null}
    </div>
  );
}

function Change({
  action,
  pending,
  discarded,
  onApply,
}: {
  action: ProposedAction;
  pending: boolean;
  discarded: boolean;
  onApply: () => void;
}) {
  const applied = action.status === "applied";
  const failed = action.status === "failed";
  const changes = Object.entries(action.values);

  return (
    <div
      data-assistant-change
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 16,
        borderRadius: 12,
        border: `1px solid ${failed ? "var(--cnl,#f4c8d2)" : applied ? "var(--okl,#c3e3d3)" : "var(--ln,#e3e3e7)"}`,
        background: failed
          ? "var(--cnw,#fbeaee)"
          : applied
            ? "var(--okw,#e4f3ec)"
            : "var(--cd,#fff)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            font: "600 13px var(--font-plex-sans),sans-serif",
            color: "var(--ik,#141417)",
          }}
        >
          {applied
            ? `${action.verb === "create" ? "Created" : "Changed"} ${action.resource}`
            : `${action.verb === "create" ? "Create" : "Change"} ${action.resource}`}
        </span>
        {action.target !== null ? (
          <span
            style={{
              font: "500 12.5px var(--font-plex-mono),monospace",
              color: "var(--i2,#3f3f46)",
            }}
          >
            {action.target}
          </span>
        ) : null}
        {action.event ? (
          <span
            style={{
              font: "400 11.5px var(--font-plex-sans),sans-serif",
              color: "var(--i4,#5e5e66)",
            }}
          >
            in {action.event}
          </span>
        ) : null}
      </div>

      {/* What will actually be set. For an edit, with what it holds now, because
          approving `capacity 80` without seeing `60` is approving a sentence. */}
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
        {changes.map(([key, value]) => {
          const was = action.before[key];
          const moved = action.verb === "update" && was !== undefined;
          return (
            <li
              key={key}
              style={{
                font: "400 12.5px/1.5 var(--font-plex-sans),sans-serif",
                color: "var(--i2,#3f3f46)",
              }}
            >
              {moved ? (
                <>
                  {key.replace(/_/g, " ")}{" "}
                  <span style={{ color: "var(--i4,#5e5e66)" }}>
                    {was === null || was === "" ? "unset" : String(was)}
                  </span>{" "}
                  → <strong style={{ fontWeight: 600 }}>{String(value ?? "unset")}</strong>
                </>
              ) : (
                readable(key, value)
              )}
            </li>
          );
        })}
      </ul>

      {failed && action.error ? (
        <p
          style={{
            margin: 0,
            font: "400 12.5px/1.5 var(--font-plex-sans),sans-serif",
            color: "var(--cn,#b3243f)",
          }}
        >
          {action.error}
        </p>
      ) : null}

      {discarded && !applied ? null : applied ? (
        <span
          style={{
            alignSelf: "flex-start",
            padding: "4px 10px",
            borderRadius: 999,
            background: "var(--cd,#fff)",
            border: "1px solid var(--okl,#c3e3d3)",
            color: "var(--ok,#177a53)",
            font: "500 11px var(--font-plex-sans),sans-serif",
          }}
        >
          {action.label ? `Done · ${action.label}` : "Done"}
        </span>
      ) : (
        <button
          type="button"
          onClick={onApply}
          disabled={pending}
          style={{
            alignSelf: "flex-start",
            height: 36,
            padding: "0 18px",
            borderRadius: 999,
            border: "none",
            background: pending ? "var(--sk,#efeff2)" : "var(--bt,#141417)",
            color: pending ? "var(--i4,#5e5e66)" : "var(--bf,#fff)",
            font: "600 12.5px var(--font-plex-sans),sans-serif",
            cursor: pending ? "wait" : "pointer",
          }}
        >
          {pending
            ? action.verb === "create"
              ? "Creating…"
              : "Applying…"
            : failed
              ? "Try again"
              : action.verb === "create"
                ? "Create"
                : "Apply"}
        </button>
      )}
    </div>
  );
}
