"use client";

/** Who reviews what.
 *
 *  The screen offered one button — "Assign" — which auto-distributed to every
 *  member who could review, two per submission, both numbers hardcoded in the
 *  page. `AutoDistributeRequest` has carried `per_submission` and
 *  `cap_per_reviewer` all along, and `POST /assignments` has carried explicit
 *  submission x reviewer pairs, and nothing in the product ever sent either.
 *  So an organiser could not say "three reviewers each", could not stop one
 *  person being handed ninety proposals, and could not give the accessibility
 *  track to the one reviewer who knows it.
 *
 *  Two modes, because organisers genuinely do both: spread the bulk evenly,
 *  then hand-place the handful that need a particular person. They compose —
 *  hand-picking after a spread adds reviewers to those submissions rather than
 *  replacing them, which is why the summary says what it created rather than
 *  what it set.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authed } from "@/lib/session";

type Member = { user_id: string; name: string; email: string; role: string };
type Progress = { user_id: string; assigned: number; completed: number };
type Submission = { id: string; code: string; title: string; status: string };
type Page = { data: Submission[]; meta: { total: number } };

/** Owners, admins and coordinators review alongside reviewers. */
const REVIEWING_ROLES = new Set(["owner", "admin", "coordinator", "reviewer"]);

const PER_SUBMISSION = ["1", "2", "3", "4", "5"] as const;

const label: React.CSSProperties = {
  font: "500 11.5px var(--font-plex-sans)",
  color: "var(--i3)",
};

const field: React.CSSProperties = {
  boxSizing: "border-box",
  height: "var(--control-h-md, 44px)",
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid var(--ls)",
  background: "var(--cd)",
  color: "var(--ik)",
  font: "400 13.5px var(--font-plex-sans)",
};

const action: React.CSSProperties = {
  height: "var(--control-h-md, 44px)",
  padding: "0 20px",
  borderRadius: 999,
  border: "none",
  font: "600 13px var(--font-plex-sans)",
  cursor: "pointer",
};

/** A 24px mark inside a 44px row, so the whole label is the target. */
function Tick({
  on,
  onToggle,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={on}
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        minHeight: "var(--control-h-md, 44px)",
        padding: "0 10px",
        borderRadius: 10,
        border: "none",
        background: on ? "var(--sk)" : "none",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span
        aria-hidden
        style={{
          flex: "0 0 auto",
          display: "grid",
          placeItems: "center",
          width: 24,
          height: 24,
          borderRadius: 7,
          border: `1px solid ${on ? "var(--bt)" : "var(--ls)"}`,
          background: on ? "var(--bt)" : "var(--cd)",
          color: "var(--bf)",
          font: "700 13px var(--font-plex-sans)",
        }}
      >
        {on ? "✓" : ""}
      </span>
      {children}
    </button>
  );
}

