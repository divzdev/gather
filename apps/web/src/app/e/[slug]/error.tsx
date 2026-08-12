"use client";

/** Catches anything thrown rendering a public event page — `/e/[slug]` and
 *  every page under it that reads through `getPublic` (schedule, agenda,
 *  speakers, itinerary), none of which defines its own error boundary. A
 *  stranger with a bookmark or a shared link is the audience here, so the
 *  copy names the event page, not the console screen behind it.
 *
 *  The raw error never reaches the screen — this is the one surface with no
 *  authentication in front of it at all.
 */

import Link from "next/link";
import { useEffect } from "react";

export default function PublicEventError({
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
          Event page
        </p>
        <h1
          style={{
            font: "700 24px/1.2 var(--font-bricolage), sans-serif",
            letterSpacing: "-0.02em",
            color: "var(--ik)",
            margin: "0 0 10px",
          }}
        >
          This page did not load.
        </h1>
        <p style={{ font: "400 14.5px/1.65 var(--font-plex-sans)", color: "var(--i2)", margin: 0 }}>
          The server did not answer. It is usually a dropped request rather than anything wrong with
          the event — try again in a moment.
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
            href="/"
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
            Back to Gather
          </Link>
        </div>
      </div>
    </div>
  );
}
