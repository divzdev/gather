"use client";

/**
 * Functional sign-in. Deliberately plain: the designed screen is coming, so this
 * uses the locked tokens and nothing invented, and is built to be replaced.
 *
 * Staff sign in with a password. Speakers can too, or request a magic link.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";

type Mode = "password" | "magic-link";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "magic-link") {
        await apiFetch("/auth/magic-link", { method: "POST", body: { email } });
        setSent(true);
      } else {
        await apiFetch<{ access_token: string }>("/auth/login", {
          method: "POST",
          body: { email, password },
        });
        router.push("/admin");
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not sign in. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const field: React.CSSProperties = {
    height: 36,
    width: "100%",
    padding: "0 10px",
    borderRadius: 6,
    border: "1px solid var(--ls, #C8D2D5)",
    background: "var(--cd, #FFFFFF)",
    color: "var(--ik, #16232B)",
    font: "400 13px var(--font-plex-sans), sans-serif",
  };
  const label: React.CSSProperties = {
    display: "block",
    marginBottom: 6,
    font: "500 12px var(--font-plex-sans), sans-serif",
    color: "var(--i2, #3E4E58)",
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "var(--pp, #F4F6F7)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <h1
          style={{
            font: "600 32px var(--font-bricolage), sans-serif",
            color: "var(--ik, #16232B)",
            margin: "0 0 4px",
          }}
        >
          Gather
        </h1>
        <p style={{ font: "400 13px var(--font-plex-sans)", color: "var(--i3, #6B7B84)", margin: "0 0 20px" }}>
          Sign in to your event.
        </p>

        <form
          onSubmit={onSubmit}
          style={{
            background: "var(--cd, #FFFFFF)",
            border: "1px solid var(--ln, #E1E7E9)",
            borderRadius: 14,
            padding: 20,
          }}
        >
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="email" style={label}>
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={field}
            />
          </div>

          {mode === "password" && (
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="password" style={label}>
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={field}
              />
            </div>
          )}

          {error !== null && (
            <p
              role="alert"
              style={{
                margin: "0 0 12px",
                padding: "8px 10px",
                borderRadius: 6,
                background: "var(--cnw, #FBE8E6)",
                border: "1px solid var(--cnl, #F3C7C2)",
                color: "var(--cn, #D8432B)",
                font: "400 12.5px var(--font-plex-sans)",
              }}
            >
              {error}
            </p>
          )}

          {sent ? (
            <p
              style={{
                margin: 0,
                padding: "8px 10px",
                borderRadius: 6,
                background: "var(--okw, #E2F1EC)",
                border: "1px solid var(--okl, #C2E0D5)",
                color: "var(--ok, #0E7A5F)",
                font: "400 12.5px var(--font-plex-sans)",
              }}
            >
              If that address is registered, a sign-in link is on its way.
            </p>
          ) : (
            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%",
                height: 36,
                borderRadius: 999,
                border: "none",
                background: "var(--bt, #FF6B6B)",
                color: "var(--bf, #331313)",
                font: "600 13px var(--font-plex-sans), sans-serif",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? "Working…" : mode === "password" ? "Sign in" : "Email me a link"}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setMode(mode === "password" ? "magic-link" : "password");
              setError(null);
              setSent(false);
            }}
            style={{
              width: "100%",
              marginTop: 12,
              background: "none",
              border: "none",
              color: "var(--sg, #E04E4E)",
              font: "400 12.5px var(--font-plex-sans), sans-serif",
            }}
          >
            {mode === "password" ? "Sign in with an email link instead" : "Use a password instead"}
          </button>
        </form>
      </div>
    </main>
  );
}
