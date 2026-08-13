"use client";

/** Settings → Team: everyone who can sign in to this console, and as what.
 *
 *  The Review screen adds evaluators in one step; this is where the rest of
 *  the answer to "how do I manage those?" lives — change a role, take someone
 *  off the event. Uses the members API's own guardrails (no self-changes, the
 *  owner is immovable, org-wide people cannot be removed from one event) and
 *  surfaces its error messages verbatim, because they say why.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authed } from "@/lib/session";
import { pill } from "@/components/ui";

type Member = { user_id: string; name: string; email: string; role: string };

const GRANTABLE = ["admin", "coordinator", "reviewer"] as const;

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  coordinator: "Coordinator",
  reviewer: "Reviewer",
};

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function TeamPanel({ eventId, toast }: { eventId: string; toast: (m: string) => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({ name: "", email: "", role: "reviewer" });

  const { data: members } = useQuery({
    queryKey: ["members", eventId],
    queryFn: () => authed<Member[]>(`/events/${eventId}/members`),
  });
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => authed<{ id: string }>("/auth/me"),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["members", eventId] });

  const add = useMutation({
    mutationFn: () =>
      authed<Member>(`/events/${eventId}/members`, {
        method: "POST",
        body: { name: draft.name.trim(), email: draft.email.trim(), role: draft.role },
      }),
    onSuccess: (member) => {
      refresh();
      setDraft({ name: "", email: "", role: "reviewer" });
      toast(`${member.name} is on the team — a sign-in link is on its way to ${member.email}.`);
    },
    onError: (error: Error) => toast(error.message),
  });

  const setRole = useMutation({
    mutationFn: (vars: { userId: string; role: string }) =>
      authed<Member>(`/events/${eventId}/members/${vars.userId}`, {
        method: "PATCH",
        body: { role: vars.role },
      }),
    onSuccess: (member) => {
      refresh();
      toast(`${member.name} is now ${ROLE_LABEL[member.role] ?? member.role}.`);
    },
    onError: (error: Error) => toast(error.message),
  });

  const remove = useMutation({
    mutationFn: (member: Member) =>
      authed(`/events/${eventId}/members/${member.user_id}`, { method: "DELETE" }),
    onSuccess: (_result, member) => {
      refresh();
      toast(`${member.name} no longer has access to this event.`);
    },
    onError: (error: Error) => toast(error.message),
  });

  const label = { font: "500 12px var(--font-plex-sans)", color: "var(--i2)" } as const;
  const input = {
    boxSizing: "border-box",
    height: 36,
    padding: "0 12px",
    borderRadius: 6,
    border: "1px solid var(--ls)",
    background: "var(--cd)",
    font: "400 13px var(--font-plex-sans)",
    color: "var(--ik)",
  } as const;

  return (
    <div style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          border: "1px solid var(--ln)",
          borderRadius: 12,
          background: "var(--cd)",
          overflow: "hidden",
        }}
      >
        {(members ?? []).map((member) => {
          const isSelf = member.user_id === me?.id;
          const fixed = member.role === "owner" || isSelf;
          return (
            <div
              key={member.user_id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                borderBottom: "1px solid var(--ln)",
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "var(--sk)",
                  border: "1px solid var(--ln)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  font: "600 11px var(--font-plex-condensed),sans-serif",
                  color: "var(--i3)",
                  flex: "none",
                }}
              >
                {initials(member.name)}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    font: "600 13px var(--font-plex-sans)",
                    color: "var(--ik)",
                  }}
                >
                  {member.name}
                  {isSelf ? " (you)" : ""}
                </span>
                <span
                  style={{
                    display: "block",
                    font: "400 11.5px var(--font-plex-sans)",
                    color: "var(--i4)",
                  }}
                >
                  {member.email}
                </span>
              </span>
              {fixed ? (
                <span
                  style={{
                    padding: "4px 11px",
                    borderRadius: 999,
                    border: "1px solid var(--ls)",
                    font: "500 12px var(--font-plex-sans)",
                    color: "var(--i3)",
                  }}
                >
                  {ROLE_LABEL[member.role] ?? member.role}
                </span>
              ) : (
                <>
                  <select
                    value={member.role}
                    aria-label={`Role for ${member.name}`}
                    onChange={(event) =>
                      setRole.mutate({ userId: member.user_id, role: event.target.value })
                    }
                    style={{ ...input, width: 140 }}
                  >
                    {GRANTABLE.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABEL[role]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => remove.mutate(member)}
                    style={{
                      height: 36,
                      padding: "0 13px",
                      borderRadius: 999,
                      border: "1px solid var(--cnl,#F3C7C2)",
                      background: "none",
                      font: "500 12px var(--font-plex-sans)",
                      color: "var(--cn)",
                      cursor: "pointer",
                    }}
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          );
        })}
        {(members ?? []).length === 0 ? (
          <div
            style={{
              padding: "18px 16px",
              font: "400 12.5px var(--font-plex-sans)",
              color: "var(--i3)",
            }}
          >
            Loading the team…
          </div>
        ) : null}
      </div>

      <div
        style={{
          border: "1px solid var(--ln)",
          borderRadius: 12,
          background: "var(--cd)",
          padding: "16px 18px",
        }}
      >
        <div
          style={{ font: "600 13px var(--font-plex-sans)", color: "var(--ik)", marginBottom: 4 }}
        >
          Add someone
        </div>
        <p
          style={{
            font: "400 12px/1.5 var(--font-plex-sans)",
            color: "var(--i4)",
            margin: "0 0 12px",
          }}
        >
          They get an email that signs them in — no password, no account setup. Reviewers score;
          coordinators run the programme day to day; admins can do everything except own the
          workspace.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 130px auto", gap: 8 }}>
          <input
            aria-label="Full name"
            placeholder="Full name"
            value={draft.name}
            onChange={(event) => setDraft((cur) => ({ ...cur, name: event.target.value }))}
            style={input}
          />
          <input
            aria-label="Email"
            placeholder="Email"
            type="email"
            value={draft.email}
            onChange={(event) => setDraft((cur) => ({ ...cur, email: event.target.value }))}
            style={input}
          />
          <select
            aria-label="Role"
            value={draft.role}
            onChange={(event) => setDraft((cur) => ({ ...cur, role: event.target.value }))}
            style={input}
          >
            {GRANTABLE.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={add.isPending}
            onClick={() => {
              if (draft.name.trim() === "") return toast("They need a name.");
              if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email.trim())) {
                return toast("That does not look like an email address.");
              }
              return add.mutate();
            }}
            style={{ ...pill, opacity: add.isPending ? 0.6 : 1 }}
          >
            {add.isPending ? "Adding…" : "Add & send link"}
          </button>
        </div>
        <span style={{ ...label, display: "block", marginTop: 10, color: "var(--i4)" }}>
          The owner&apos;s role never changes here, and nobody can change or remove themselves — so
          a team of one cannot lock itself out.
        </span>
      </div>
    </div>
  );
}
