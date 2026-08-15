"use client";

/** What the two membership lists share.
 *
 *  Settings → Team writes `EventMember` rows and Settings → Organisation →
 *  People writes `OrgMember` rows; the two are deliberately separate screens on
 *  separate routes (spec 0004). What they are not separate about is how a person
 *  is *drawn* — the same avatar, name, email and role vocabulary — so that lives
 *  here rather than in two copies that drift.
 *
 *  The controls stay with each panel: one offers a role select and a remove, the
 *  other a counted confirm, and merging those would be merging the tiers again.
 */

import type { components } from "@/lib/api-types";

export type Role = components["schemas"]["Role"];

/** Ownership is transferred, never granted — at both tiers. */
export const GRANTABLE = ["admin", "coordinator", "reviewer"] as const;

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  coordinator: "Coordinator",
  reviewer: "Reviewer",
};

export const memberInput = {
  boxSizing: "border-box",
  height: 40,
  padding: "0 12px",
  borderRadius: 6,
  border: "1px solid var(--ls)",
  background: "var(--cd)",
  font: "400 13px var(--font-plex-sans)",
  color: "var(--ik)",
} as const;

export const memberCard = {
  border: "1px solid var(--ln)",
  borderRadius: 12,
  background: "var(--cd)",
} as const;

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Avatar, name and address — the part of a row that says *who*. */
export function MemberIdentity({
  name,
  email,
  isSelf,
}: {
  name: string;
  email: string;
  isSelf: boolean;
}) {
  return (
    <>
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
        {initials(name)}
      </span>
      <span data-member-name style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{ display: "block", font: "600 13px var(--font-plex-sans)", color: "var(--ik)" }}
        >
          {name}
          {isSelf ? " (you)" : ""}
        </span>
        <span
          style={{ display: "block", font: "400 11.5px var(--font-plex-sans)", color: "var(--i4)" }}
        >
          {email}
        </span>
      </span>
    </>
  );
}

/** A role shown as text because this screen may not change it. */
export function RolePill({ role }: { role: Role }) {
  return (
    <span
      style={{
        padding: "4px 11px",
        borderRadius: 999,
        border: "1px solid var(--ls)",
        font: "500 12px var(--font-plex-sans)",
        color: "var(--i3)",
      }}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

/** What a list says when it could not load. Never a blank panel: the reason,
 *  and the retry, in the place the rows would have been. */
export function LoadFailure({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        border: "1px solid var(--cnl,#F3C7C2)",
        background: "var(--cnw,#FBE8E6)",
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 240,
          font: "400 12.5px/1.55 var(--font-plex-sans)",
          color: "var(--cn)",
        }}
      >
        {what}
      </span>
      <button
        type="button"
        onClick={onRetry}
        style={{
          height: 40,
          padding: "0 16px",
          borderRadius: 999,
          border: "1px solid var(--cnl,#F3C7C2)",
          background: "var(--cd)",
          font: "500 12px var(--font-plex-sans)",
          color: "var(--cn)",
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
