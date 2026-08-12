/** Instant fallback for the public event pages (`/e/[slug]` and everything
 *  under it that has no closer loading boundary — schedule, agenda, speakers,
 *  itinerary all read through `getPublic` here and none defines its own).
 *  Traces `PublicShell`'s header — centred column, event title, a row of nav
 *  pills — because that is what every one of those pages shares; the body is
 *  a generic set of card bones since the content itself varies by page.
 */

function Bone({
  width = "100%",
  height = 14,
  radius = 6,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      data-event=""
      style={{
        width,
        height,
        borderRadius: radius,
        background: "var(--sk)",
        border: "1px solid var(--e-edge, rgba(255,255,255,.10))",
        flex: "none",
        ...style,
      }}
    />
  );
}

const NAV_PILL_WIDTHS = [58, 74, 68, 78, 96, 108];

export default function PublicEventLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{ minHeight: "100vh", background: "var(--e-page, #07080E)" }}
    >
      <span className="sr-only">Loading the event.</span>
      <div aria-hidden>
        <header style={{ borderBottom: "1px solid var(--e-edge, rgba(255,255,255,.10))", background: "var(--e-raised, #101018)" }}>
          <div data-event="" style={{ maxWidth: 1040, margin: "0 auto", padding: "18px 24px" }}>
            <Bone width={150} height={10} style={{ marginBottom: 10 }} />
            <Bone width={320} height={30} radius={6} style={{ marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {NAV_PILL_WIDTHS.map((width, index) => (
                <Bone key={index} width={width} height={30} radius={999} />
              ))}
            </div>
          </div>
        </header>
        <main data-event="" style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 24px 80px" }}>
          <Bone height={140} radius={14} style={{ marginBottom: 16 }} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 14,
            }}
          >
            <Bone height={120} radius={14} />
            <Bone height={120} radius={14} />
            <Bone height={120} radius={14} />
          </div>
        </main>
      </div>
    </div>
  );
}
