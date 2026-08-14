"use client";

/** Where GitHub sign-in comes back to.
 *
 *  The API has already finished: it verified the state, exchanged the code, and
 *  set the rotating refresh cookie. Deliberately no token travels in the URL —
 *  a location bar is copied into chat messages, kept in history and written to
 *  every proxy log on the way. So this page holds nothing secret and does the
 *  one thing left: trade the httpOnly cookie for an access token, the same call
 *  the console makes whenever its fifteen minutes are up.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api";
import { restartAt, setEventId, setToken } from "@/lib/session";

function Return() {
  const router = useRouter();
  const requested = useSearchParams().get("next");
  const [failed, setFailed] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    void (async () => {
      try {
        const { access_token } = await apiFetch<{ access_token: string }>("/auth/refresh", {
          method: "POST",
        });
        setToken(access_token);
        const events = await apiFetch<{ id: string }[]>("/events", {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        const first = events[0];
        if (first !== undefined) setEventId(first.id);
        // Same-origin absolute paths only. This value went to GitHub and came
        // back, so it is attacker-controlled and the server checks it too.
        const next =
          requested !== null && requested.startsWith("/") && !requested.startsWith("//")
            ? requested
            : "/admin";
        restartAt(next);
      } catch {
        setFailed(true);
      }
    })();
  }, [requested, router]);

  return (
    <main
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100vh",
        padding: 24,
        background: "var(--pp,#F4F6F7)",
        font: "400 14px var(--font-plex-sans),sans-serif",
        color: "var(--i2,#3E4E58)",
      }}
    >
      {failed ? (
        <div style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center" }}>
          <span style={{ color: "var(--cn,#D8432B)" }}>
            GitHub signed you in, but this browser could not pick the session up.
          </span>
          <a href="/login" style={{ color: "var(--sg,#E04E4E)" }}>
            Try again
          </a>
        </div>
      ) : (
        <span>Signing you in…</span>
      )}
    </main>
  );
}

export default function GithubReturnPage() {
  return (
    <Suspense fallback={null}>
      <Return />
    </Suspense>
  );
}
