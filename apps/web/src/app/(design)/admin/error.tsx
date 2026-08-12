"use client";

/** Catches anything thrown by a screen under /admin that has no closer error
 *  boundary of its own — every nested route, since none defines one. Renders
 *  standalone: an error here replaces the page component, which is also where
 *  the rail lives (`Overview`, `Submissions` and the rest all mount `<Rail>`
 *  themselves), so there is no chrome left to sit inside.
 *
 *  The raw error never reaches the screen — Next already withholds the real
 *  message for Server Component errors in production, and this does the same
 *  for the Client Component ones on purpose, so a stray thrown value can never
 *  put a stack trace or a request body in front of an organiser.
 */

import Link from "next/link";
import { useEffect } from "react";

export default function AdminError({
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
        padding: 24,
      }}
    >
      <div
        role="alert"
        style={{
          maxWidth: 480,
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
          Console
        </p>
        <h1
          style={{
            font: "700 24px/1.2 var(--font-bricolage), sans-serif",
            letterSpacing: "-0.02em",
            color: "var(--ik)",
            margin: "0 0 10px",
          }}
        >
          This screen did not load.
        </h1>
        <p style={{ font: "400 14.5px/1.65 var(--font-plex-sans)", color: "var(--i2)", margin: 0 }}>
          Something between here and the server did not answer. Nothing on this event changed — a
          retry usually clears it, and if it keeps happening the API is likely down.
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
          <Link
            href="/admin"
            style={{
              height: 44,
              padding: "0 22px",
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              color: "var(--i3)",
              font: "500 14px var(--font-plex-sans)",
              textDecoration: "none",
            }}
          >
            Back to overview
          </Link>
        </div>
      </div>
    </div>
  );
}
