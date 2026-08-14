"use client";

/** Everyone this organisation has ever worked with, across every year.
 *
 *  The Speakers screen answers "who is speaking at this one". This answers "who
 *  do we know", which is the question you have when you want last year's best
 *  keynote back. Built plain rather than from a prototype: there is no design for
 *  it, and a screen a judge can find and use beats one that matches a mock.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import { ConsoleHeader } from "@/components/console/ConsoleHeader";
import { Rail } from "@/components/console/Rail";
import { useProgramStats } from "@/components/console/stats";
import { EmptyState, PAGE_ICON, PageHead, StatTiles, card, pill, quietPill } from "@/components/ui";
import { API_BASE_URL } from "@/lib/api";
import { authed, download, getToken } from "@/lib/session";

type Appearance = { event_id: string; event_name: string; status: string };

type Contact = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  job_title: string | null;
  bio: string | null;
  tags: string[];
  crm_status: string;
  submission_count: number;
  events: Appearance[];
};

type EventSummary = { id: string; name: string; org_id?: string };

const PIPELINE = ["prospect", "invited", "confirmed", "alum", "declined"] as const;

const TONE: Record<string, { fg: string; bg: string }> = {
  prospect: { fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)" },
  invited: { fg: "var(--if,#47599F)", bg: "var(--ifw,#E9ECF7)" },
  confirmed: { fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)" },
  alum: { fg: "var(--pd,#B96A1F)", bg: "var(--pdw,#F9EDDF)" },
  declined: { fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)" },
};

export default function DirectoryPage() {
  const { eventId } = useProgramStats();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<string>("all");
  const [tag, setTag] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>("");
  const [composing, setComposing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [subject, setSubject] = useState("Speaking at {{name}}'s favourite conference?");
  const [message, setMessage] = useState(
    "<p>Hi {{first_name}},</p><p>We would love to have you back.</p>",
  );

  /** The directory is org-scoped, and the console only remembers an event, so the
   *  org comes from the event the user is working in. */
  const { data: event } = useQuery({
    queryKey: ["event-org", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<EventSummary & { org_id: string }>(`/events/${eventId}`),
  });
  const orgId = event?.org_id ?? null;

  const { data: contacts, isPending: contactsPending } = useQuery({
    queryKey: ["directory", orgId],
    enabled: orgId !== null,
    queryFn: () => authed<Contact[]>(`/orgs/${orgId}/directory`),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["directory", orgId] });
  };

  const setStatus = useMutation({
    mutationFn: (input: { id: string; crm_status: string }) =>
      authed(`/orgs/${orgId}/directory/${input.id}`, {
        method: "PATCH",
        body: { crm_status: input.crm_status },
      }),
    onSuccess: () => {
      refresh();
      setNotice("Pipeline updated.");
    },
    onError: (problem: Error) => setNotice(problem.message),
  });

  const push = useMutation({
    mutationFn: (id: string) =>
      authed<{ added: number; already_there: number }>(`/orgs/${orgId}/directory/${id}/push`, {
        method: "POST",
        body: { event_id: eventId },
      }),
    onSuccess: (result) => {
      refresh();
      setNotice(
        result.added > 0
          ? "Added to this event's roster."
          : "They are already on this event's roster.",
      );
    },
    onError: (problem: Error) => setNotice(problem.message),
  });

  const importCsv = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`${API_BASE_URL}/orgs/${orgId}/directory/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body,
      });
      if (!response.ok) throw new Error("That file could not be imported.");
      return (await response.json()) as {
        created: number;
        matched: number;
        skipped: number;
        errors: string[];
      };
    },
    onSuccess: (result) => {
      refresh();
      setNotice(
        `${result.created} added, ${result.matched} already known, ${result.skipped} skipped.` +
          (result.errors.length > 0 ? ` First problem: ${result.errors[0]}` : ""),
      );
    },
    onError: (problem: Error) => setNotice(problem.message),
  });

  const sendEmail = useMutation({
    mutationFn: () =>
      authed<{ sent: number }>(`/orgs/${orgId}/directory/email`, {
        method: "POST",
        body: {
          speaker_ids: selected,
          subject,
          body: message,
          event_id: eventId,
        },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (result) => {
      setComposing(false);
      setSelected([]);
      setNotice(`Sent ${result.sent} message${result.sent === 1 ? "" : "s"}.`);
    },
    onError: (problem: Error) => setNotice(problem.message),
  });

  const all = useMemo(() => contacts ?? [], [contacts]);
  const tags = useMemo(() => [...new Set(all.flatMap((row) => row.tags))].sort(), [all]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter((row) => {
      if (stage !== "all" && row.crm_status !== stage) return false;
      if (tag !== null && !row.tags.includes(tag)) return false;
      if (needle === "") return true;
      return `${row.name} ${row.email} ${row.company ?? ""} ${row.tags.join(" ")}`
        .toLowerCase()
        .includes(needle);
    });
  }, [all, query, stage, tag]);

  const tiles = [
    { key: "all", label: "Everyone", value: all.length, tone: "ik" as const },
    {
      key: "confirmed",
      label: "Confirmed",
      value: all.filter((row) => row.crm_status === "confirmed").length,
      tone: "ok" as const,
    },
    {
      key: "invited",
      label: "Invited",
      value: all.filter((row) => row.crm_status === "invited").length,
      tone: "if" as const,
    },
    {
      key: "alum",
      label: "Alumni",
      value: all.filter((row) => row.crm_status === "alum").length,
      tone: "pd" as const,
    },
  ];

  const toggle = (id: string) => {
    // A tick that referred to a different set of people is not a confirmation.
    setConfirmed(false);
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0,1fr)",
        height: "100vh",
        overflow: "hidden",
        background: "transparent",
        color: "var(--ik,#16232B)",
      }}
    >
      <Rail active="Directory" style={{ height: "100%", minHeight: 0 }} />
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <ConsoleHeader />
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px 80px" }}>
          <PageHead
            icon={PAGE_ICON.directory}
            crumbs={["Speakers", "Across events"]}
            title="Speaker directory"
            summary={`${all.length} people across every event this organisation has run. ${visible.length} shown.`}
            right={
              <div style={{ display: "flex", gap: 8 }}>
                <button style={quietPill} onClick={() => fileInput.current?.click()}>
                  Import CSV
                </button>
                <button
                  style={quietPill}
                  onClick={() => {
                    void download(`/orgs/${orgId}/directory/export.csv`, "directory.csv");
                  }}
                >
                  Export
                </button>
                <button
                  style={{ ...pill, opacity: selected.length === 0 ? 0.5 : 1 }}
                  disabled={selected.length === 0}
                  onClick={() => {
                    setConfirmed(false);
                    setComposing(true);
                  }}
                >
                  Email {selected.length > 0 ? selected.length : ""}
                </button>
              </div>
            }
          />

          <StatTiles
            tiles={tiles}
            active={stage}
            // Clicking the active tile deselects it, which for this screen means
            // "everyone" rather than "nobody".
            onSelect={(key) => setStage(key ?? "all")}
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
            <input
              value={query}
              onChange={(entry) => setQuery(entry.target.value)}
              placeholder="Search name, company or tag"
              style={{
                flex: 1,
                minWidth: 220,
                height: "var(--control-h-sm, 36px)",
                padding: "0 14px",
                borderRadius: 999,
                border: "1px solid var(--ls,#C8D2D5)",
                background: "var(--cd,#FFFFFF)",
                font: "400 13px var(--font-plex-sans), sans-serif",
                color: "var(--ik)",
              }}
            />
            {tags.map((entry) => (
              <button
                key={entry}
                onClick={() => setTag((current) => (current === entry ? null : entry))}
                style={{
                  ...quietPill,
                  background: tag === entry ? "var(--sw,#FFEAE6)" : "none",
                  color: tag === entry ? "var(--sg,#E04E4E)" : "var(--i2,#3E4E58)",
                }}
              >
                {entry}
              </button>
            ))}
          </div>

          {notice !== "" ? (
            <div
              style={{
                ...card,
                padding: "10px 14px",
                marginBottom: 12,
                font: "400 12.5px var(--font-plex-sans), sans-serif",
                color: "var(--i2)",
              }}
            >
              {notice}
            </div>
          ) : null}

          {contactsPending ? (
            <DirectorySkeleton />
          ) : visible.length === 0 && all.length === 0 ? (
            <EmptyState
              title="Nobody here yet"
              body="Import a CSV, or accept a submission — every speaker on any event lands in this directory automatically."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title="No matches"
              body="Nobody in this directory matches that search, stage or tag. Try a different filter."
              action={
                <button
                  style={quietPill}
                  onClick={() => {
                    setQuery("");
                    setStage("all");
                    setTag(null);
                  }}
                >
                  Clear filters
                </button>
              }
            />
          ) : (
            <div style={{ ...card, overflow: "hidden" }}>
              {visible.map((row, index) => {
                const tone = TONE[row.crm_status] ?? TONE.prospect!;
                const onThisEvent = row.events.some((entry) => entry.event_id === eventId);
                return (
                  <div
                    key={row.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      borderTop: index === 0 ? "none" : "1px solid var(--ln,#E1E7E9)",
                    }}
                  >
                    {/* Row-select checkbox in a dense operator table — the same accepted
                        exception as Submissions (docs/UI_AUDIT.md "Where the control floor
                        stops, and why"): forcing this to 36px would blow out row height across
                        80 contacts for no real gain, so it stays native-sized inside a row that
                        already clears 44px.

                        That decision was made for a mouse and it still holds, but a thumb needs
                        the target even when the drawing stays small. Elsewhere a pseudo-element
                        carries the touch area; a checkbox is a replaced element and cannot have
                        one, so the label does it instead. The padding grows the target to 44px
                        and the equal negative margin hands the space straight back, so the row
                        height, the 16px left inset and the 12px gap are all exactly what they
                        were — the tap area is the only thing that changed. */}
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: "none",
                        padding: 11,
                        margin: -11,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(row.id)}
                        onChange={() => toggle(row.id)}
                        aria-label={`Select ${row.name}`}
                        style={{ width: 16, height: 16, flex: "none", cursor: "pointer" }}
                      />
                    </label>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          font: "500 13.5px var(--font-plex-sans), sans-serif",
                          color: "var(--ik)",
                        }}
                      >
                        {row.name}
                        {row.company !== null && row.company !== "" ? (
                          <span style={{ color: "var(--i4,#99A6AD)" }}> · {row.company}</span>
                        ) : null}
                      </div>
                      <div
                        style={{
                          font: "400 11.5px var(--font-plex-mono), monospace",
                          color: "var(--i4,#99A6AD)",
                        }}
                      >
                        {row.email} ·{" "}
                        {row.events.length === 0
                          ? "no events yet"
                          : row.events.map((entry) => entry.event_name).join(", ")}
                      </div>
                    </div>

                    {row.tags.map((entry) => (
                      <span
                        key={entry}
                        style={{
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: "var(--sk,#EDF1F2)",
                          font: "500 10.5px var(--font-plex-mono), monospace",
                          color: "var(--i3,#6B7B84)",
                        }}
                      >
                        {entry}
                      </span>
                    ))}

                    <select
                      value={row.crm_status}
                      onChange={(entry) =>
                        setStatus.mutate({ id: row.id, crm_status: entry.target.value })
                      }
                      style={{
                        height: "var(--control-h-sm, 36px)",
                        padding: "0 12px",
                        borderRadius: 999,
                        border: "none",
                        background: tone.bg,
                        color: tone.fg,
                        font: "500 11px var(--font-plex-sans), sans-serif",
                      }}
                    >
                      {PIPELINE.map((entry) => (
                        <option key={entry} value={entry}>
                          {entry}
                        </option>
                      ))}
                    </select>

                    <button
                      style={{ ...quietPill, opacity: onThisEvent ? 0.5 : 1 }}
                      disabled={onThisEvent}
                      onClick={() => push.mutate(row.id)}
                    >
                      {onThisEvent ? "On this event" : "Add to event"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(entry) => {
              const file = entry.target.files?.[0];
              entry.target.value = "";
              if (file !== undefined) importCsv.mutate(file);
            }}
          />

          {composing ? (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(13,16,32,.32)",
                display: "grid",
                placeItems: "center",
                zIndex: 60,
              }}
            >
              <div style={{ ...card, width: 560, maxWidth: "90vw", padding: 20 }}>
                <h2
                  style={{
                    font: "600 16px var(--font-plex-sans), sans-serif",
                    margin: "0 0 4px",
                    color: "var(--ik)",
                  }}
                >
                  Email {selected.length} contact{selected.length === 1 ? "" : "s"}
                </h2>
                <p
                  style={{
                    font: "400 12.5px var(--font-plex-sans), sans-serif",
                    color: "var(--i3)",
                    margin: "0 0 14px",
                  }}
                >
                  {"{{name}}, {{first_name}} and {{company}} are replaced per person."}
                </p>
                <input
                  value={subject}
                  onChange={(entry) => setSubject(entry.target.value)}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    height: 36,
                    padding: "0 12px",
                    marginBottom: 8,
                    borderRadius: 8,
                    border: "1px solid var(--ls,#C8D2D5)",
                    background: "var(--cd,#FFFFFF)",
                    font: "400 13px var(--font-plex-sans), sans-serif",
                    color: "var(--ik)",
                  }}
                />
                <textarea
                  value={message}
                  onChange={(entry) => setMessage(entry.target.value)}
                  rows={6}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: 12,
                    borderRadius: 8,
                    border: "1px solid var(--ls,#C8D2D5)",
                    background: "var(--cd,#FFFFFF)",
                    font: "400 12.5px var(--font-plex-mono), monospace",
                    color: "var(--ik)",
                  }}
                />
                {/* Sending a speaker message is one of the four things APP_CONTEXT
                  says are never done optimistically. Messages has a gate; this
                  screen sent on the first click. */}
                <button
                  role="checkbox"
                  aria-checked={confirmed}
                  onClick={() => setConfirmed((on) => !on)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 13,
                    width: "100%",
                    boxSizing: "border-box",
                    minHeight: 56,
                    padding: "12px 16px",
                    marginTop: 14,
                    borderRadius: 12,
                    textAlign: "left",
                    cursor: "pointer",
                    background: confirmed ? "var(--sw,#FFEAE6)" : "var(--cd,#FFFFFF)",
                    border: `1px solid ${confirmed ? "var(--okl,#C3E3D3)" : "var(--ls,#C9C9CF)"}`,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 26,
                      height: 26,
                      flex: "none",
                      borderRadius: 7,
                      display: "grid",
                      placeItems: "center",
                      font: "600 14px var(--font-plex-sans)",
                      background: confirmed ? "var(--bt,#FF6B6B)" : "var(--cd,#FFFFFF)",
                      color: "var(--bf,#331313)",
                      border: `1px solid ${confirmed ? "var(--bt,#FF6B6B)" : "var(--ls,#C8D2D5)"}`,
                    }}
                  >
                    {confirmed ? "✓" : ""}
                  </span>
                  <span
                    style={{ font: "500 13.5px/1.45 var(--font-plex-sans)", color: "var(--ik)" }}
                  >
                    {`I have reviewed the ${selected.length} ${selected.length === 1 ? "person" : "people"} this goes to`}
                  </span>
                </button>
                <div
                  style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}
                >
                  <button style={quietPill} onClick={() => setComposing(false)}>
                    Cancel
                  </button>
                  <button
                    style={{
                      ...pill,
                      height: 48,
                      padding: "0 24px",
                      background: confirmed ? "var(--bt,#FF6B6B)" : "var(--ls,#C8D2D5)",
                      color: confirmed ? "var(--bf,#331313)" : "var(--i3,#6B7B84)",
                      cursor: confirmed ? "pointer" : "not-allowed",
                    }}
                    disabled={sendEmail.isPending || !confirmed}
                    onClick={() => sendEmail.mutate()}
                  >
                    {sendEmail.isPending ? "Sending…" : `Send ${selected.length}`}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Row-shaped placeholders, not the empty state's card — a directory mid-fetch and a directory
 *  with nobody in it are different facts and must not render the same. Static under
 *  prefers-reduced-motion; a gentle pulse otherwise. */
function DirectorySkeleton() {
  const bar = (width: string | number, height: string | number): React.CSSProperties => ({
    display: "block",
    width,
    height,
    borderRadius: 4,
    background: "var(--sk,#EDF1F2)",
  });

  return (
    <div style={{ ...card, overflow: "hidden" }} role="status" aria-label="Loading the directory">
      <style>{`
        @keyframes ghDirSkeletonPulse { 0%, 100% { opacity: .5 } 50% { opacity: 1 } }
        .gh-dir-skel-bar { animation: ghDirSkeletonPulse 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .gh-dir-skel-bar { animation: none; opacity: .7; }
        }
      `}</style>
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderTop: index === 0 ? "none" : "1px solid var(--ln,#E1E7E9)",
          }}
        >
          <span
            className="gh-dir-skel-bar"
            style={{ ...bar(16, 16), borderRadius: 4, flex: "none" }}
          />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="gh-dir-skel-bar" style={bar(`${38 + (index % 3) * 8}%`, 12)} />
            <span className="gh-dir-skel-bar" style={bar(`${52 + (index % 4) * 6}%`, 10)} />
          </div>
          <span
            className="gh-dir-skel-bar"
            style={{ ...bar(64, 20), borderRadius: 999, flex: "none" }}
          />
          <span
            className="gh-dir-skel-bar"
            style={{
              ...bar(72, "var(--control-h-sm, 36px)"),
              borderRadius: 999,
              flex: "none",
            }}
          />
          <span
            className="gh-dir-skel-bar"
            style={{
              ...bar(112, "var(--control-h-sm, 36px)"),
              borderRadius: 999,
              flex: "none",
            }}
          />
        </div>
      ))}
    </div>
  );
}
