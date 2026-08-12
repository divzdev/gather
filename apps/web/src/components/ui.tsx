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
  // The floor from `.claude/rules/design-standards.md`. These two are the most
  // reused controls in the console, so this one number lifts most screens at
  // once — it was the single highest-leverage change in docs/UI_AUDIT.md.
  height: "var(--control-h-sm, 36px)",
  padding: "0 18px",
  borderRadius: 999,
  border: "none",
  background: "var(--bt, #FF6B6B)",
  color: "var(--bf, #331313)",
  font: "600 12.5px var(--font-plex-sans), sans-serif",
};

export const quietPill: CSSProperties = {
  height: "var(--control-h-sm, 36px)",
  padding: "0 16px",
  borderRadius: 999,
  border: "1px solid var(--ls, #C8D2D5)",
  background: "none",
  color: "var(--i2, #3E4E58)",
  font: "500 12.5px var(--font-plex-sans), sans-serif",
};

export function PageHead({
  title,
  summary,
  crumbs,
  icon,
  right,
}: {
  title: string;
  summary: string;
  /** Where this page sits, coarse to fine. The page itself is not repeated in
   *  the trail — the title directly beneath it already says that. */
  crumbs?: readonly string[];
  /** A mark for the screen, in a tile beside the title. Console surfaces read
   *  as one long column of identical headings otherwise, and the eye needs
   *  something other than a word to land on when moving between them. */
  icon?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 22 }}>
      {icon === undefined ? null : (
        <span
          aria-hidden
          style={{
            width: 44,
            height: 44,
            flex: "none",
            display: "grid",
            placeItems: "center",
            borderRadius: 12,
            background: "var(--sk)",
            border: "1px solid var(--ln)",
            color: "var(--sg)",
            // Optically level with the title's cap height rather than its box.
            marginTop: crumbs === undefined || crumbs.length === 0 ? 0 : 22,
          }}
        >
          {icon}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {crumbs === undefined || crumbs.length === 0 ? null : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              font: "500 11px var(--font-plex-mono), monospace",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--i4)",
              margin: "0 0 9px",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--sg)",
                flex: "none",
              }}
            />
            {crumbs.map((crumb, at) => (
              <span key={crumb} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                {at > 0 ? <span aria-hidden="true">&rsaquo;</span> : null}
                {crumb}
              </span>
            ))}
          </div>
        )}
        <h1
          style={{
            font: "600 30px/1.15 var(--font-plex-sans), sans-serif",
            letterSpacing: "-0.02em",
            color: "var(--ik)",
            margin: 0,
          }}
        >
          {title}
        </h1>
        <p
          style={{
            font: "400 14px/1.55 var(--font-plex-sans)",
            color: "var(--i3)",
            margin: "8px 0 0",
            maxWidth: "68ch",
          }}
        >
          {summary}
        </p>
      </div>
      {right}
    </div>
  );
}

/** The marks the console's own screens use in their `PageHead` tile. Drawn
 *  rather than imported so the header does not pull a whole icon package in for
 *  four glyphs, and so they match the rail's stroke weight exactly. */
export const PAGE_ICON = {
  program: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
      <path d="M2.5 8h15M7.5 8v8.5" />
    </svg>
  ),
  directory: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="10" cy="7" r="3" />
      <path d="M4 16.5c0-2.8 2.7-4.5 6-4.5s6 1.7 6 4.5" />
    </svg>
  ),
  profile: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="10" cy="10" r="7.5" />
      <circle cx="10" cy="8" r="2.6" />
      <path d="M5.2 15.6c1-1.9 2.7-2.9 4.8-2.9s3.8 1 4.8 2.9" />
    </svg>
  ),
  settings: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" />
    </svg>
  ),
} as const;

/** The same treatment for Settings, whose panels each carry their own heading
 *  rather than one page head. */
