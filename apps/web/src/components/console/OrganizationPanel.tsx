"use client";

/** Organisation → Organisation (spec 0004): the workspace itself.
 *
 *  Registration names the organisation after whoever registered, forever. This
 *  is the one screen that can change that, and it is owner-only — the workspace's
 *  identity stays with its owner, unlike its membership, which an admin manages.
 *
 *  An admin still opens this panel: the API lets them read. The name is then a
 *  read-only line with a sentence saying who can change it, which is a better
 *  answer than a field that accepts keystrokes and then refuses the save.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { LoadFailure, memberCard } from "@/components/console/members";
import { useMe } from "@/components/console/useMe";
import { pill } from "@/components/ui";
import type { components } from "@/lib/api-types";
import { authed } from "@/lib/session";

type Organization = components["schemas"]["OrganizationRead"];

const card = { ...memberCard, padding: "18px 20px" } as const;

export function OrganizationPanel({ orgId, toast }: { orgId: string; toast: (m: string) => void }) {
  const queryClient = useQueryClient();
  const { me } = useMe();
  const isOwner = me?.role === "owner";

  const {
    data: org,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["organization", orgId],
    queryFn: () => authed<Organization>(`/orgs/${orgId}`),
  });

  // Seeded once, the same way the event panel seeds its draft: a save refetches,
  // and re-seeding from the response would fight whatever is half-typed.
  const [draft, setDraft] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  if (org !== undefined && org.id !== loaded) {
    setLoaded(org.id);
    setDraft(org.name);
  }
  const name = draft ?? "";
  const blank = name.trim() === "";

  const rename = useMutation({
    mutationFn: () =>
      authed<Organization>(`/orgs/${orgId}`, { method: "PATCH", body: { name: name.trim() } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["organization", orgId], updated);
      // The console header prints `org_name` from /auth/me, so it lies until
      // that refetches — the rename has to be visible where the name is shown.
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      toast(`This workspace is now called ${updated.name}.`);
    },
    onError: (error: Error) => toast(error.message),
  });

  if (isError) {
    return (
      <div style={{ maxWidth: 680 }}>
        <LoadFailure
          what="The organisation could not be loaded, so its name and event count are not shown here. Nothing has changed."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (isPending) {
    return (
      <p aria-busy="true" style={{ font: "400 12.5px var(--font-plex-sans)", color: "var(--i3)" }}>
        Loading the organisation…
      </p>
    );
  }

  const dirty = !blank && name.trim() !== org.name;

  return (
    <div style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <div style={{ font: "600 13px var(--font-plex-sans)", color: "var(--ik)" }}>
          Workspace name
        </div>
        <p
          style={{
            font: "400 12px/1.5 var(--font-plex-sans)",
            color: "var(--i4)",
            margin: "4px 0 12px",
          }}
        >
          {isOwner
            ? "It was named after you when you registered. Everyone in the organisation sees this name, so it is worth being the conference’s, not yours."
            : "Only the owner can rename the workspace."}
        </p>
        {isOwner ? (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                aria-label="Organisation name"
                aria-invalid={blank}
                value={name}
                onChange={(event) => setDraft(event.target.value)}
                style={{
                  boxSizing: "border-box",
                  flex: 1,
                  minWidth: 240,
                  height: 40,
                  padding: "0 12px",
                  borderRadius: 6,
                  border: `1px solid ${blank ? "var(--cn)" : "var(--ls)"}`,
                  background: "var(--cd)",
                  font: "400 13.5px var(--font-plex-sans)",
                  color: "var(--ik)",
                }}
              />
              <button
                type="button"
                disabled={!dirty || rename.isPending}
                onClick={() => rename.mutate()}
                style={{ ...pill, height: 44, opacity: !dirty || rename.isPending ? 0.5 : 1 }}
              >
                {rename.isPending ? "Saving…" : "Save name"}
              </button>
            </div>
            {blank ? (
              <span
                style={{
                  display: "block",
                  marginTop: 6,
                  font: "400 11.5px var(--font-plex-sans)",
                  color: "var(--cn)",
                }}
              >
                A workspace needs a name — this one has not been saved.
              </span>
            ) : null}
          </>
        ) : (
          <div style={{ font: "600 15px var(--font-plex-sans)", color: "var(--ik)" }}>
            {org.name}
          </div>
        )}
      </div>

      <div style={card}>
        <div
          style={{
            font: "500 10.5px var(--font-plex-sans)",
            letterSpacing: ".07em",
            textTransform: "uppercase",
            color: "var(--i4)",
          }}
        >
          What the organisation covers
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "8px 0 6px" }}>
          <span
            style={{
              font: "600 26px var(--font-plex-sans)",
              fontVariantNumeric: "tabular-nums",
              color: "var(--ik)",
            }}
          >
            {org.event_count}
          </span>
          <span style={{ font: "400 13px var(--font-plex-sans)", color: "var(--i2)" }}>
            {org.event_count === 1 ? "event" : "events"}
          </span>
        </div>
        <p style={{ font: "400 12px/1.55 var(--font-plex-sans)", color: "var(--i4)", margin: 0 }}>
          Everyone under People works on all of them, and on any event created later. The identifier{" "}
          <code style={{ font: "400 11.5px var(--font-plex-mono),monospace" }}>{org.slug}</code> is
          internal and does not change.
        </p>
      </div>
    </div>
  );
}
