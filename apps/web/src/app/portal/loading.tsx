/** Instant fallback for /portal. Traces the speaker header — logo, event
 *  name and dates, a pill tab bar — from `components/design/Portal.tsx`,
 *  which the real screen fetches in one round trip (`portal()` in
 *  `lib/session.ts`) before it has anything to show. Mobile-first: this is
 *  read on a phone between other things, same as the real thing.
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
      style={{
        width,
        height,
        borderRadius: radius,
        background: "var(--sk)",
        border: "1px solid var(--ln)",
        flex: "none",
        ...style,
      }}
    />
  );
}

export default function PortalLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{ minHeight: "100vh", background: "var(--pp)" }}
    >
      <span className="sr-only">Loading your portal.</span>
      <div aria-hidden>
        <div style={{ borderBottom: "1px solid var(--ln)", background: "var(--cd)" }}>
          <div
            style={{
              maxWidth: 1120,
              margin: "0 auto",
              padding: "10px 16px",
              minHeight: 62,
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              boxSizing: "border-box",
            }}
          >
            <Bone width={26} height={26} radius={7} />
            <div style={{ display: "grid", gap: 6 }}>
              <Bone width={140} height={12} />
              <Bone width={90} height={9} />
            </div>
            <div style={{ flex: 1 }} />
            <Bone width={200} height={36} radius={999} />
          </div>
        </div>
        <main style={{ maxWidth: 1120, margin: "0 auto", padding: "20px 16px 80px" }}>
          <Bone height={130} radius={16} style={{ marginBottom: 16 }} />
          <div style={{ display: "grid", gap: 12 }}>
            <Bone height={72} radius={14} />
            <Bone height={72} radius={14} />
            <Bone height={72} radius={14} />
          </div>
        </main>
      </div>
    </div>
  );
}
