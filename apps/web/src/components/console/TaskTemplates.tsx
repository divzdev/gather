"use client";

/** Defining the deliverables an organiser chases, and handing them out.
 *
 *  `POST /task-templates` and `POST /task-templates/{id}/assign` have existed
 *  since the first migration, and until now nothing in the console called
 *  either. The only thing in the product that created a `TaskTemplate` was the
 *  seeder — so Tasks was a dashboard over data that could not be produced, and
 *  on anyone's own event it read zero forever with no way out.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authed, getEventId } from "@/lib/session";

type Kind = "upload" | "form" | "acknowledge" | "external_link";

type Template = {
  id: string;
  name: string;
  description: string | null;
  kind: Kind;
  external_url: string | null;
  is_required: boolean;
  due_rule: { type?: string; days_before_event?: number; date?: string };
  assigned_count: number;
};

/** The four things a speaker can be asked for. Described rather than named:
 *  "upload" is a word about the mechanism, not about what it gets you. */
const KINDS: { key: Kind; label: string; hint: string }[] = [
  { key: "upload", label: "Upload a file", hint: "A headshot, a slide deck, a signed release." },
  { key: "form", label: "Fill in a form", hint: "Answers you need in a structured shape." },
  { key: "acknowledge", label: "Acknowledge", hint: "Read and confirm. No file, no answers." },
  { key: "external_link", label: "Visit a link", hint: "Something they complete elsewhere." },
];

const KIND_LABEL: Record<Kind, string> = {
  upload: "Upload",
  form: "Form",
  acknowledge: "Acknowledge",
  external_link: "Link",
};

type Draft = {
  name: string;
  description: string;
  kind: Kind;
  external_url: string;
  is_required: boolean;
  days_before_event: string;
};

const BLANK: Draft = {
  name: "",
  description: "",
  kind: "upload",
  external_url: "",
  is_required: true,
  days_before_event: "14",
};

const card: React.CSSProperties = {
  border: "1px solid var(--ln,#E1E7E9)",
  background: "var(--cd,#FFFFFF)",
  borderRadius: 14,
  padding: 22,
  boxShadow: "0 1px 2px rgba(13,16,32,.04)",
};

const label: React.CSSProperties = {
  display: "block",
  font: "500 12px 'IBM Plex Sans',sans-serif",
  color: "var(--i2,#3E4E58)",
  marginBottom: 6,
};

const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: 40,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid var(--ls,#C8D2D5)",
  background: "var(--cd,#FFFFFF)",
  color: "var(--ik,#16232B)",
  font: "400 13.5px 'IBM Plex Sans',sans-serif",
};

const pill = (tone: "primary" | "quiet"): React.CSSProperties => ({
  minHeight: 36,
  padding: "0 16px",
  borderRadius: 999,
  cursor: "pointer",
  font: "600 12.5px 'IBM Plex Sans',sans-serif",
  border: tone === "primary" ? "none" : "1px solid var(--ls,#C8D2D5)",
  background: tone === "primary" ? "var(--bt,#FF6B6B)" : "transparent",
  color: tone === "primary" ? "var(--bf,#331313)" : "var(--i2,#3E4E58)",
});

