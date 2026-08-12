/** Instant fallback for every screen under /admin that has no closer loading
 *  boundary of its own — which, since none of the nested routes define one, is
 *  all of them. Traces the shape of the real console (rail, header, sub-bar,
 *  a two-column body) rather than a spinner, so the transition from this to the
 *  real screen is a fill-in, not a swap.
 *
 *  Static and server-rendered on purpose: the real `Rail` fetches `/auth/me`
 *  and program stats, and this is meant to appear before either has a chance
 *  to resolve.
 */

const RAIL_WIDTH = 256;

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

function RailBones() {
  return (
    <div
      style={{
        width: RAIL_WIDTH,
        flex: "none",
        height: "100%",
        borderRight: "1px solid var(--ln)",
        background: "var(--cd)",
        padding: "16px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 12px",
          height: 40,
          marginBottom: 12,
        }}
      >
        <Bone width={28} height={28} radius={8} />
        <Bone width={96} height={14} />
      </div>
      {Array.from({ length: 10 }).map((_, index) => (
        <div
          key={index}
          style={{ display: "flex", alignItems: "center", gap: 10, height: 36, padding: "0 12px" }}
        >
          <Bone width={16} height={16} radius={4} />
          <Bone width={index % 3 === 0 ? 120 : 90} height={11} />
        </div>
      ))}
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, height: 44, padding: "0 8px" }}>
        <Bone width={30} height={30} radius={999} />
        <div style={{ display: "grid", gap: 6 }}>
          <Bone width={90} height={11} />
          <Bone width={60} height={9} />
        </div>
      </div>
    </div>
  );
}

function HeaderBones() {
  return (
    <div
      style={{
        height: 64,
        flex: "none",
        borderBottom: "1px solid var(--ln)",
        background: "var(--cd)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 20px",
        boxSizing: "border-box",
      }}
    >
      <Bone width={220} height={16} />
      <div style={{ flex: 1 }} />
      <Bone width={34} height={34} radius={999} />
      <Bone width={34} height={34} radius={999} />
    </div>
  );
}

function SubBarBones() {
  return (
    <div
      style={{
        height: 32,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 20px",
        borderBottom: "1px solid var(--ln)",
        background: "var(--cd)",
        boxSizing: "border-box",
      }}
    >
      {[70, 96, 88, 110, 70].map((width, index) => (
        <Bone key={index} width={width} height={9} />
      ))}
    </div>
  );
}

export default function AdminLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        display: "grid",
        gridTemplateColumns: `${RAIL_WIDTH}px minmax(0,1fr)`,
        height: "100vh",
        overflow: "hidden",
        background: "var(--pp)",
      }}
    >
      <span className="sr-only">Loading the console.</span>
      <div aria-hidden style={{ display: "contents" }}>
        <RailBones />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          <HeaderBones />
          <SubBarBones />
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px 80px" }}>
            <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
              <Bone width={280} height={26} radius={6} />
              <Bone width={340} height={12} />
            </div>
            <Bone height={96} radius={16} style={{ marginBottom: 14 }} />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1.7fr) minmax(270px,1fr)",
                gap: 14,
                alignItems: "start",
              }}
            >
              <div style={{ display: "grid", gap: 12 }}>
                <Bone height={90} radius={14} />
                <Bone height={90} radius={14} />
                <Bone height={70} radius={14} />
                <Bone height={70} radius={14} />
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                <Bone height={210} radius={14} />
                <Bone height={170} radius={14} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