export const SETTINGS_ICON = {
  event: (
    <svg
      width="19"
      height="19"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <rect x="2.5" y="4" width="15" height="13" rx="2.5" />
      <path d="M2.5 8h15M6.8 2.5v3M13.2 2.5v3" />
    </svg>
  ),
  brand: (
    <svg
      width="19"
      height="19"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 2.5a7.5 7.5 0 0 0 0 15c1.4 0 1.9-.9 1.4-1.8-.6-1 .1-2.2 1.3-2.2h1.1a3.7 3.7 0 0 0 3.7-3.7C17.5 5.6 14.1 2.5 10 2.5Z" />
    </svg>
  ),
  email: (
    <svg
      width="19"
      height="19"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <rect x="2.5" y="4.5" width="15" height="11" rx="2.5" />
      <path d="M3.4 6l6.6 4.6L16.6 6" />
    </svg>
  ),
  integrations: (
    <svg
      width="19"
      height="19"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M7.6 12.4 4.9 15a3 3 0 1 0 4.2 4.2M12.4 7.6 15 4.9" />
      <path d="M8.4 11.6a3.4 3.4 0 0 1 0-4.8l2.4-2.4a3.4 3.4 0 0 1 4.8 4.8l-2.4 2.4a3.4 3.4 0 0 1-4.8 0Z" />
    </svg>
  ),
} as const;

