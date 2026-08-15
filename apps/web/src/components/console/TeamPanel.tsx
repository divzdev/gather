"use client";

/** Settings → Team: everyone who can sign in to this console, and as what.
 *
 *  The Review screen adds evaluators in one step; this is where the rest of
 *  the answer to "how do I manage those?" lives — change a role, take someone
 *  off the event. Uses the members API's own guardrails (no self-changes, the
 *  owner is immovable, org-wide people cannot be removed from one event) and
 *  surfaces its error messages verbatim, because they say why.
 *
 *  This screen writes `EventMember` rows only. Org members appear here — they
 *  genuinely work on this event — but read-only, marked *Every event*, linking
 *  to Organisation → People, which is the screen that owns that decision
 *  (spec 0004). An event screen says who is here; it does not decide who
 *  belongs to the organisation.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  GRANTABLE,
  LoadFailure,
  MemberIdentity,
  ROLE_LABEL,
  RolePill,
  memberCard,
  memberInput,
  type Role,
} from "@/components/console/members";
import { pill } from "@/components/ui";
import { authed } from "@/lib/session";
import type { components } from "@/lib/api-types";

type Member = components["schemas"]["MemberRead"];

const EMPTY_DRAFT = { name: "", email: "", role: "reviewer" as Role };

const SCOPE_TEXT = {
  font: "400 11.5px var(--font-plex-sans)",
  color: "var(--i4)",
  whiteSpace: "nowrap",
} as const;

export function TeamPanel({
  eventId,
  toast,
  onManageOrg,
}: {
  eventId: string;
  toast: (m: string) => void;
  /** Opens Organisation → People. Absent for anyone the org routes would 403,
   *  so nobody is offered a door that does not open for them. */
  onManageOrg?: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [showProblems, setShowProblems] = useState(false);

  const {
    data: members,
    isPending,
    isError,
    refetch,
  } = useQuery({
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
      setDraft(EMPTY_DRAFT);
      setShowProblems(false);
      toast(`${member.name} is on the team — a sign-in link is on its way to ${member.email}.`);
    },
    onError: (error: Error) => toast(error.message),
  });

  const setRole = useMutation({
    mutationFn: (vars: { userId: string; role: Role }) =>
      authed<Member>(`/events/${eventId}/members/${vars.userId}`, {
        method: "PATCH",
        body: { role: vars.role },
      }),
    onSuccess: (member) => {
      refresh();
      toast(`${member.name} is now ${ROLE_LABEL[member.role]}.`);
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
  const nameProblem = draft.name.trim() === "" ? "They need a name." : undefined;
  const emailProblem = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email.trim())
    ? undefined
    : "That does not look like an email address.";
  const fieldError = {
    display: "block",
    marginTop: 4,
    font: "400 11.5px var(--font-plex-sans)",
    color: "var(--cn)",
  } as const;

  // Only worth saying which tier a row is on when the list actually holds both.
  // On an event where everyone is event-scoped, a column of "This event" is
  // noise; the question it answers ("why can't I open the Directory?") only
  // arises once someone on screen visibly has more reach than the reader.
  const mixedTiers = (members ?? []).some((member) => member.scope === "org");

  return (
    <div style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 14 }}>
      {isError ? (
        <LoadFailure
          what="This event's team could not be loaded, so the list below is not showing who has access. Nothing has changed."
          onRetry={() => void refetch()}
        />
      ) : (
        <div style={{ ...memberCard, overflow: "hidden" }}>
          {(members ?? []).map((member) => {
            const isSelf = member.user_id === me?.id;
            const isOrgWide = member.scope === "org";
            // Org rows carry no controls here: this screen answers "who works on
            // this event", it does not decide who belongs to the organisation.
            const fixed = member.role === "owner" || isSelf || isOrgWide;
            return (
              <div
                key={member.user_id}
                data-member-row
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--ln)",
                }}
              >
                <MemberIdentity name={member.name} email={member.email} isSelf={isSelf} />
                {isOrgWide ? (
                  onManageOrg === undefined ? (
                    <span style={SCOPE_TEXT}>Every event</span>
                  ) : (
                    <button
                      type="button"
                      onClick={onManageOrg}
                      aria-label={`${member.name} works on every event — manage on Organisation → People`}
                      title="Manage on Organisation → People"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        minHeight: 44,
                        padding: "0 4px",
                        border: "none",
                        background: "none",
                        font: "500 11.5px var(--font-plex-sans)",
                        color: "var(--sg)",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Every event ↗
                    </button>
                  )
                ) : mixedTiers ? (
                  // The other half of the same sentence: this person reaches
                  // this event and nothing else, which is why the cross-event
                  // Directory and the AI key are closed to them.
                  <span style={SCOPE_TEXT}>This event</span>
                ) : null}
                {fixed ? (
                  <RolePill role={member.role} />
                ) : (
                  <>
                    <select
                      value={member.role}
                      aria-label={`Role for ${member.name}`}
                      onChange={(event) =>
                        setRole.mutate({
                          userId: member.user_id,
                          role: event.target.value as Role,
                        })
                      }
                      style={{ ...memberInput, width: 140 }}
                    >
                      {GRANTABLE.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABEL[role]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove ${member.name} from this event`}
                      onClick={() => remove.mutate(member)}
                      style={{
                        height: 44,
                        padding: "0 15px",
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
          {isPending ? (
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
      )}

      <div style={{ ...memberCard, padding: "16px 18px" }}>
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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 140px auto",
            gap: 8,
            alignItems: "start",
          }}
        >
          <div>
            <input
              aria-label="Full name"
              aria-invalid={showProblems && nameProblem !== undefined}
              placeholder="Full name"
              value={draft.name}
              onChange={(event) => setDraft((cur) => ({ ...cur, name: event.target.value }))}
              style={{
                ...memberInput,
                width: "100%",
                borderColor: showProblems && nameProblem !== undefined ? "var(--cn)" : "var(--ls)",
              }}
            />
            {showProblems && nameProblem !== undefined ? (
              <span style={fieldError}>{nameProblem}</span>
            ) : null}
          </div>
          <div>
            <input
              aria-label="Email"
              aria-invalid={showProblems && emailProblem !== undefined}
              placeholder="Email"
              type="email"
              value={draft.email}
              onChange={(event) => setDraft((cur) => ({ ...cur, email: event.target.value }))}
              style={{
                ...memberInput,
                width: "100%",
                borderColor: showProblems && emailProblem !== undefined ? "var(--cn)" : "var(--ls)",
              }}
            />
            {showProblems && emailProblem !== undefined ? (
              <span style={fieldError}>{emailProblem}</span>
            ) : null}
          </div>
          <select
            aria-label="Role"
            value={draft.role}
            onChange={(event) => setDraft((cur) => ({ ...cur, role: event.target.value as Role }))}
            style={{ ...memberInput, width: "100%" }}
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
              setShowProblems(true);
              if (nameProblem !== undefined || emailProblem !== undefined) return;
              add.mutate();
            }}
            style={{ ...pill, height: 44, opacity: add.isPending ? 0.6 : 1 }}
          >
            {add.isPending ? "Adding…" : "Add & send link"}
          </button>
        </div>
        <span style={{ ...label, display: "block", marginTop: 10, color: "var(--i4)" }}>
          They join this event only. Anyone marked <em>Every event</em> above belongs to the
          organisation — change or remove them on Organisation&nbsp;→&nbsp;People. The owner&apos;s
          role never changes here, and nobody can change or remove themselves, so a team of one
          cannot lock itself out.
        </span>
      </div>
    </div>
  );
}
