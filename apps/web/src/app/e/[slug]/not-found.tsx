import Link from "next/link";

/** Fires when `getPublic` (in `./public.tsx`) calls `notFound()` — an unknown
 *  slug, or an event the API will not serve publicly yet. Covers `/e/[slug]`
 *  itself and everything under it that reads through the same helper
 *  (schedule, agenda, speakers, itinerary), none of which defines its own.
 *
 *  `not-found.js` takes no props, so this cannot name the slug that missed —
 *  only that the id in the address did not resolve to a public event.
 */
export default function PublicEventNotFound() {
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
          We could not find this event.
        </h1>
        <p
          style={{
            font: "400 14.5px/1.65 var(--font-plex-sans)",
            color: "var(--i2)",
            margin: "0 0 24px",
          }}
        >
          The address might be out of date, or the event might not be public yet. If someone sent
          you this link, it is worth asking them to check it.
        </p>
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
          Back to Gather
        </Link>
      </div>
    </div>
  );
}
