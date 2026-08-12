import Link from "next/link";

/** The whole app's fallback for a URL that matches nothing — a typo, an old
 *  bookmark, a route that moved. Every route segment with its own
 *  `not-found.tsx` (currently `/e/[slug]`) handles its own case in its own
 *  voice; this is what is left once nothing more specific claimed the path.
 */
export default function RootNotFound() {
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
        style={{
          maxWidth: 480,
          width: "100%",
          border: "1px solid var(--ln)",
          background: "var(--cd)",
          borderRadius: "var(--radius-card)",
          padding: 32,
          boxSizing: "border-box",
          textAlign: "center",
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
          404
        </p>
        <h1
          style={{
            font: "700 26px/1.2 var(--font-bricolage), sans-serif",
            letterSpacing: "-0.02em",
            color: "var(--ik)",
            margin: "0 0 10px",
          }}
        >
          This page does not exist.
        </h1>
        <p
          style={{
            font: "400 14.5px/1.65 var(--font-plex-sans)",
            color: "var(--i2)",
            margin: "0 0 24px",
          }}
        >
          Check the address, or start again from the homepage.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link
            href="/"
            style={{
              height: 44,
              padding: "0 22px",
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--bt)",
              color: "var(--bf)",
              font: "600 14px var(--font-plex-sans)",
              textDecoration: "none",
            }}
          >
            Go to the homepage
          </Link>
          <Link
            href="/login"
            style={{
              height: 44,
              padding: "0 22px",
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--i3)",
              font: "500 14px var(--font-plex-sans)",
              textDecoration: "none",
            }}
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
