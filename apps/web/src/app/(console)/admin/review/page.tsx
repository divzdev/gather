"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EmptyState, PageHead, card, pill, quietPill } from "@/components/ui";
import { authed, getEventId } from "@/lib/session";

type Round = { id: string; name: string; is_blind: boolean; status: string };
type QueueItem = { submission_id: string; code: string; title: string; completed: boolean };
type Criterion = {
  id: string;
  label: string;
  description: string | null;
  kind: "rating" | "select" | "text";
  choices: { value: number; label: string }[];
  scale_min: number;
  scale_max: number;
  weight: string;
  is_required: boolean;
};
type Subject = {
  id: string;
  code: string;
  title: string;
  answers: Record<string, unknown>;
  speakers: { id: string; name: string; company: string | null }[];
  is_blind: boolean;
};

export default function ReviewPage() {
  const eventId = typeof window === "undefined" ? null : getEventId();
  const queryClient = useQueryClient();
  const [roundId, setRoundId] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [note, setNote] = useState("");
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const rounds = useQuery({
    queryKey: ["rounds", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Round[]>(`/events/${eventId}/review-rounds`),
  });

  const activeRound = roundId ?? rounds.data?.find((r) => r.status === "open")?.id ?? null;

  const queue = useQuery({
    queryKey: ["queue", eventId, activeRound],
    enabled: eventId !== null && activeRound !== null,
    queryFn: () => authed<QueueItem[]>(`/events/${eventId}/review/queue?round_id=${activeRound}`),
  });

  const criteria = useQuery({
    queryKey: ["criteria", eventId, activeRound],
    enabled: eventId !== null && activeRound !== null,
    queryFn: () =>
      authed<Criterion[]>(`/events/${eventId}/review/rounds/${activeRound}/criteria`),
  });

  const subject = useQuery({
    queryKey: ["subject", eventId, activeRound, current],
    enabled: eventId !== null && activeRound !== null && current !== null,
    queryFn: () =>
      authed<Subject>(
        `/events/${eventId}/review/submissions/${current}?round_id=${activeRound}`,
      ),
  });

  const save = useMutation({
    mutationFn: () =>
      authed(`/events/${eventId}/review/submissions/${current}/scores?round_id=${activeRound}`, {
        method: "PUT",
        body: { values, comment: note || null, conflict_of_interest: conflict },
      }),
    onSuccess: async () => {
      setMessage("Saved.");
      await queryClient.invalidateQueries({ queryKey: ["queue"] });
      const next = queue.data?.find((i) => !i.completed && i.submission_id !== current);
      open(next?.submission_id ?? null);
    },
    onError: () => setMessage("Could not save. Check every required criterion has a score."),
  });

  function open(id: string | null) {
    setCurrent(id);
    setValues({});
    setNote("");
    setConflict(false);
    setMessage(null);
  }

  const done = queue.data?.filter((i) => i.completed).length ?? 0;
  const totalQ = queue.data?.length ?? 0;
  const round = rounds.data?.find((r) => r.id === activeRound);

  const label: React.CSSProperties = {
    display: "block",
    marginBottom: 6,
    font: "500 12.5px var(--font-plex-sans), sans-serif",
    color: "var(--ik)",
  };

  return (
    <main style={{ padding: "20px 28px 80px" }}>
      <PageHead
        title="Review"
        summary={
          activeRound === null
            ? "No open review round yet."
            : `${done} of ${totalQ} done in ${round?.name ?? "this round"}${round?.is_blind ? ", blind" : ""}.`
        }
        right={
          rounds.data && rounds.data.length > 1 ? (
            <select
              value={activeRound ?? ""}
              onChange={(e) => {
                setRoundId(e.target.value);
                open(null);
              }}
              aria-label="Review round"
              style={{ ...quietPill, paddingRight: 8 }}
            >
              {rounds.data.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />

      {activeRound === null ? (
        <EmptyState
          title="No open round"
          body="An organizer opens a review round and assigns you proposals."
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,300px) minmax(0,1fr)", gap: 16 }}>
          <div style={{ ...card, overflow: "hidden", alignSelf: "start" }}>
            <div
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--ln)",
                font: "600 11px var(--font-plex-condensed), sans-serif",
                letterSpacing: "0.06em",
                color: "var(--i4)",
              }}
            >
              YOUR QUEUE
            </div>
            {(queue.data ?? []).length === 0 ? (
              <p style={{ padding: 16, font: "400 13px var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}>
                Nothing assigned to you in this round.
              </p>
            ) : (
              (queue.data ?? []).map((item) => (
                <button
                  key={item.submission_id}
                  type="button"
                  onClick={() => open(item.submission_id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "10px 14px",
                    border: "none",
                    borderBottom: "1px solid var(--ln)",
                    borderLeft: `3px solid ${item.submission_id === current ? "var(--sg)" : "transparent"}`,
                    background: item.submission_id === current ? "var(--sw)" : "none",
                    textAlign: "left",
                  }}
                >
                  <span
                    className="tabular"
                    style={{ font: "500 11.5px var(--font-plex-mono), monospace", color: "var(--i4)", flex: "none" }}
                  >
                    {item.code}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      font: "400 13px var(--font-plex-sans)",
                      color: "var(--ik)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {item.title}
                  </span>
                  {item.completed && (
                    <span style={{ color: "var(--ok)", font: "500 11px var(--font-plex-sans)", flex: "none" }}>
                      done
                    </span>
                  )}
                </button>
              ))
            )}
          </div>

          {current === null || subject.data === undefined ? (
            <EmptyState title="Pick a proposal" body="Choose one from your queue to start scoring." />
          ) : (
            <div style={{ ...card, padding: 20 }}>
              {subject.data.is_blind && (
                <p
                  style={{
                    margin: "0 0 12px",
                    padding: "6px 10px",
                    borderRadius: 6,
                    background: "var(--ifw)",
                    color: "var(--if)",
                    font: "500 12px var(--font-plex-sans)",
                    display: "inline-block",
                  }}
                >
                  Blind round. Speaker identity is hidden.
                </p>
              )}
              <h2 style={{ font: "600 18px var(--font-plex-sans)", color: "var(--ik)", margin: "0 0 4px" }}>
                {subject.data.title}
              </h2>
              {!subject.data.is_blind && subject.data.speakers.length > 0 && (
                <p style={{ font: "400 12.5px var(--font-plex-sans)", color: "var(--i3)", margin: "0 0 12px" }}>
                  {subject.data.speakers.map((s) => s.name).join(", ")}
                </p>
              )}
              {Object.entries(subject.data.answers).map(([key, value]) => (
                <div key={key} style={{ marginBottom: 12 }}>
                  <p style={{ font: "600 11px var(--font-plex-condensed)", letterSpacing: "0.06em", color: "var(--i4)", margin: "0 0 3px" }}>
                    {key.replace(/_/g, " ").toUpperCase()}
                  </p>
                  <p style={{ font: "400 13px var(--font-plex-sans)", color: "var(--i2)", margin: 0, whiteSpace: "pre-wrap" }}>
                    {String(value)}
                  </p>
                </div>
              ))}

              <hr style={{ border: "none", borderTop: "1px solid var(--ln)", margin: "18px 0" }} />

              {(criteria.data ?? []).map((criterion) => (
                <div key={criterion.id} style={{ marginBottom: 16 }}>
                  <label style={label} htmlFor={`c-${criterion.id}`}>
                    {criterion.label}
                    {criterion.is_required && criterion.kind !== "text" && (
                      <span style={{ color: "var(--cn)" }}> *</span>
                    )}
                    <span className="tabular" style={{ color: "var(--i4)", fontWeight: 400 }}>
                      {" "}
                      · weight {criterion.weight}
                    </span>
                  </label>
                  {criterion.kind === "rating" ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      {Array.from(
                        { length: criterion.scale_max - criterion.scale_min + 1 },
                        (_, i) => criterion.scale_min + i,
                      ).map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setValues((p) => ({ ...p, [criterion.id]: n }))}
                          aria-pressed={values[criterion.id] === n}
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 8,
                            border: `1px solid ${values[criterion.id] === n ? "var(--sg)" : "var(--ls)"}`,
                            background: values[criterion.id] === n ? "var(--sw)" : "var(--cd)",
                            color: values[criterion.id] === n ? "var(--sg)" : "var(--i2)",
                            font: "600 13px var(--font-plex-mono), monospace",
                          }}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  ) : criterion.kind === "select" ? (
                    <select
                      id={`c-${criterion.id}`}
                      value={String(values[criterion.id] ?? "")}
                      onChange={(e) => setValues((p) => ({ ...p, [criterion.id]: Number(e.target.value) }))}
                      style={{ ...quietPill, height: 34, width: "100%", textAlign: "left" }}
                    >
                      <option value="">Choose…</option>
                      {criterion.choices.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      id={`c-${criterion.id}`}
                      rows={3}
                      value={String(values[criterion.id] ?? "")}
                      onChange={(e) => setValues((p) => ({ ...p, [criterion.id]: e.target.value }))}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--ls)",
                        background: "var(--cd)",
                        color: "var(--ik)",
                        font: "400 13px var(--font-plex-sans), sans-serif",
                      }}
                    />
                  )}
                </div>
              ))}

              <label style={label} htmlFor="note">
                Comment, organizers only
              </label>
              <textarea
                id="note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--ls)",
                  background: "var(--cd)",
                  color: "var(--ik)",
                  font: "400 13px var(--font-plex-sans), sans-serif",
                  marginBottom: 12,
                }}
              />

              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <input type="checkbox" checked={conflict} onChange={(e) => setConflict(e.target.checked)} />
                <span style={{ font: "400 12.5px var(--font-plex-sans)", color: "var(--i2)" }}>
                  I have a conflict of interest. This excludes my score from the average.
                </span>
              </label>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button type="button" style={pill} disabled={save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? "Saving…" : "Save and next"}
                </button>
                {message !== null && (
                  <span style={{ font: "400 12.5px var(--font-plex-sans)", color: message === "Saved." ? "var(--ok)" : "var(--cn)" }}>
                    {message}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
