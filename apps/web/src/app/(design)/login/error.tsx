"use client";

/** Catches anything thrown rendering /login. The sign-in screen is pinned to
 *  light regardless of the visitor's theme (see `styles/tokens.css`,
 *  `[data-screen-label="Auth"]`), so this carries the same attribute rather
 *  than inheriting a dark map on a screen built for a white surface.
 *
 *  The raw error never reaches the screen — this is the one page a signed-out
 *  visitor always reaches, so it is also the one most likely to see a request
 *  that failed before any auth existed to redact it.
 */

import { useEffect } from "react";

export default function LoginError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      data-screen-label="Auth"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--pp)",
        padding: 24,
      }}
    >
      <div
        role="alert"
        style={{
          maxWidth: 420,
          width: "100%",
          border: "1px solid var(--ln)",
          background: "var(--cd)",
          borderRadius: "var(--radius-card)",
          padding: 32,
          boxSizing: "border-box",
        }}
      >
        <p
          style={{
            font: "600 11px var(--font-plex-mono), monospace",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--i4)",
            margin: "0 0 12px",
          }}
        >
          Sign in
        </p>
        <h1
          style={{
            font: "700 24px/1.2 var(--font-bricolage), sans-serif",
            letterSpacing: "-0.02em",
            color: "var(--ik)",
            margin: "0 0 10px",
          }}
        >
          The sign-in page did not load.
        </h1>
        <p style={{ font: "400 14.5px/1.65 var(--font-plex-sans)", color: "var(--i2)", margin: 0 }}>
          The server did not answer. Nothing you typed was sent — try again in a moment.
        </p>
        {error.digest !== undefined && (
          <p
            style={{
              font: "400 12px var(--font-plex-mono), monospace",
              color: "var(--i4)",
              margin: "14px 0 0",
            }}
          >
            Reference {error.digest}
          </p>
        )}
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            marginTop: 24,
          }}
        >
          <button
            onClick={reset}
            style={{
              height: 44,
              padding: "0 22px",
              borderRadius: 999,
              border: "none",
              background: "var(--bt)",
              color: "var(--bf)",
              font: "600 14px var(--font-plex-sans)",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
