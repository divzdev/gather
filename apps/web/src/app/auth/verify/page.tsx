"use client";

/** Where a magic link lands. The token is single-use and burns on arrival, so
 *  this page consumes it exactly once and then gets out of the way.
 *
 *  Both kinds of link arrive here — a speaker opening their portal and a member
 *  of staff who has lost their password or is confirming a new account. The two
 *  tokens are stored separately and open different apps, and only the server
 *  knows which one it just issued, so `kind` decides where this goes. Guessing
 *  would put a staff token in the portal's slot, where every request is refused. */

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api";
import { setEventId, setSpeakerToken, setToken } from "@/lib/session";

function Verify() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const consumed = useRef(false);
  const [failed, setFailed] = useState(false);
  const problem =
    token === null
      ? "That link is missing its token. Ask for a new one."
      : failed
        ? "This link has expired or was already used. Ask for a new one."
        : null;

  useEffect(() => {
    if (token === null) return;
    // React runs effects twice in development; a single-use token would be
    // spent by the first pass and rejected by the second.
    if (consumed.current) return;
    consumed.current = true;

    void (async () => {
      try {
        const issued = await apiFetch<{ access_token: string; kind: "staff" | "speaker" }>(
          "/auth/magic-link/consume",
          { method: "POST", body: { token } },
        );
        if (issued.kind === "speaker") {
          setSpeakerToken(issued.access_token);
          router.replace("/portal");
          return;
        }
        setToken(issued.access_token);
        // The console needs an event in scope before it can render anything.
        // A staff link carries none, so the first one they belong to is chosen
        // here rather than dropping them on a screen with no event selected.
        //
        // Deliberately outside the catch above. The token is single-use and has
        // already burned by this point, so letting a failed event lookup fall
        // into "this link has expired" told a signed-in person to go and get a
        // link they no longer need — and the one they had is unusable. The
        // console handles having no event; it cannot handle being sent away.
        try {
          const events = await apiFetch<{ id: string }[]>("/events", {
            headers: { Authorization: `Bearer ${issued.access_token}` },
          });
          const first = events[0];
          if (first !== undefined) setEventId(first.id);
        } catch {
          // Nothing to do: RequireStaff asks for the list again and routes on it.
        }
        router.replace("/admin");
      } catch {
        setFailed(true);
      }
    })();
  }, [token, router]);

  return (
    <main
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100vh",
        padding: 24,
        background: "var(--pp,#F4F6F7)",
        font: "400 14px 'IBM Plex Sans',sans-serif",
        color: "var(--i2,#3E4E58)",
      }}
    >
      {/* The first screen after an acceptance email, and it was a bare sentence
          on a bare background — the one moment a speaker has no idea whether the
          link worked. It is a card now, and the failure names which of the two
          things went wrong rather than blaming the link either way. */}
      <div
        style={{
          width: 380,
          maxWidth: "100%",
          display: "grid",
          gap: 14,
          justifyItems: "center",
          textAlign: "center",
          padding: 28,
          borderRadius: 16,
          border: "1px solid var(--ln,#E1E7E9)",
          background: "var(--cd,#FFFFFF)",
        }}
      >
        <span aria-hidden style={{ font: "600 22px 'IBM Plex Sans',sans-serif" }}>
          <svg width="30" height="30" viewBox="0 0 24 24" role="img" aria-label="Gather">
            <rect width="24" height="24" rx="6.5" fill="var(--ik,#16232B)" />
            <circle cx="14.7" cy="14.7" r="5.7" fill="var(--bt,#FF6B6B)" />
            <circle cx="6.3" cy="6.3" r="2.3" fill="var(--cd,#FFFFFF)" />
          </svg>
        </span>
        {problem === null ? (
          <>
            <span
              style={{ font: "500 15px 'IBM Plex Sans',sans-serif", color: "var(--ik,#16232B)" }}
            >
              Signing you in…
            </span>
            <span style={{ font: "400 12.5px/1.6 'IBM Plex Sans',sans-serif" }}>
              One moment — this link works once, and it is being spent now.
            </span>
          </>
        ) : (
          <>
            <span
              role="alert"
              style={{
                font: "500 15px/1.5 'IBM Plex Sans',sans-serif",
                color: "var(--cn,#D8432B)",
              }}
            >
              {problem}
            </span>
            <span style={{ font: "400 12.5px/1.6 'IBM Plex Sans',sans-serif" }}>
              Links last 30 minutes and open once. Asking for another is free — nothing about your
              proposal or your account has changed.
            </span>
            <a
              href="/login"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: "var(--control-h-md, 44px)",
                padding: "0 22px",
                borderRadius: 999,
                background: "var(--bt,#FF6B6B)",
                color: "var(--bf,#331313)",
                font: "600 13px 'IBM Plex Sans',sans-serif",
                textDecoration: "none",
              }}
            >
              Request a new link
            </a>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <Verify />
    </Suspense>
  );
}
