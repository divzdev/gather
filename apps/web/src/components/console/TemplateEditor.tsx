"use client";

/** The message templates an event writes once and sends many times.
 *
 *  `features/messaging/templates.py` has shipped CRUD, a closed merge-field set
 *  and a per-recipient preview for a while, and nothing in the console read a
 *  line of it — this tab said "Template editing isn't built", which stopped
 *  being true and became a screen lying to an organiser about their own product.
 *
 *  Two things here are deliberate rather than decorative:
 *
 *  The merge fields are a **palette you click**, not a list you read. The API
 *  refuses an unknown token with a 422 naming the ones it knows, which is the
 *  right backstop — but a token you insert cannot be mistyped in the first
 *  place, and that is better than a good error message.
 *
 *  The preview runs against **a speaker you choose off this roster**. A merge
 *  field that resolves for a made-up example and breaks on the one speaker with
 *  no session is exactly the bug a preview exists to catch, so picking the
 *  awkward one has to be possible.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { ApiError } from "@/lib/api";
import { authed } from "@/lib/session";

export type Template = {
  id: string;
  name: string;
  purpose: string;
  subject: string;
  body_markdown: string;
};

type MergeField = { token: string; description: string };
type Preview = { speaker_name: string; subject: string; body: string };
type Roster = { speaker_id: string; name: string }[];

/** What a template is *for*. The API's own enum, minus the values that belong to
 *  a flow with its own fixed wording — a decision send renders API constants, so
 *  offering to template one here would be a second copy of that text with no
 *  path into what actually sends. */
const PURPOSES = [
  { value: "custom", label: "General" },
  { value: "task_reminder", label: "Task reminder" },
  { value: "portal_invite", label: "Portal invite" },
  { value: "schedule_change", label: "Schedule change" },
] as const;

const BLANK = { name: "", purpose: "custom", subject: "", body_markdown: "" };

const LABEL: React.CSSProperties = {
  display: "block",
  font: "500 11px 'IBM Plex Mono',monospace",
  letterSpacing: ".07em",
  textTransform: "uppercase",
  color: "var(--i3,#6B7B84)",
  marginBottom: 8,
};

const FIELD: React.CSSProperties = {
  width: "100%",
  minHeight: 40,
  padding: "0 14px",
  borderRadius: 10,
  border: "1px solid var(--ln,#E1E7E9)",
  background: "var(--cd,#FFFFFF)",
  color: "var(--ik,#16232B)",
  font: "400 14px 'IBM Plex Sans',sans-serif",
};

const CARD: React.CSSProperties = {
  background: "var(--cd,#FFFFFF)",
  border: "1px solid var(--ln,#E1E7E9)",
  borderRadius: 14,
  padding: 24,
};

function button(kind: "primary" | "secondary" | "ghost"): React.CSSProperties {
  return {
    height: 38,
    padding: "0 18px",
    borderRadius: 999,
    cursor: "pointer",
    font: "500 13px 'IBM Plex Sans',sans-serif",
    border: kind === "primary" ? "none" : "1px solid var(--ln)",
    background:
      kind === "primary" ? "var(--bt)" : kind === "secondary" ? "var(--cd)" : "none",
    color: kind === "primary" ? "var(--bf)" : "var(--ik)",
  };
}

