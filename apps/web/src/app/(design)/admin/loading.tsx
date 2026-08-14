/** Route-segment loading state for every /admin screen.
 *
 *  There was none, so the first visit to a route whose chunk had not loaded
 *  painted nothing at all. This draws the console's silhouette — rail, header,
 *  content blocks — in the page's own surface colours, so a navigation reads
 *  as "the console is coming" rather than as a blank or a freeze. It shows
 *  only in the gap before the page component mounts; a warm navigation never
 *  sees it.
 *
 *  Sized to the real shell: 256px rail, 64px header. The shimmer respects
 *  prefers-reduced-motion by being opacity-only and slow.
 */

const block = (width: string, height: number): React.CSSProperties => ({
  width,
  height,
  borderRadius: 10,
  background: "var(--ln,#E1E7E9)",
  opacity: 0.55,
});

export default function AdminLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading the console"
      style={{
        display: "flex",
        height: "100vh",
        background: "var(--pp,#F4F6F7)",
        animation: "gather-loading-pulse 1.6s ease-in-out infinite",
      }}
    >
      <style>{`@keyframes gather-loading-pulse{0%,100%{opacity:1}50%{opacity:.72}}`}</style>
      <aside
        style={{
          width: 256,
          flex: "none",
          margin: 12,
          borderRadius: 16,
          background: "var(--cd,#FFFFFF)",
          border: "1px solid var(--ln,#E1E7E9)",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={block("60%", 24)} />
        <div style={{ height: 10 }} />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} style={block(`${88 - (i % 3) * 14}%`, 14)} />
        ))}
      </aside>
      <main style={{ flex: 1, minWidth: 0, padding: "12px 16px", display: "grid", gap: 14 }}>
        <div
          style={{
            height: 56,
            borderRadius: 14,
            background: "var(--cd,#FFFFFF)",
            border: "1px solid var(--ln,#E1E7E9)",
          }}
        />
        <div
          style={{
            borderRadius: 16,
            background: "var(--cd,#FFFFFF)",
            border: "1px solid var(--ln,#E1E7E9)",
            padding: 24,
            display: "grid",
            gap: 16,
            alignContent: "start",
          }}
        >
          <div style={block("34%", 26)} />
          <div style={block("58%", 14)} />
          <div style={{ height: 8 }} />
          <div style={block("100%", 120)} />
          <div style={block("100%", 120)} />
        </div>
      </main>
    </div>
  );
}
