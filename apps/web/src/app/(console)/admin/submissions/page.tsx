"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { EmptyState, PageHead, StatTiles, StatusBadge, card, pill, quietPill } from "@/components/ui";
import { authed, getEventId } from "@/lib/session";

type Speaker = { id: string; name: string; email: string; is_primary: boolean };
type Submission = {
  id: string;
  code: string;
  title: string;
  status: string;
  decision_status: string;
  score_avg: string | null;
  review_count: number;
  speakers: Speaker[];
};
type Page = { data: Submission[]; meta: { total: number } };
type Pending = { accepted: number; waitlisted: number; rejected: number; total: number };

const OUTCOMES = ["accepted", "waitlisted", "rejected"] as const;

export default function SubmissionsPage() {
  const [filter, setFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const eventId = typeof window === "undefined" ? null : getEventId();
  const queryClient = useQueryClient();

  const { data, isError } = useQuery({
    queryKey: ["submissions", eventId, filter, query],
    enabled: eventId !== null,
    queryFn: async () => {
      const params = new URLSearchParams({ per_page: "100" });
      if (filter !== null) params.set("filter[status]", filter);
      if (query) params.set("q", query);
      const [page, counts] = await Promise.all([
        authed<Page>(`/events/${eventId}/submissions?${params}`),
        authed<Pending>(`/events/${eventId}/submissions/pending-decisions`),
      ]);
      return { page, counts };
    },
  });

  const rows = data?.page.data ?? [];
  const total = data?.page.meta.total ?? 0;
  const pending = data?.counts ?? null;
  const error =
    actionError ?? (isError ? "Could not load submissions. Check you are signed in." : null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["submissions"] });

  const tiles = useMemo(
    () => [
      { key: "submitted", label: "Submitted", value: rows.filter((r) => r.status === "submitted").length, tone: "if" as const },
      { key: "in_review", label: "In review", value: rows.filter((r) => r.status === "in_review").length, tone: "pd" as const },
      { key: "accepted", label: "Accepted", value: rows.filter((r) => r.status === "accepted").length, tone: "ok" as const },
      { key: "rejected", label: "Rejected", value: rows.filter((r) => r.status === "rejected").length, tone: "cn" as const },
    ],
    [rows],
  );

  const decideMutation = useMutation({
    mutationFn: (outcome: string) =>
      authed(`/events/${eventId}/submissions/bulk-decision`, {
        method: "POST",
        body: { submission_ids: [...picked], outcome },
        // Retrying a batch must never decide twice.
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setPicked(new Set());
      setActionError(null);
      await refresh();
    },
    onError: () => setActionError("Could not record those decisions."),
  });

  const promoteMutation = useMutation({
    mutationFn: (id: string) =>
      authed(`/events/${eventId}/submissions/${id}/promote`, { method: "POST" }),
    onSuccess: async () => {
      setActionError(null);
      await refresh();
    },
    onError: () => setActionError("Only accepted proposals become sessions."),
  });

  const busy = decideMutation.isPending || promoteMutation.isPending;
  const decide = (outcome: string) => decideMutation.mutate(outcome);
  const promote = (id: string) => promoteMutation.mutate(id);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "10px 12px",
    font: "600 11px var(--font-plex-condensed), sans-serif",
    letterSpacing: "0.06em",
    color: "var(--i4)",
    borderBottom: "1px solid var(--ln)",
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "10px 12px",
    borderBottom: "1px solid var(--ln)",
    font: "400 13px var(--font-plex-sans), sans-serif",
    color: "var(--ik)",
  };

  return (
    <main style={{ padding: "20px 28px 80px" }}>
      <PageHead
        title="Submissions"
        summary={
          pending && pending.total > 0
            ? `${total} proposals. ${pending.total} decided and waiting to be sent.`
            : `${total} proposals.`
        }
      />

      {pending !== null && pending.total > 0 && (
        <div
          style={{
            ...card,
            padding: "10px 14px",
            marginBottom: 16,
            background: "var(--pdw)",
            borderColor: "var(--pdl)",
            color: "var(--pd)",
            font: "500 12.5px var(--font-plex-sans), sans-serif",
          }}
        >
          {pending.accepted} accepted, {pending.waitlisted} waitlisted, {pending.rejected} rejected
          are recorded but nobody has been emailed yet.
        </div>
      )}

      <StatTiles tiles={tiles} active={filter} onSelect={setFilter} />

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles…"
          aria-label="Search submissions"
          style={{
            height: 32,
            flex: 1,
            maxWidth: 320,
            padding: "0 12px",
            borderRadius: 999,
            border: "1px solid var(--ln)",
            background: "var(--sk)",
            color: "var(--ik)",
            font: "400 12.5px var(--font-plex-sans), sans-serif",
          }}
        />
      </div>

      {picked.size > 0 && (
        <div
          style={{
            ...card,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            marginBottom: 12,
          }}
        >
          <span className="tabular" style={{ font: "500 12.5px var(--font-plex-sans)", color: "var(--ik)" }}>
            {picked.size} selected
          </span>
          <span style={{ flex: 1 }} />
          {OUTCOMES.map((outcome) => (
            <button
              key={outcome}
              type="button"
              disabled={busy}
              onClick={() => decide(outcome)}
              style={outcome === "accepted" ? pill : quietPill}
            >
              {outcome === "accepted" ? "Accept" : outcome === "waitlisted" ? "Waitlist" : "Reject"}
            </button>
          ))}
        </div>
      )}

      {error !== null && (
        <div style={{ ...card, padding: 14, marginBottom: 12, borderColor: "var(--cnl)", background: "var(--cnw)", color: "var(--cn)" }}>
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={filter || query ? "Nothing matches those filters" : "No proposals yet"}
          body={
            filter || query
              ? "Clear the filters to see everything."
              : "They will appear here as speakers submit."
          }
        />
      ) : (
        <div style={{ ...card, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th scope="col" style={{ ...th, width: 36 }} />
                <th scope="col" style={th}>Code</th>
                <th scope="col" style={th}>Title</th>
                <th scope="col" style={th}>Speakers</th>
                <th scope="col" style={th}>Status</th>
                <th scope="col" style={th}>Score</th>
                <th scope="col" style={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={td}>
                    <input
                      type="checkbox"
                      checked={picked.has(row.id)}
                      onChange={() => toggle(row.id)}
                      aria-label={`Select ${row.title}`}
                    />
                  </td>
                  <td className="tabular" style={{ ...td, font: "500 12.5px var(--font-plex-mono), monospace", color: "var(--i3)" }}>
                    {row.code}
                  </td>
                  <td style={{ ...td, fontWeight: 500 }}>{row.title}</td>
                  <td style={{ ...td, color: "var(--i2)" }}>
                    {row.speakers.map((s) => s.name).join(", ") || "—"}
                  </td>
                  <td style={td}>
                    <StatusBadge status={row.status} />
                    {row.decision_status === "pending_send" && (
                      <span style={{ marginLeft: 8, font: "500 11px var(--font-plex-sans)", color: "var(--pd)" }}>
                        unsent
                      </span>
                    )}
                  </td>
                  <td className="tabular" style={{ ...td, font: "500 12.5px var(--font-plex-mono), monospace" }}>
                    {row.score_avg ?? "–"}
                    {row.review_count > 0 && (
                      <span style={{ color: "var(--i4)" }}> ({row.review_count})</span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {row.status === "accepted" && (
                      <button type="button" style={quietPill} disabled={busy} onClick={() => promote(row.id)}>
                        Make a session
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