export type Tile = {
  key: string;
  label: string;
  value: number;
  tone: "ik" | "cn" | "pd" | "ok" | "if";
};

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
              <span
                style={{
                  display: "block",
                  font: "400 12px var(--font-plex-sans)",
                  color: "var(--i3)",
                }}
              >
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
      <span
        aria-hidden
        style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }}
      />
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  /** The way out of the empty state. An empty screen that only describes its
   *  own emptiness makes the reader go looking for the control that fills it. */
  action?: ReactNode;
}) {
  return (
    <div style={{ ...card, padding: "48px 24px", textAlign: "center" }}>
      <p style={{ font: "600 15px var(--font-plex-sans)", color: "var(--ik)", margin: "0 0 6px" }}>
        {title}
      </p>
      <p
        style={{
          font: "400 13px/1.6 var(--font-plex-sans)",
          color: "var(--i3)",
          margin: "0 auto",
          maxWidth: "46ch",
        }}
      >
        {body}
      </p>
      {action === undefined ? null : <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}

/** Every state a list's rows can be in, across the top of it.
 *
 *  The console reached seven submission statuses through a multi-select popover
 *  three controls in from the edge of the screen, so "show me the withdrawn
 *  ones" was a thing you had to already know how to do. A status you cannot see
 *  is a status nobody looks at.
 */
export function StatusTabs({
  tabs,
  allCount,
  active,
  onSelect,
}: {
  tabs: readonly { key: string; label: string; count: number | string }[];
  //: A dash while the counts are still loading — a tab that says 0 before it
  //: knows is asserting the status is empty.
  allCount: number | string;
  /** null is the "All" tab — no status filter at all. */
  active: string | null;
  onSelect: (key: string | null) => void;
}) {
  /** Empty is a real answer and it is not the same answer as "some". A status
   *  with nothing in it stays visible — the point of the strip is that no state
   *  is hidden — but at the weight of a thing there is no reason to click. */
  const tab = (selected: boolean, empty: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 7,
    height: "var(--control-h-sm, 36px)",
    padding: "0 14px",
    borderRadius: 999,
    border: "1px solid transparent",
    background: selected ? "var(--sw)" : "transparent",
    borderColor: selected ? "var(--sl)" : "transparent",
    color: selected ? "var(--sg)" : empty ? "var(--i4)" : "var(--i2)",
    font: `${selected ? 600 : 500} 12.5px var(--font-plex-sans), sans-serif`,
    whiteSpace: "nowrap",
    cursor: "pointer",
  });

  return (
    <div
      role="tablist"
      aria-label="Filter by status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        // Narrow windows scroll the strip rather than wrapping it into a second
        // row that pushes the table down.
        overflowX: "auto",
        borderBottom: "1px solid var(--ln)",
        padding: "0 0 8px",
        marginBottom: 14,
      }}
    >
      {[{ key: "", label: "All", count: allCount }, ...tabs].map((entry) => {
        const key = entry.key === "" ? null : entry.key;
        const selected = active === key;
        const empty = entry.count === 0;
        return (
          <button
            key={entry.label}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(selected ? null : key)}
            style={tab(selected, empty)}
          >
            {entry.label}
            <span
              className="tabular"
              style={{
                minWidth: 20,
                textAlign: "center",
                padding: "2px 7px",
                borderRadius: 999,
                background: selected ? "var(--cd)" : empty ? "transparent" : "var(--sk)",
                color: selected ? "var(--sg)" : empty ? "var(--i4)" : "var(--i2)",
                font: "600 11px var(--font-plex-mono), monospace",
              }}
            >
              {entry.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The footer every paged list ends with.
 *
 *  The console had no pagination at all: each screen asked for a fixed page of
 *  100 or 200 rows and rendered whatever came back, so Submissions read "200 of
 *  608 matching" and the other 408 were unreachable. The API has carried
 *  `meta {total, page, per_page, pages}` since the first migration — the
 *  frontend simply threw it away.
 */
export function Pager({
  page,
  perPage,
  total,
  onPage,
  onPerPage,
  noun = "rows",
}: {
  page: number;
  perPage: number;
  total: number;
  onPage: (next: number) => void;
  onPerPage: (next: number) => void;
  noun?: string;
}) {
  const pages = perPage > 0 ? Math.max(1, Math.ceil(total / perPage)) : 1;
  const first = total === 0 ? 0 : (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);

  // A window around the current page. Six hundred rows is twenty-five pages,
  // and twenty-five buttons is not navigation.
  const window: number[] = [];
  for (let at = Math.max(1, page - 2); at <= Math.min(pages, page + 2); at += 1) window.push(at);

  const step: CSSProperties = {
    minWidth: "var(--control-h-sm, 36px)",
    height: "var(--control-h-sm, 36px)",
    padding: "0 10px",
    borderRadius: 8,
    border: "1px solid var(--ls)",
    background: "var(--cd)",
    color: "var(--i2)",
    font: "500 12.5px var(--font-plex-sans)",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        padding: "14px 2px 0",
        borderTop: "1px solid var(--ln)",
        marginTop: 14,
      }}
    >
      <span style={{ font: "400 12px var(--font-plex-mono)", color: "var(--i3)" }}>
        {total === 0 ? `No ${noun}` : `${first} — ${last} of ${total} ${noun}`}
      </span>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          type="button"
          style={{ ...step, opacity: page <= 1 ? 0.45 : 1 }}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          ‹
        </button>
        {window[0] !== undefined && window[0] > 1 ? (
          <span style={{ font: "400 12px var(--font-plex-mono)", color: "var(--i4)" }}>…</span>
        ) : null}
        {window.map((at) => (
          <button
            type="button"
            key={at}
            onClick={() => onPage(at)}
            aria-label={`Page ${at}`}
            aria-current={at === page ? "page" : undefined}
            style={{
              ...step,
              background: at === page ? "var(--sw)" : "var(--cd)",
              borderColor: at === page ? "var(--sl)" : "var(--ls)",
              color: at === page ? "var(--sg)" : "var(--i2)",
              fontWeight: at === page ? 700 : 500,
            }}
          >
            {at}
          </button>
        ))}
        {window[window.length - 1] !== undefined && window[window.length - 1]! < pages ? (
          <span style={{ font: "400 12px var(--font-plex-mono)", color: "var(--i4)" }}>…</span>
        ) : null}
        <button
          type="button"
          style={{ ...step, opacity: page >= pages ? 0.45 : 1 }}
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          ›
        </button>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ font: "400 12px var(--font-plex-sans)", color: "var(--i3)" }}>Show</span>
        <select
          value={perPage}
          onChange={(event) => onPerPage(Number(event.target.value))}
          aria-label="Rows per page"
          style={{
            height: "var(--control-h-sm, 36px)",
            padding: "0 10px",
            borderRadius: 8,
            border: "1px solid var(--ls)",
            background: "var(--cd)",
            color: "var(--ik)",
            font: "500 12.5px var(--font-plex-sans)",
          }}
        >
          {/* 200 is the API's MAX_PER_PAGE; offering more would 422. */}
          {[25, 50, 100, 200].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
