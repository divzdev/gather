"use client";

/** Your own profile.
 *
 *  The user menu offered "Your profile" from the first prototype and it never
 *  led anywhere: first a toast describing a screen that did not exist, then —
 *  worse — the event's settings, which are not yours and not about you.
 *
 *  Deliberately small. Name and list density are yours to change. Email is the
 *  login identity, and role and organisation are membership someone else
 *  granted, so both are shown and neither is editable here.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Rail } from "@/components/console/Rail";
import { PAGE_ICON, PageHead, card, pill, quietPill } from "@/components/ui";
import { authed } from "@/lib/session";

type Me = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  density_pref: string;
  role: string;
  org_name: string | null;
};

const DENSITIES = ["comfortable", "compact"] as const;

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<{ name: string; density: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState("");

  const {
    data: me,
    isPending,
    error: loadError,
    refetch,
  } = useQuery({ queryKey: ["me"], queryFn: () => authed<Me>("/auth/me") });

  const save = useMutation({
    mutationFn: (body: { name: string; density_pref: string }) =>
      authed<Me>("/auth/me", { method: "PATCH", body }),
    onSuccess: () => {
      // The rail and every console header read the same query.
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      setSaved(true);
      setProblem("");
      window.setTimeout(() => setSaved(false), 2500);
    },
    onError: (error: Error) => setProblem(error.message),
  });

  const name = draft?.name ?? me?.name ?? "";
  const density = draft?.density ?? me?.density_pref ?? "compact";
  const dirty = me !== undefined && (name !== me.name || density !== me.density_pref);
  // The server rejects it too, but a round trip to be told your name is blank
  // is a worse answer than the field saying so before you press Save.
  const nameError = dirty && name.trim() === "" ? "Your name cannot be empty." : "";
  const canSave = dirty && nameError === "" && !save.isPending;

  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ font: "500 12.5px var(--font-plex-sans)", color: "var(--i2)" }}>{label}</span>
      {node}
      {hint !== undefined && hint !== "" && (
        <span role="alert" style={{ font: "400 12px var(--font-plex-sans)", color: "var(--cn)" }}>
          {hint}
        </span>
      )}
    </label>
  );

  const input: React.CSSProperties = {
    boxSizing: "border-box",
    height: "var(--control-h-md, 44px)",
    padding: "0 12px",
    borderRadius: 8,
    border: "1px solid var(--ls)",
    background: "var(--cd)",
    color: "var(--ik)",
    font: "400 13.5px var(--font-plex-sans)",
  };

  const frame = (body: React.ReactNode) => (
    <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", height: "100vh" }}>
      <Rail active="Settings" style={{ height: "100%", minHeight: 0 }} />
      <div style={{ overflowY: "auto", background: "transparent" }}>
        <div style={{ padding: "20px 28px 80px", maxWidth: 640 }}>
          <PageHead
            icon={PAGE_ICON.profile}
            title="Your profile"
            summary="How you appear to the rest of the team."
          />
          {body}
        </div>
      </div>
    </div>
  );

  if (isPending) {
    return frame(
      <div style={{ ...card, padding: 20 }}>
        <p style={{ font: "400 13.5px var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}>
          Loading your account…
        </p>
      </div>,
    );
  }

  if (loadError !== null || me === undefined) {
    return frame(
      <div style={{ ...card, padding: 20, display: "grid", gap: 14, justifyItems: "start" }}>
        <p style={{ font: "400 13.5px/1.6 var(--font-plex-sans)", color: "var(--ik)", margin: 0 }}>
          Your account did not load. {loadError?.message ?? "The server did not answer."}
        </p>
        <button style={quietPill} onClick={() => void refetch()}>
          Try again
        </button>
      </div>,
    );
  }

  return frame(
    <>
      <div style={{ ...card, padding: 20, display: "grid", gap: 16 }}>
        {field(
          "Name",
          <input
            value={name}
            aria-invalid={nameError !== ""}
            onChange={(event) => setDraft({ name: event.target.value, density })}
            style={{
              ...input,
              border: `1px solid ${nameError === "" ? "var(--ls)" : "var(--cn)"}`,
            }}
          />,
          nameError,
        )}

        {field(
          "Email",
          <input value={me.email} readOnly disabled style={{ ...input, color: "var(--i3)" }} />,
        )}
        <p
          style={{
            font: "400 12px var(--font-plex-sans)",
            color: "var(--i4)",
            margin: "-10px 0 0",
          }}
        >
          Your email is how you sign in, so it is changed through account recovery rather than here.
        </p>

        {field(
          "List density",
          <select
            value={density}
            onChange={(event) => setDraft({ name, density: event.target.value })}
            style={input}
          >
            {DENSITIES.map((option) => (
              <option key={option} value={option}>
                {option.replace(/^./, (letter) => letter.toUpperCase())}
              </option>
            ))}
          </select>,
        )}
        <p
          style={{
            font: "400 12px/1.6 var(--font-plex-sans)",
            color: "var(--i4)",
            margin: "-10px 0 0",
          }}
        >
          How tall a row is in the console&rsquo;s lists. The Compact/Comfortable toggle above a
          table is this same setting, so changing it in either place sticks.
        </p>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            style={
              canSave
                ? pill
                : { ...pill, background: "var(--ls)", color: "var(--i3)", cursor: "not-allowed" }
            }
            disabled={!canSave}
            onClick={() => save.mutate({ name: name.trim(), density_pref: density })}
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
          {saved && (
            <span style={{ font: "500 12.5px var(--font-plex-sans)", color: "var(--ok)" }}>
              Saved.
            </span>
          )}
        </div>

        {problem !== "" && (
          <p
            role="alert"
            style={{ font: "400 12.5px var(--font-plex-sans)", color: "var(--cn)", margin: 0 }}
          >
            {problem}
          </p>
        )}
      </div>

      <div style={{ ...card, padding: 20, marginTop: 16, display: "grid", gap: 12 }}>
        <h2 style={{ font: "600 14px var(--font-plex-sans)", color: "var(--ik)", margin: 0 }}>
          Your access
        </h2>
        <p style={{ font: "400 13px var(--font-plex-sans)", color: "var(--i2)", margin: 0 }}>
          You are <strong>{me.role}</strong> in <strong>{me.org_name ?? "your workspace"}</strong>.
          Roles are granted by an owner, so they are not editable here.
        </p>
        <p style={{ font: "400 12.5px var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}>
          Theme and accent live in the menu under your avatar, and are remembered per browser rather
          than per account.
        </p>
      </div>
    </>,
  );
}
