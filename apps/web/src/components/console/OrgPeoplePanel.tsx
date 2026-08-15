"use client";

/** Organisation → People (spec 0004): who works on **every** event.
 *
 *  Deliberately not the event Team panel. This screen writes `OrgMember` rows
 *  through org routes only; the Team panel writes `EventMember` rows through
 *  event routes only. Neither reaches across, which is the whole point of the
 *  separation and is asserted by a test rather than left to review.
 *
 *  Removing someone here costs them every event this organisation runs, and
 *  that consequence is off-screen, so it confirms with the count. Adding does
 *  not confirm: it only hands out access, and the mistake is undone by removing.
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
import { useMe } from "@/components/console/useMe";
import { pill } from "@/components/ui";
import type { components } from "@/lib/api-types";
import { authed } from "@/lib/session";

type OrgMember = components["schemas"]["OrgMemberRead"];

const EMPTY_DRAFT = { name: "", email: "", role: "coordinator" as Role };

/** Client-side for speed; the API validates for truth. Keyed by field so the
 *  message lands on the input that failed rather than in a toast that leaves the
 *  person hunting for which box was wrong. */
function problems(draft: typeof EMPTY_DRAFT): { name?: string; email?: string } {
  const found: { name?: string; email?: string } = {};
  if (draft.name.trim() === "") found.name = "They need a name.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email.trim())) {
    found.email = "That does not look like an email address.";
  }
  return found;
}

const FIELD_ERROR = {
  display: "block",
  marginTop: 4,
  font: "400 11.5px var(--font-plex-sans)",
  color: "var(--cn)",
} as const;

