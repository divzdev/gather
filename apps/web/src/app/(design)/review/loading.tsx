/** Instant fallback for /review. Same rail-and-header shell as the admin
 *  console — reviewers get the same chrome — with the body traced as the
 *  queue's own split: a scoring panel on the left, a fixed-width rubric rail
 *  on the right, matching `Review.tsx`'s `minmax(0,1fr) 340px`.
 *
 *  Static and server-rendered: the real `Rail` and the queue both fetch on
 *  mount, and this is meant to appear before either has a chance to resolve.
 */

const RAIL_WIDTH = 256;
const RUBRIC_WIDTH = 340;

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
      <Bone width={180} height={16} />
      <div style={{ flex: 1 }} />
      <Bone width={34} height={34} radius={999} />
    </div>
  );
}

export default function ReviewLoading() {
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
      <span className="sr-only">Loading the review queue.</span>
      <div aria-hidden style={{ display: "contents" }}>
        <RailBones />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          <HeaderBones />
          <div
            style={{
              flex: 1,
              overflow: "hidden",
              padding: 20,
              display: "grid",
              gridTemplateColumns: `minmax(0,1fr) ${RUBRIC_WIDTH}px`,
              gap: 16,
              alignItems: "start",
            }}
          >
            <div style={{ display: "grid", gap: 12 }}>
              <Bone width={320} height={22} radius={6} />
              <Bone width={220} height={11} />
              <Bone height={140} radius={14} style={{ marginTop: 8 }} />
              <Bone height={200} radius={14} />
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <Bone height={90} radius={14} />
              <Bone height={90} radius={14} />
              <Bone height={90} radius={14} />
              <Bone height={54} radius={14} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