export function AssignmentPanel({
  eventId,
  roundId,
  open,
  onClose,
}: {
  eventId: string;
  roundId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [perSubmission, setPerSubmission] = useState("2");
  const [cap, setCap] = useState("");
  const [term, setTerm] = useState("");
  const [problem, setProblem] = useState("");
  const [outcome, setOutcome] = useState("");

  const { data: members } = useQuery({
    queryKey: ["members", eventId],
    enabled: open,
    queryFn: () => authed<Member[]>(`/events/${eventId}/members`),
  });

  const { data: progress } = useQuery({
    queryKey: ["review-progress", eventId, roundId],
    enabled: open,
    queryFn: () => authed<Progress[]>(`/events/${eventId}/review-rounds/${roundId}/progress`),
  });

  // Searched on the server: the console's list is paged, so filtering in the
  // browser would only ever search the page you happen to be looking at.
  const {
    data: found,
    isFetching: searching,
    error: searchError,
  } = useQuery({
    queryKey: ["assignable", eventId, term],
    enabled: open && term.trim().length > 1,
    queryFn: () =>
      authed<Page>(
        `/events/${eventId}/submissions?q=${encodeURIComponent(term.trim())}&page_size=20`,
      ),
  });

  const reviewers = (members ?? []).filter((member) => REVIEWING_ROLES.has(member.role));
  const load = new Map((progress ?? []).map((row) => [row.user_id, row]));
  const chosenIds = [...chosen];

  const done = (message: string) => {
    setOutcome(message);
    setProblem("");
    void queryClient.invalidateQueries({ queryKey: ["review-progress", eventId] });
    void queryClient.invalidateQueries({ queryKey: ["round-plans", eventId] });
    void queryClient.invalidateQueries({ queryKey: ["review-rounds-admin", eventId] });
  };

  const spread = useMutation({
    mutationFn: () =>
      authed<{ created: number; under_assigned: number; already_covered: number }>(
        `/events/${eventId}/review-rounds/${roundId}/auto-distribute`,
        {
          method: "POST",
          body: {
            user_ids: chosenIds,
            per_submission: Number(perSubmission),
            ...(cap.trim() === "" ? {} : { cap_per_reviewer: Number(cap) }),
          },
        },
      ),
    onSuccess: (result) => {
      const parts: string[] = [];
      if (result.created > 0) parts.push(`${result.created} assignments created`);
      if (result.already_covered > 0) {
        parts.push(`${result.already_covered} already had a full panel`);
      }
      // "Could not cover" and "nothing to do" are opposite facts. Reporting
      // them with one number is how a working screen came to look broken.
      if (result.under_assigned > 0) {
        parts.push(
          `${result.under_assigned} could not be fully covered${cap.trim() === "" ? "" : " within the cap"}`,
        );
      }
      done(
        parts.length === 0
          ? "Nothing to assign — everyone is already covered."
          : `${parts.join("; ")}.`,
      );
    },
    onError: (error: Error) => setProblem(error.message),
  });

  const handPick = useMutation({
    mutationFn: () =>
      authed<{ created: number }>(`/events/${eventId}/review-rounds/${roundId}/assignments`, {
        method: "POST",
        body: { submission_ids: [...picked], user_ids: chosenIds },
      }),
    onSuccess: (result) => {
      const wanted = picked.size * chosenIds.length;
      const already = wanted - result.created;
      setPicked(new Set());
      done(
        already === 0
          ? `${result.created} assignment${result.created === 1 ? "" : "s"} created.`
          : `${result.created} created; ${already} were already assigned.`,
      );
    },
    onError: (error: Error) => setProblem(error.message),
  });

  const toggle = (set: Set<string>, id: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  // Opened from the round card's own "Assign reviewers", so there is no second
  // button here competing with it for the same words.
  if (!open) return null;

  const capNumber = Number(cap);
  const capBad = cap.trim() !== "" && (!Number.isInteger(capNumber) || capNumber < 1);

  return (
    <section
      style={{
        marginTop: 14,
        border: "1px solid var(--ln)",
        borderRadius: 12,
        background: "var(--cd)",
        padding: 20,
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
          Assignment · who reviews what
        </h3>
        <button
          onClick={onClose}
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

      {reviewers.length === 0 ? (
        <p style={{ font: "400 13.5px/1.6 var(--font-plex-sans)", color: "var(--i2)", margin: 0 }}>
          Nobody on this event can review yet. Invite reviewers from Settings, then come back —
          assignment needs someone to assign to.
        </p>
      ) : (
        <>
          <p style={{ ...label, margin: "0 0 6px" }}>Reviewers · pick who this applies to</p>
          <div style={{ display: "grid", gap: 2, marginBottom: 18 }}>
            {reviewers.map((person) => {
              const row = load.get(person.user_id);
              return (
                <Tick
                  key={person.user_id}
                  on={chosen.has(person.user_id)}
                  onToggle={() => toggle(chosen, person.user_id, setChosen)}
                >
                  <span
                    style={{
                      font: "500 13.5px var(--font-plex-sans)",
                      color: "var(--ik)",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {person.name}
                  </span>
                  <span
                    className="tabular"
                    style={{ font: "400 12px var(--font-plex-mono)", color: "var(--i3)" }}
                  >
                    {row === undefined ? "nothing yet" : `${row.completed}/${row.assigned} done`}
                  </span>
                </Tick>
              );
            })}
          </div>

          <div
            style={{
              display: "grid",
              gap: 10,
              padding: 16,
              borderRadius: 10,
              background: "var(--sk)",
              marginBottom: 14,
            }}
          >
            <p style={{ ...label, margin: 0 }}>Spread evenly</p>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label style={{ display: "grid", gap: 5 }}>
                <span style={label}>Reviewers per proposal</span>
                <select
                  value={perSubmission}
                  onChange={(event) => setPerSubmission(event.target.value)}
                  style={{ ...field, width: 92 }}
                >
                  {PER_SUBMISSION.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 5 }}>
                <span style={label}>Cap per reviewer</span>
                <input
                  value={cap}
                  inputMode="numeric"
                  placeholder="no cap"
                  aria-invalid={capBad}
                  onChange={(event) => setCap(event.target.value)}
                  style={{
                    ...field,
                    width: 118,
                    border: `1px solid ${capBad ? "var(--cn)" : "var(--ls)"}`,
                  }}
                />
              </label>
              <button
                disabled={chosen.size === 0 || capBad || spread.isPending}
                onClick={() => spread.mutate()}
                style={{
                  ...action,
                  background: chosen.size === 0 || capBad ? "var(--ls)" : "var(--bt)",
                  color: chosen.size === 0 || capBad ? "var(--i3)" : "var(--bf)",
                  cursor: chosen.size === 0 || capBad ? "not-allowed" : "pointer",
                }}
              >
                {spread.isPending
                  ? "Spreading…"
                  : `Spread across ${chosen.size || "…"} reviewer${chosen.size === 1 ? "" : "s"}`}
              </button>
            </div>
            {capBad && (
              <span
                role="alert"
                style={{ font: "400 12px var(--font-plex-sans)", color: "var(--cn)" }}
              >
                A cap is a whole number of proposals, or blank for no cap.
              </span>
            )}
            <p
              style={{
                font: "400 12px/1.6 var(--font-plex-sans)",
                color: "var(--i3)",
                margin: 0,
              }}
            >
              Balances by current load and never gives anyone their own submission. Runs again
              safely — a proposal that already has its panel is left alone.
            </p>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ ...label, margin: 0 }}>Or hand-pick proposals</p>
            <input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search by code, title or speaker"
              style={{ ...field, width: "100%" }}
            />
            {term.trim().length > 1 && (
              <div style={{ display: "grid", gap: 2, maxHeight: 260, overflowY: "auto" }}>
                {searchError !== null ? (
                  <p
                    role="alert"
                    style={{
                      font: "400 13px var(--font-plex-sans)",
                      color: "var(--cn)",
                      margin: 0,
                    }}
                  >
                    Search failed: {searchError.message}
                  </p>
                ) : searching ? (
                  <p
                    style={{
                      font: "400 13px var(--font-plex-sans)",
                      color: "var(--i3)",
                      margin: 0,
                    }}
                  >
                    Searching…
                  </p>
                ) : (found?.data ?? []).length === 0 ? (
                  <p
                    style={{
                      font: "400 13px var(--font-plex-sans)",
                      color: "var(--i3)",
                      margin: 0,
                    }}
                  >
                    No proposal matches “{term.trim()}”.
                  </p>
                ) : (
                  (found?.data ?? []).map((row) => (
                    <Tick
                      key={row.id}
                      on={picked.has(row.id)}
                      onToggle={() => toggle(picked, row.id, setPicked)}
                    >
                      <span
                        className="tabular"
                        style={{
                          font: "400 12px var(--font-plex-mono)",
                          color: "var(--i3)",
                          flex: "0 0 auto",
                        }}
                      >
                        {row.code}
                      </span>
                      <span
                        style={{
                          font: "400 13px var(--font-plex-sans)",
                          color: "var(--ik)",
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.title}
                      </span>
                    </Tick>
                  ))
                )}
              </div>
            )}
            <button
              disabled={picked.size === 0 || chosen.size === 0 || handPick.isPending}
              onClick={() => handPick.mutate()}
              style={{
                ...action,
                justifySelf: "start",
                background: picked.size === 0 || chosen.size === 0 ? "var(--ls)" : "var(--bt)",
                color: picked.size === 0 || chosen.size === 0 ? "var(--i3)" : "var(--bf)",
                cursor: picked.size === 0 || chosen.size === 0 ? "not-allowed" : "pointer",
              }}
            >
              {handPick.isPending
                ? "Assigning…"
                : `Assign ${picked.size} proposal${picked.size === 1 ? "" : "s"} to ${chosen.size} reviewer${chosen.size === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}

      {problem !== "" && (
        <p
          role="alert"
          style={{ font: "400 13px var(--font-plex-sans)", color: "var(--cn)", margin: "14px 0 0" }}
        >
          {problem}
        </p>
      )}
      {outcome !== "" && problem === "" && (
        <p
          role="status"
          style={{ font: "500 13px var(--font-plex-sans)", color: "var(--ok)", margin: "14px 0 0" }}
        >
          {outcome}
        </p>
      )}
    </section>
  );
}