export function OrgPeoplePanel({ orgId, toast }: { orgId: string; toast: (m: string) => void }) {
  const queryClient = useQueryClient();
  const { me } = useMe();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [showProblems, setShowProblems] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const {
    data: members,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["org-members", orgId],
    queryFn: () => authed<OrgMember[]>(`/orgs/${orgId}/members`),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["org-members", orgId] });
    // The event Team list unions both tiers, so it goes stale on every write here.
    void queryClient.invalidateQueries({ queryKey: ["members"] });
  };

  const add = useMutation({
    mutationFn: () =>
      authed<OrgMember>(`/orgs/${orgId}/members`, {
        method: "POST",
        body: { name: draft.name.trim(), email: draft.email.trim(), role: draft.role },
      }),
    onSuccess: (member) => {
      refresh();
      setDraft(EMPTY_DRAFT);
      setShowProblems(false);
      toast(
        `${member.name} works on every event — a sign-in link is on its way to ${member.email}.`,
      );
    },
    onError: (error: Error) => toast(error.message),
  });

  const setRole = useMutation({
    mutationFn: (vars: { userId: string; role: Role }) =>
      authed<OrgMember>(`/orgs/${orgId}/members/${vars.userId}`, {
        method: "PATCH",
        body: { role: vars.role },
      }),
    onSuccess: (member) => {
      refresh();
      toast(`${member.name} is now ${ROLE_LABEL[member.role]} on every event.`);
    },
    onError: (error: Error) => toast(error.message),
  });

  const remove = useMutation({
    mutationFn: (member: OrgMember) =>
      authed(`/orgs/${orgId}/members/${member.user_id}`, { method: "DELETE" }),
    onSuccess: (_result, member) => {
      refresh();
      setConfirming(null);
      toast(`${member.name} no longer works on every event.`);
    },
    onError: (error: Error) => toast(error.message),
  });

  const invalid = problems(draft);

  return (
    <div style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, font: "400 12.5px/1.6 var(--font-plex-sans)", color: "var(--i3)" }}>
        These people work on <strong style={{ color: "var(--i2)" }}>every event</strong> this
        organisation runs, including ones not created yet, and they are the only people who reach
        the cross-event Directory and the AI key. To put someone on one event only, use that
        event&rsquo;s Team panel instead.
      </p>

      {isError ? (
        <LoadFailure
          what="The organisation's people could not be loaded, so this list is not showing who belongs to it. Nothing has changed."
          onRetry={() => void refetch()}
        />
      ) : (
        <div style={{ ...memberCard, overflow: "hidden" }}>
          {(members ?? []).map((member) => {
            const isSelf = member.email === me?.email;
            // The owner and the signed-in user carry no controls: the owner
            // because the organisation would otherwise be able to reach zero
            // members, and yourself because nobody quietly drops their own access.
            const fixed = member.role === "owner" || isSelf;
            const losing = member.events_covered;
            const isConfirming = confirming === member.user_id;
            return (
              <div key={member.user_id} style={{ borderBottom: "1px solid var(--ln)" }}>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}
                >
                  <MemberIdentity name={member.name} email={member.email} isSelf={isSelf} />
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
                        aria-label={`Remove ${member.name}`}
                        aria-expanded={isConfirming}
                        onClick={() => setConfirming(isConfirming ? null : member.user_id)}
                        style={{
                          height: 44,
                          padding: "0 15px",
                          borderRadius: 999,
                          border: "1px solid var(--cnl,#F3C7C2)",
                          background: isConfirming ? "var(--cnw,#FBEAE7)" : "none",
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
                {isConfirming ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                      padding: "12px 16px 14px 60px",
                      background: "var(--cnw,#FBEAE7)",
                      borderTop: "1px solid var(--cnl,#F3C7C2)",
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        minWidth: 260,
                        font: "400 12.5px/1.55 var(--font-plex-sans)",
                        color: "var(--i2)",
                      }}
                    >
                      <strong style={{ font: "600 12.5px var(--font-plex-sans)" }}>
                        {member.name} loses access to {losing} {losing === 1 ? "event" : "events"}.
                      </strong>{" "}
                      Any event they were added to individually keeps them — remove them there too
                      if they should lose everything.
                    </span>
                    <button
                      type="button"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(member)}
                      style={{
                        height: 44,
                        padding: "0 16px",
                        borderRadius: 999,
                        border: "none",
                        background: "var(--cn)",
                        font: "600 12px var(--font-plex-sans)",
                        color: "#fff",
                        cursor: "pointer",
                        opacity: remove.isPending ? 0.6 : 1,
                      }}
                    >
                      {remove.isPending ? "Removing…" : "Remove from organisation"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      style={{
                        height: 44,
                        padding: "0 16px",
                        borderRadius: 999,
                        border: "1px solid var(--ls)",
                        background: "var(--cd)",
                        font: "500 12px var(--font-plex-sans)",
                        color: "var(--i2)",
                        cursor: "pointer",
                      }}
                    >
                      Keep
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
          {isPending || members?.length === 0 ? (
            <div
              style={{
                padding: "18px 16px",
                font: "400 12.5px var(--font-plex-sans)",
                color: "var(--i3)",
              }}
            >
              {isPending
                ? "Loading the organisation’s people…"
                : "Nobody works on every event yet. Add someone below and they get every event this organisation runs, including the ones you have not created."}
            </div>
          ) : null}
        </div>
      )}

      <div style={{ ...memberCard, padding: "16px 18px" }}>
        <div
          style={{ font: "600 13px var(--font-plex-sans)", color: "var(--ik)", marginBottom: 4 }}
        >
          Add someone to the organisation
        </div>
        <p
          style={{
            font: "400 12px/1.5 var(--font-plex-sans)",
            color: "var(--i4)",
            margin: "0 0 12px",
          }}
        >
          They get an email that signs them in — no password, no account setup — and the role you
          pick applies to every event, unless that event gives them a different one.
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
              aria-invalid={showProblems && invalid.name !== undefined}
              placeholder="Full name"
              value={draft.name}
              onChange={(event) => setDraft((cur) => ({ ...cur, name: event.target.value }))}
              style={{
                ...memberInput,
                width: "100%",
                borderColor: showProblems && invalid.name !== undefined ? "var(--cn)" : "var(--ls)",
              }}
            />
            {showProblems && invalid.name !== undefined ? (
              <span style={FIELD_ERROR}>{invalid.name}</span>
            ) : null}
          </div>
          <div>
            <input
              aria-label="Email"
              aria-invalid={showProblems && invalid.email !== undefined}
              placeholder="Email"
              type="email"
              value={draft.email}
              onChange={(event) => setDraft((cur) => ({ ...cur, email: event.target.value }))}
              style={{
                ...memberInput,
                width: "100%",
                borderColor:
                  showProblems && invalid.email !== undefined ? "var(--cn)" : "var(--ls)",
              }}
            />
            {showProblems && invalid.email !== undefined ? (
              <span style={FIELD_ERROR}>{invalid.email}</span>
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
              if (Object.keys(problems(draft)).length > 0) return;
              add.mutate();
            }}
            style={{ ...pill, height: 44, opacity: add.isPending ? 0.6 : 1 }}
          >
            {add.isPending ? "Adding…" : "Add & send link"}
          </button>
        </div>
      </div>
    </div>
  );
}
