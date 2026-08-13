"use client";

/** Writing one resource page, and seeing it as a speaker will.
 *
 *  Two block kinds, because the API has two: prose, and a piece of HTML the
 *  organiser got from somewhere else. The second is sanitised on the server at
 *  write time against an allowlist (`features/pages/service.py`) and never on
 *  render — so what comes back from a save is the truth, and the preview here
 *  shows the saved value rather than the typed one.
 */

import { useState } from "react";

export type Block = { type: "text"; text: string } | { type: "embed"; html: string };
export type Visibility = "draft" | "speakers_only" | "public";

export type PageDraft = {
  title: string;
  blocks: Block[];
  visibility: Visibility;
  is_pinned_in_portal: boolean;
  sort_order: number;
};

export const BLANK: PageDraft = {
  title: "",
  blocks: [],
  visibility: "draft",
  is_pinned_in_portal: false,
  sort_order: 0,
};

/** Named for who can read it, not for its state. "Draft" is the odd one out
 *  because it is the only value that means "nobody yet". */
export const VISIBILITY: { key: Visibility; label: string; hint: string }[] = [
  { key: "draft", label: "Draft", hint: "Only you. Nothing leaves the console." },
  { key: "speakers_only", label: "Speakers", hint: "On the Resources tab of the portal." },
  { key: "public", label: "Public", hint: "Anyone with the event's public link." },
];

const label: React.CSSProperties = {
  display: "block",
  font: "500 12px 'IBM Plex Sans',sans-serif",
  color: "var(--i2,#3E4E58)",
  marginBottom: 6,
};

const field: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--ls,#C8D2D5)",
  background: "var(--cd,#FFFFFF)",
  color: "var(--ik,#16232B)",
  font: "400 13.5px/1.6 'IBM Plex Sans',sans-serif",
};

const quiet: React.CSSProperties = {
  minHeight: 36,
  padding: "0 14px",
  borderRadius: 999,
  border: "1px solid var(--ls,#C8D2D5)",
  background: "transparent",
  color: "var(--i2,#3E4E58)",
  font: "500 12.5px 'IBM Plex Sans',sans-serif",
  cursor: "pointer",
};

