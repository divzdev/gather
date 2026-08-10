"use client";

/** Where a magic link lands. The token is single-use and burns on arrival, so
 *  this page consumes it exactly once and then gets out of the way. */

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api";
import { setSpeakerToken } from "@/lib/session";

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
        const { access_token } = await apiFetch<{ access_token: string }>(
          "/auth/magic-link/consume",
          { method: "POST", body: { token } },
        );
        setSpeakerToken(access_token);
        router.replace("/portal");
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
      {problem === null ? (
        <span>Signing you in…</span>
      ) : (
        <div style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center" }}>
          <span style={{ color: "var(--cn,#D8432B)" }}>{problem}</span>
          <a href="/login" style={{ color: "var(--sg,#E04E4E)" }}>
            Request a new link
          </a>
        </div>
      )}
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