export function TemplateEditor({
  eventId,
  toast,
}: {
  eventId: string;
  toast: (m: string) => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  /** Only what the organiser has actually typed. The rest is read off the saved
   *  row every render, so choosing a template needs no effect to copy it into
   *  state — and a refetch after saving cannot fight with what is on screen. */
  const [edits, setEdits] = useState<Partial<typeof BLANK>>({});
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** Which box a merge field lands in, so clicking one inserts where the
   *  organiser was last typing rather than always at the end of the body. */
  const focused = useRef<"subject" | "body">("body");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const templates = useQuery({
    queryKey: ["message-templates", eventId],
    queryFn: () => authed<Template[]>(`/events/${eventId}/message-templates`),
  });
  const fields = useQuery({
    queryKey: ["merge-fields", eventId],
    queryFn: () => authed<MergeField[]>(`/events/${eventId}/message-templates/merge-fields`),
  });
  const roster = useQuery({
    queryKey: ["roster-thin", eventId],
    queryFn: () => authed<Roster>(`/events/${eventId}/speakers?per_page=200`).catch(() => []),
  });
  const preview = useQuery({
    queryKey: ["template-preview", eventId, selected, previewFor],
    enabled: selected !== null,
    queryFn: () =>
      authed<Preview>(
        `/events/${eventId}/message-templates/${selected}/preview` +
          (previewFor === null ? "" : `?speaker_id=${previewFor}`),
      ),
  });

  const row = (templates.data ?? []).find((entry) => entry.id === selected) ?? null;
  const stored: typeof BLANK =
    row === null
      ? BLANK
      : {
          name: row.name,
          purpose: row.purpose,
          subject: row.subject,
          body_markdown: row.body_markdown,
        };
  const draft = { ...stored, ...edits };
  /** Record a change against what is on screen, so an edit to one field never
   *  drops an unsaved edit to another. */
  const edit = (patch: Partial<typeof BLANK>) => setEdits({ ...draft, ...patch });

  /** Choosing a template, or starting a new one, drops whatever was typed into
   *  the last one. Done here rather than in an effect: it is what the click
   *  means, not something to reconcile afterwards. */
  const choose = (id: string | null) => {
    setSelected(id);
    setEdits({});
    setProblem(null);
  };

  const save = useMutation({
    mutationFn: async () => {
      const path = `/events/${eventId}/message-templates${selected === null ? "" : `/${selected}`}`;
      return authed<Template>(path, { method: selected === null ? "POST" : "PATCH", body: draft });
    },
    onSuccess: async (saved) => {
      setProblem(null);
      setSelected(saved.id);
      setEdits({});
      await queryClient.invalidateQueries({ queryKey: ["message-templates", eventId] });
      await queryClient.invalidateQueries({ queryKey: ["template-preview", eventId] });
      toast(`Saved “${saved.name}”.`);
    },
    // The API refuses an unknown merge field by name. That message is the useful
    // one, so it goes on the field rather than into a toast that scrolls away.
    onError: (caught: Error) =>
      setProblem(caught instanceof ApiError ? caught.message : "That could not be saved."),
  });

  /** `token` arrives already wrapped — the API returns "{{speaker_name}}", not
   *  "speaker_name" — so wrapping it again here is how the chips ended up
   *  reading {{{{speaker_name}}}}. */
  const insert = (snippet: string) => {
    if (focused.current === "subject") {
      edit({ subject: `${draft.subject}${snippet}` });
      return;
    }
    const at = bodyRef.current?.selectionStart ?? draft.body_markdown.length;
    edit({
      body_markdown:
        draft.body_markdown.slice(0, at) + snippet + draft.body_markdown.slice(at),
    });
  };

  const rows = templates.data ?? [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,260px) minmax(0,1fr)", gap: 20 }}>
      <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
        <button
          type="button"
          style={{ ...button("primary"), justifySelf: "start" }}
          onClick={() => choose(null)}
        >
          New template
        </button>

        {templates.isLoading ? (
          <p style={{ font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--i3,#6B7B84)" }}>
            Loading templates…
          </p>
        ) : rows.length === 0 ? (
          <div style={{ ...CARD, padding: 20 }}>
            <p
              style={{
                font: "500 13.5px 'IBM Plex Sans',sans-serif",
                color: "var(--ik,#16232B)",
                margin: "0 0 6px",
              }}
            >
              No templates yet
            </p>
            <p
              style={{
                font: "400 13px/1.55 'IBM Plex Sans',sans-serif",
                color: "var(--i3,#6B7B84)",
                margin: 0,
              }}
            >
              Write one for the mail you send more than once — a nudge, a portal invite, a room
              change.
            </p>
          </div>
        ) : (
          rows.map((entry) => {
            const active = entry.id === selected;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => choose(entry.id)}
                style={{
                  ...CARD,
                  padding: "14px 16px",
                  textAlign: "left",
                  cursor: "pointer",
                  borderColor: active ? "var(--bt)" : "var(--ln)",
                  background: active ? "var(--sk)" : "var(--cd)",
                }}
              >
                <span
                  style={{
                    display: "block",
                    font: "600 13.5px 'IBM Plex Sans',sans-serif",
                    color: "var(--ik,#16232B)",
                  }}
                >
                  {entry.name}
                </span>
                <span
                  style={{
                    display: "block",
                    marginTop: 4,
                    font: "400 12px 'IBM Plex Mono',monospace",
                    color: "var(--i3,#6B7B84)",
                  }}
                >
                  {PURPOSES.find((p) => p.value === entry.purpose)?.label ?? entry.purpose}
                </span>
              </button>
            );
          })
        )}
      </div>

      <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
        <div style={{ ...CARD, display: "grid", gap: 18 }}>
          <div
            style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", gap: 14 }}
          >
            <div>
              <label style={LABEL} htmlFor="tpl-name">
                Name
              </label>
              <input
                id="tpl-name"
                style={FIELD}
                value={draft.name}
                placeholder="Chase outstanding slides"
                onChange={(event) => edit({ name: event.target.value })}
              />
            </div>
            <div>
              <label style={LABEL} htmlFor="tpl-purpose">
                Used for
              </label>
              <select
                id="tpl-purpose"
                style={FIELD}
                value={draft.purpose}
                onChange={(event) => edit({ purpose: event.target.value })}
              >
                {PURPOSES.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={LABEL} htmlFor="tpl-subject">
              Subject
            </label>
            <input
              id="tpl-subject"
              style={FIELD}
              value={draft.subject}
              placeholder="{{speaker_first_name}}, we still need your slides"
              onFocus={() => (focused.current = "subject")}
              onChange={(event) => edit({ subject: event.target.value })}
            />
          </div>

          <div>
            <label style={LABEL} htmlFor="tpl-body">
              Message
            </label>
            <textarea
              id="tpl-body"
              ref={bodyRef}
              value={draft.body_markdown}
              placeholder={"Hi {{speaker_first_name}},\n\nYour session {{session_title}} …"}
              onFocus={() => (focused.current = "body")}
              onChange={(event) => edit({ body_markdown: event.target.value })}
              style={{
                ...FIELD,
                minHeight: 200,
                padding: "12px 14px",
                lineHeight: 1.6,
                resize: "vertical",
              }}
            />
          </div>

          <div>
            <span style={LABEL}>Merge fields · click to insert</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {(fields.data ?? []).map((field) => (
                <button
                  key={field.token}
                  type="button"
                  title={field.description}
                  onClick={() => insert(field.token)}
                  style={{
                    height: 32,
                    padding: "0 12px",
                    borderRadius: 999,
                    cursor: "pointer",
                    border: "1px solid var(--ln,#E1E7E9)",
                    background: "var(--sk,#EDF1F2)",
                    color: "var(--ik,#16232B)",
                    font: "500 12px 'IBM Plex Mono',monospace",
                  }}
                >
                  {field.token}
                </button>
              ))}
            </div>
          </div>

          {problem !== null && (
            <p
              role="alert"
              style={{
                margin: 0,
                font: "500 13px/1.5 'IBM Plex Sans',sans-serif",
                color: "var(--cn,#D8432B)",
              }}
            >
              {problem}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              style={button("primary")}
              disabled={save.isPending || draft.name.trim() === "" || draft.subject.trim() === ""}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : selected === null ? "Create template" : "Save changes"}
            </button>
            {selected !== null && (
              <button
                type="button"
                style={button("secondary")}
                onClick={() => choose(null)}
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div style={{ ...CARD, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <h2
              style={{
                font: "600 16px 'IBM Plex Sans',sans-serif",
                color: "var(--ik,#16232B)",
                margin: 0,
              }}
            >
              Preview
            </h2>
            <span
              style={{ font: "400 12px 'IBM Plex Mono',monospace", color: "var(--i4,#99A6AD)" }}
            >
              against a real speaker on this roster
            </span>
            <select
              aria-label="Preview against"
              style={{ ...FIELD, width: "auto", marginLeft: "auto" }}
              value={previewFor ?? ""}
              onChange={(event) =>
                setPreviewFor(event.target.value === "" ? null : event.target.value)
              }
            >
              <option value="">First on the roster</option>
              {(roster.data ?? []).map((person) => (
                <option key={person.speaker_id} value={person.speaker_id}>
                  {person.name}
                </option>
              ))}
            </select>
          </div>

          {selected === null ? (
            <p
              style={{
                margin: 0,
                font: "400 13px/1.6 'IBM Plex Sans',sans-serif",
                color: "var(--i3,#6B7B84)",
              }}
            >
              Save this template to see it filled in for someone real. A merge field that works for
              a made-up example and breaks on the speaker with no session is exactly what a preview
              is for.
            </p>
          ) : preview.isLoading ? (
            <p style={{ margin: 0, font: "400 13px 'IBM Plex Sans',sans-serif" }}>Rendering…</p>
          ) : preview.data === undefined ? (
            <p
              role="alert"
              style={{
                margin: 0,
                font: "400 13px/1.6 'IBM Plex Sans',sans-serif",
                color: "var(--cn,#D8432B)",
              }}
            >
              {preview.error instanceof ApiError
                ? preview.error.message
                : "That preview could not be built."}
            </p>
          ) : (
            <div
              style={{
                background: "var(--sk,#EDF1F2)",
                borderRadius: 10,
                padding: 18,
                display: "grid",
                gap: 10,
              }}
            >
              <span
                style={{ font: "400 11.5px 'IBM Plex Mono',monospace", color: "var(--i3,#6B7B84)" }}
              >
                as {preview.data.speaker_name} sees it
              </span>
              <strong
                style={{ font: "600 15px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)" }}
              >
                {preview.data.subject}
              </strong>
              <p
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  font: "400 13.5px/1.65 'IBM Plex Sans',sans-serif",
                  color: "var(--ik,#16232B)",
                }}
              >
                {preview.data.body}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
