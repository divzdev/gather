"use client";

/** Catches anything thrown rendering /portal. A speaker gets here from a
 *  magic link, not a password, so "sign in again" is not a fix this screen
 *  can offer — the copy sticks to what actually helps: retry, and completed
 *  work is not lost.
 *
 *  The raw error never reaches the screen — speaker-facing, no staff auth in
 *  front of it.
 */

import { useEffect } from "react";

export default function PortalError({
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
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--pp)",
        padding: 20,
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
          padding: 28,
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
          Your portal
        </p>
        <h1
          style={{
            font: "700 22px/1.25 var(--font-bricolage), sans-serif",
            letterSpacing: "-0.02em",
            color: "var(--ik)",
            margin: "0 0 10px",
          }}
        >
          This page did not load.
        </h1>
        <p style={{ font: "400 14.5px/1.65 var(--font-plex-sans)", color: "var(--i2)", margin: 0 }}>
          The server did not answer. Anything you had already completed is saved — try again in a
          moment.
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
            marginTop: 24,
            width: "100%",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