export function TaskTemplates({ onToast }: { onToast: (message: string) => void }) {
  const eventId = typeof window === "undefined" ? null : getEventId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [problem, setProblem] = useState("");

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["task-templates", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Template[]>(`/events/${eventId}/task-templates`),
  });

  // `assign` answers with a count and nothing else, so zero has two very
  // different causes: everyone already has it, or there is nobody to give it
  // to. Reporting the wrong one is the kind of confident, false confirmation
  // that teaches an operator to distrust the screen.
  const { data: roster } = useQuery({
    queryKey: ["roster-count", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<{ id: string }[]>(`/events/${eventId}/speakers`),
  });
  const rosterSize = (roster ?? []).length;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["task-templates", eventId] });
    void queryClient.invalidateQueries({ queryKey: ["tasks", eventId] });
  };

  const create = useMutation({
    mutationFn: () =>
      authed<Template>(`/events/${eventId}/task-templates`, {
        method: "POST",
        body: {
          name: draft.name.trim(),
          description: draft.description.trim() === "" ? null : draft.description.trim(),
          kind: draft.kind,
          external_url:
            draft.kind === "external_link" && draft.external_url.trim() !== ""
              ? draft.external_url.trim()
              : null,
          is_required: draft.is_required,
          // A rule, not a date: "two weeks before the doors open" has to
          // survive the organiser moving the conference.
          due_rule: { type: "relative", days_before_event: Number(draft.days_before_event) || 0 },
        },
      }),
    onSuccess: (made) => {
      setOpen(false);
      setDraft(BLANK);
      setProblem("");
      refresh();
      onToast(`“${made.name}” created. Assign it to put it in speakers' portals.`);
    },
    onError: (error: Error) => setProblem(error.message),
  });

  const assign = useMutation({
    mutationFn: (id: string) =>
      authed<{ assigned: number }>(`/events/${eventId}/task-templates/${id}/assign`, {
        method: "POST",
      }),
    onSuccess: (result) => {
      refresh();
      if (result.assigned > 0) {
        onToast(`Assigned to ${result.assigned} speaker${result.assigned === 1 ? "" : "s"}.`);
        return;
      }
      onToast(
        rosterSize === 0
          ? "Nobody is on the roster yet, so nothing was assigned. Speakers arrive here when you accept a proposal."
          : "Everyone it applies to already has it. Nobody was given a second copy.",
      );
    },
    onError: (error: Error) => onToast(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      authed(`/events/${eventId}/task-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      onToast("Deliverable deleted.");
    },
    onError: (error: Error) => onToast(error.message),
  });

  const submit = () => {
    if (draft.name.trim() === "") {
      setProblem("Give the deliverable a name your speakers will recognise.");
      return;
    }
    if (draft.kind === "external_link" && draft.external_url.trim() === "") {
      setProblem("A link task needs the link.");
      return;
    }
    create.mutate();
  };

  const rows = data ?? [];

  return (
    <section style={{ ...card, marginBottom: 16 }} aria-labelledby="task-templates-title">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ marginRight: "auto" }}>
          <h2
            id="task-templates-title"
            style={{
              font: "600 15px 'IBM Plex Sans',sans-serif",
              color: "var(--ik,#16232B)",
              margin: 0,
            }}
          >
            Deliverables
          </h2>
          <p
            style={{
              font: "400 13px/1.55 'IBM Plex Sans',sans-serif",
              color: "var(--i3,#6B7B84)",
              margin: "4px 0 0",
            }}
          >
            What every speaker owes you. Define it once, then assign it to the roster.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setProblem("");
            setOpen((current) => !current);
          }}
          style={pill(open ? "quiet" : "primary")}
        >
          {open ? "Cancel" : "New deliverable"}
        </button>
      </div>

      {open && (
        <div
          style={{
            marginTop: 20,
            paddingTop: 20,
            borderTop: "1px solid var(--ln,#E1E7E9)",
            display: "grid",
            gap: 16,
          }}
        >
          <div>
            <label style={label} htmlFor="tt-name">
              Name
            </label>
            <input
              id="tt-name"
              style={input}
              value={draft.name}
              placeholder="Headshot"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>

          <div>
            <label style={label} htmlFor="tt-desc">
              What to tell the speaker{" "}
              <span style={{ color: "var(--i4,#99A6AD)" }}>· optional</span>
            </label>
            <textarea
              id="tt-desc"
              style={{ ...input, height: 64, padding: "10px 12px", lineHeight: 1.5 }}
              value={draft.description}
              placeholder="Landscape, at least 1000px wide, no logos."
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </div>

          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ ...label, marginBottom: 8 }}>What they do</legend>
            <div style={{ display: "grid", gap: 8 }}>
              {KINDS.map((entry) => {
                const chosen = draft.kind === entry.key;
                return (
                  <label
                    key={entry.key}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      minHeight: 44,
                      padding: "10px 14px",
                      borderRadius: 10,
                      cursor: "pointer",
                      border: `1px solid ${chosen ? "var(--sg,#E04E4E)" : "var(--ln,#E1E7E9)"}`,
                      background: chosen ? "var(--sw,#FFEAE6)" : "transparent",
                    }}
                  >
                    <input
                      type="radio"
                      name="tt-kind"
                      checked={chosen}
                      onChange={() => setDraft({ ...draft, kind: entry.key })}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <span
                        style={{
                          display: "block",
                          font: "500 13.5px 'IBM Plex Sans',sans-serif",
                          color: "var(--ik,#16232B)",
                        }}
                      >
                        {entry.label}
                      </span>
                      <span
                        style={{
                          font: "400 12.5px 'IBM Plex Sans',sans-serif",
                          color: "var(--i3,#6B7B84)",
                        }}
                      >
                        {entry.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {draft.kind === "external_link" && (
            <div>
              <label style={label} htmlFor="tt-url">
                Where it lives
              </label>
              <input
                id="tt-url"
                style={input}
                value={draft.external_url}
                placeholder="https://…"
                onChange={(event) => setDraft({ ...draft, external_url: event.target.value })}
              />
            </div>
          )}

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ width: 200 }}>
              <label style={label} htmlFor="tt-due">
                Due before the event
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  id="tt-due"
                  type="number"
                  min={0}
                  max={365}
                  style={{ ...input, width: 84, textAlign: "center" }}
                  value={draft.days_before_event}
                  onChange={(event) =>
                    setDraft({ ...draft, days_before_event: event.target.value })
                  }
                />
                <span
                  style={{
                    font: "400 13px 'IBM Plex Sans',sans-serif",
                    color: "var(--i3,#6B7B84)",
                  }}
                >
                  days
                </span>
              </div>
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minHeight: 40,
                font: "400 13.5px 'IBM Plex Sans',sans-serif",
                color: "var(--ik,#16232B)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={draft.is_required}
                onChange={() => setDraft({ ...draft, is_required: !draft.is_required })}
              />
              Required
            </label>
          </div>

          {problem !== "" && (
            <p
              role="alert"
              style={{
                font: "400 13px 'IBM Plex Sans',sans-serif",
                color: "var(--cn,#D8432B)",
                margin: 0,
              }}
            >
              {problem}
            </p>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={submit}
              disabled={create.isPending}
              style={{ ...pill("primary"), opacity: create.isPending ? 0.7 : 1 }}
            >
              {create.isPending ? "Creating…" : "Create deliverable"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setProblem("");
              }}
              style={pill("quiet")}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: rows.length > 0 || isPending || isError ? 18 : 0 }}>
        {isError ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <p
              role="alert"
              style={{
                font: "400 13px 'IBM Plex Sans',sans-serif",
                color: "var(--cn,#D8432B)",
                margin: 0,
              }}
            >
              The deliverables could not be loaded.
            </p>
            <button type="button" onClick={() => void refetch()} style={pill("quiet")}>
              Try again
            </button>
          </div>
        ) : isPending ? (
          <p
            style={{
              font: "400 13px 'IBM Plex Sans',sans-serif",
              color: "var(--i3,#6B7B84)",
              margin: 0,
            }}
          >
            Loading deliverables…
          </p>
        ) : rows.length === 0 ? (
          !open && (
            <p
              style={{
                font: "400 13px 'IBM Plex Sans',sans-serif",
                color: "var(--i3,#6B7B84)",
                margin: 0,
              }}
            >
              None yet. A headshot, a bio and a slide deck are what most conferences start with.
            </p>
          )
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {rows.map((row) => (
              <li
                key={row.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                  minHeight: 52,
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--ln,#E1E7E9)",
                  background: "var(--sk,#EDF1F2)",
                }}
              >
                <span
                  style={{
                    font: "500 13.5px 'IBM Plex Sans',sans-serif",
                    color: "var(--ik,#16232B)",
                  }}
                >
                  {row.name}
                </span>
                <span
                  style={{
                    padding: "3px 9px",
                    borderRadius: 999,
                    font: "500 11px 'IBM Plex Sans',sans-serif",
                    background: "var(--cd,#FFFFFF)",
                    border: "1px solid var(--ln,#E1E7E9)",
                    color: "var(--i2,#3E4E58)",
                  }}
                >
                  {KIND_LABEL[row.kind]}
                </span>
                {!row.is_required && (
                  <span
                    style={{
                      font: "400 12px 'IBM Plex Sans',sans-serif",
                      color: "var(--i3,#6B7B84)",
                    }}
                  >
                    optional
                  </span>
                )}
                <span
                  className="tabular"
                  style={{
                    marginLeft: "auto",
                    font: "400 12.5px 'IBM Plex Sans',sans-serif",
                    color: row.assigned_count === 0 ? "var(--pd,#B96A1F)" : "var(--i3,#6B7B84)",
                  }}
                >
                  {row.assigned_count === 0 ? "not assigned" : `${row.assigned_count} assigned`}
                </span>
                <button
                  type="button"
                  onClick={() => assign.mutate(row.id)}
                  disabled={assign.isPending || rosterSize === 0}
                  // Assigning twice is safe — the service skips anyone who
                  // already has it — so this stays available for the speakers
                  // who joined the roster after the first hand-out.
                  title={
                    rosterSize === 0
                      ? "Nobody is on the roster yet. Accept a proposal and its speakers appear here."
                      : "Give this to everyone on the roster who does not have it yet."
                  }
                  style={{
                    ...pill("quiet"),
                    opacity: assign.isPending || rosterSize === 0 ? 0.55 : 1,
                    cursor: rosterSize === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  {row.assigned_count === 0 ? "Assign to roster" : "Assign to new speakers"}
                </button>
                {/* Only while it has been handed to nobody. Once assigned, a
                    delete would cascade through every speaker's row — the API
                    refuses it, and offering a button that cannot work is worse
                    than its absence. */}
                {row.assigned_count === 0 && (
                  <button
                    type="button"
                    onClick={() => remove.mutate(row.id)}
                    disabled={remove.isPending}
                    aria-label={`Delete ${row.name}`}
                    style={{
                      ...pill("quiet"),
                      padding: "0 12px",
                      color: "var(--cn,#D8432B)",
                      opacity: remove.isPending ? 0.6 : 1,
                    }}
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