export function PageEditor({
  draft,
  onChange,
}: {
  draft: PageDraft;
  onChange: (next: PageDraft) => void;
}) {
  const [preview, setPreview] = useState(false);

  const setBlock = (index: number, block: Block) =>
    onChange({ ...draft, blocks: draft.blocks.map((b, i) => (i === index ? block : b)) });

  const move = (index: number, by: number) => {
    const next = [...draft.blocks];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange({ ...draft, blocks: next });
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <label style={label} htmlFor="page-title">
          Title
        </label>
        <input
          id="page-title"
          style={{ ...field, height: 40, padding: "0 12px" }}
          value={draft.title}
          placeholder="Getting to the venue"
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
        />
      </div>

      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend style={{ ...label, marginBottom: 8 }}>Who can read it</legend>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {VISIBILITY.map((entry) => {
            const chosen = draft.visibility === entry.key;
            return (
              <label
                key={entry.key}
                title={entry.hint}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  minHeight: 40,
                  padding: "0 14px",
                  borderRadius: 10,
                  cursor: "pointer",
                  border: `1px solid ${chosen ? "var(--sg,#E04E4E)" : "var(--ln,#E1E7E9)"}`,
                  background: chosen ? "var(--sw,#FFEAE6)" : "transparent",
                  font: "500 13px 'IBM Plex Sans',sans-serif",
                  color: "var(--ik,#16232B)",
                }}
              >
                <input
                  type="radio"
                  name="page-visibility"
                  checked={chosen}
                  onChange={() => onChange({ ...draft, visibility: entry.key })}
                />
                {entry.label}
              </label>
            );
          })}
        </div>
        <p
          style={{
            font: "400 12.5px 'IBM Plex Sans',sans-serif",
            color: "var(--i3,#6B7B84)",
            margin: "8px 0 0",
          }}
        >
          {VISIBILITY.find((entry) => entry.key === draft.visibility)?.hint}
        </p>
      </fieldset>

      {/* Both controls carry a label above their input so they share a
          baseline. A bare inline checkbox beside a labelled number field sat
          half a line low, which reads as a mistake rather than a choice. */}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <span style={label}>In the portal</span>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              height: 40,
              font: "400 13.5px 'IBM Plex Sans',sans-serif",
              color: "var(--ik,#16232B)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={draft.is_pinned_in_portal}
              onChange={() =>
                onChange({ ...draft, is_pinned_in_portal: !draft.is_pinned_in_portal })
              }
            />
            Pin to the top
          </label>
        </div>
        <div>
          <label style={label} htmlFor="page-order">
            Order
          </label>
          <input
            id="page-order"
            type="number"
            style={{ ...field, height: 40, width: 88, padding: "0 12px", textAlign: "center" }}
            value={draft.sort_order}
            onChange={(event) =>
              onChange({ ...draft, sort_order: Number(event.target.value) || 0 })
            }
          />
        </div>
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ ...label, marginBottom: 0, marginRight: "auto" }}>Content</span>
          <button
            type="button"
            style={quiet}
            onClick={() =>
              onChange({ ...draft, blocks: [...draft.blocks, { type: "text", text: "" }] })
            }
          >
            + Text
          </button>
          <button
            type="button"
            style={quiet}
            onClick={() =>
              onChange({ ...draft, blocks: [...draft.blocks, { type: "embed", html: "" }] })
            }
          >
            + Embed
          </button>
          {draft.blocks.length > 0 && (
            <button type="button" style={quiet} onClick={() => setPreview((now) => !now)}>
              {preview ? "Edit" : "Preview"}
            </button>
          )}
        </div>

        {draft.blocks.length === 0 ? (
          <p
            style={{
              font: "400 13px 'IBM Plex Sans',sans-serif",
              color: "var(--i3,#6B7B84)",
              margin: 0,
              padding: "18px 0",
            }}
          >
            Empty. Add a paragraph, or paste an embed — a map, a video, a schedule table.
          </p>
        ) : preview ? (
          <PagePreview blocks={draft.blocks} />
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {draft.blocks.map((block, index) => (
              <div
                key={index}
                style={{
                  border: "1px solid var(--ln,#E1E7E9)",
                  borderRadius: 10,
                  padding: 14,
                  background: "var(--cd,#FFFFFF)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span
                    style={{
                      padding: "2px 9px",
                      borderRadius: 999,
                      font: "500 11px 'IBM Plex Sans',sans-serif",
                      background: "var(--sk,#EDF1F2)",
                      color: "var(--i2,#3E4E58)",
                      marginRight: "auto",
                    }}
                  >
                    {block.type === "text" ? "Text" : "Embed"}
                  </span>
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    style={{
                      ...quiet,
                      minHeight: 32,
                      padding: "0 10px",
                      opacity: index === 0 ? 0.4 : 1,
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={index === draft.blocks.length - 1}
                    onClick={() => move(index, 1)}
                    style={{
                      ...quiet,
                      minHeight: 32,
                      padding: "0 10px",
                      opacity: index === draft.blocks.length - 1 ? 0.4 : 1,
                    }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${block.type} block`}
                    onClick={() =>
                      onChange({ ...draft, blocks: draft.blocks.filter((_, i) => i !== index) })
                    }
                    style={{
                      ...quiet,
                      minHeight: 32,
                      padding: "0 12px",
                      color: "var(--cn,#D8432B)",
                    }}
                  >
                    Remove
                  </button>
                </div>

                {block.type === "text" ? (
                  <textarea
                    aria-label="Paragraph"
                    style={{ ...field, minHeight: 96 }}
                    value={block.text}
                    placeholder="Doors open at 08:30. Registration is in the west foyer."
                    onChange={(event) =>
                      setBlock(index, { type: "text", text: event.target.value })
                    }
                  />
                ) : (
                  <>
                    <textarea
                      aria-label="Embed HTML"
                      spellCheck={false}
                      style={{
                        ...field,
                        minHeight: 96,
                        font: "400 12.5px/1.6 'IBM Plex Mono',monospace",
                      }}
                      value={block.html}
                      placeholder={'<iframe src="https://..." title="Venue map"></iframe>'}
                      onChange={(event) =>
                        setBlock(index, { type: "embed", html: event.target.value })
                      }
                    />
                    <p
                      style={{
                        font: "400 12px 'IBM Plex Sans',sans-serif",
                        color: "var(--i3,#6B7B84)",
                        margin: "6px 0 0",
                      }}
                    >
                      Cleaned when you save: scripts, inline styles and event handlers are stripped,
                      and only https links survive. Save, then preview to see what a speaker gets.
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The portal's own rendering, so the preview is not a second opinion.
 *  Mirrors `PortalResources` in `app/portal/page.tsx`. */
export function PagePreview({ blocks }: { blocks: readonly Block[] }) {
  return (
    <div
      style={{
        border: "1px solid var(--ln,#E1E7E9)",
        borderRadius: 10,
        padding: 20,
        background: "var(--sk,#EDF1F2)",
      }}
    >
      {blocks.map((block, index) =>
        block.type === "text" ? (
          <p
            key={index}
            style={{
              font: "400 14px/1.7 'IBM Plex Sans',sans-serif",
              color: "var(--i2,#3E4E58)",
              whiteSpace: "pre-line",
              margin: "0 0 12px",
            }}
          >
            {block.text}
          </p>
        ) : (
          <div
            key={index}
            style={{ margin: "0 0 12px" }}
            // Server-sanitised on write against an allowlist, never here: a page
            // that reached the database dirty would be re-cleaned by every
            // reader or by none. See features/pages/service.py.
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
        ),
      )}
    </div>
  );
}
