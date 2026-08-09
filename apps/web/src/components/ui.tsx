"use client";

/** Shared console primitives, matching the prototypes' elevation pass:
 *  radius-14 cards with soft borders, 999 pills for actions, stat tiles. */

import type { CSSProperties, ReactNode } from "react";

export const card: CSSProperties = {
  background: "var(--cd, #FFFFFF)",
  border: "1px solid var(--ln, #E1E7E9)",
  borderRadius: 14,
};

export const pill: CSSProperties = {
  height: 32,
  padding: "0 16px",
  borderRadius: 999,
  border: "none",
  background: "var(--bt, #FF6B6B)",
  color: "var(--bf, #331313)",
  font: "600 12.5px var(--font-plex-sans), sans-serif",
};

export const quietPill: CSSProperties = {
  height: 32,
  padding: "0 14px",
  borderRadius: 999,
  border: "1px solid var(--ls, #C8D2D5)",
  background: "none",
  color: "var(--i2, #3E4E58)",
  font: "500 12.5px var(--font-plex-sans), sans-serif",
};

export function PageHead({
  title,
  summary,
  right,
}: {
  title: string;
  summary: string;
  right?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1
          style={{
            font: "600 24px var(--font-plex-sans), sans-serif",
            color: "var(--ik)",
            margin: 0,
          }}
        >
          {title}
        </h1>
        <p style={{ font: "400 13px var(--font-plex-sans)", color: "var(--i3)", margin: "6px 0 0" }}>
          {summary}
        </p>
      </div>
      {right}
    </div>
  );
}

export type Tile = { key: string; label: string; value: number; tone: "ik" | "cn" | "pd" | "ok" | "if" };

export function StatTiles({
  tiles,
  active,
  onSelect,
}: {
  tiles: Tile[];
  active: string | null;
  onSelect: (key: string | null) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${tiles.length}, minmax(0,1fr))`,
        gap: 12,
        marginBottom: 16,
      }}
    >
      {tiles.map((tile) => {
        const selected = active === tile.key;
        return (
          <button
            key={tile.key}
            type="button"
            onClick={() => onSelect(selected ? null : tile.key)}
            aria-pressed={selected}
            style={{
              ...card,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              textAlign: "left",
              borderColor: selected ? "var(--sg)" : "var(--ln)",
              boxShadow: selected ? "0 0 0 3px var(--sw)" : "none",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                flex: "none",
                background: `var(--${tile.tone === "ik" ? "sk" : `${tile.tone}w`})`,
              }}
            />
            <span style={{ minWidth: 0 }}>
              <span
                className="tabular"
                style={{
                  display: "block",
                  font: "600 19px var(--font-plex-sans), sans-serif",
                  color: `var(--${tile.tone})`,
                }}
              >
                {tile.value}
              </span>
              <span style={{ display: "block", font: "400 12px var(--font-plex-sans)", color: "var(--i3)" }}>
                {tile.label}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const TONE: Record<string, string> = {
  draft: "i3",
  submitted: "if",
  in_review: "pd",
  accepted: "ok",
  waitlisted: "pd",
  rejected: "cn",
  withdrawn: "i4",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = TONE[status] ?? "i3";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 9px",
        borderRadius: 999,
        background: `var(--${tone}w, var(--sk))`,
        color: `var(--${tone})`,
        font: "500 11.5px var(--font-plex-sans), sans-serif",
        whiteSpace: "nowrap",
      }}
    >
      {/* Colour is never the only signal: the dot has a label beside it. */}
      <span aria-hidden style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ ...card, padding: "48px 24px", textAlign: "center" }}>
      <p style={{ font: "600 15px var(--font-plex-sans)", color: "var(--ik)", margin: "0 0 6px" }}>
        {title}
      </p>
      <p style={{ font: "400 13px var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}>{body}</p>
    </div>
  );
}
