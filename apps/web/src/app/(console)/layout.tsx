import { ConsoleRail } from "@/components/ConsoleRail";
import { ThemePill } from "@/components/ThemePill";

/**
 * Console shell. Grid is `auto minmax(0,1fr)` so the rail's own width drives the
 * layout and collapsing it reflows the work area, as in the prototypes.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0,1fr)",
        height: "100vh",
        overflow: "hidden",
        background: "var(--pp, #F4F6F7)",
        color: "var(--ik, #16232B)",
      }}
    >
      <ConsoleRail />
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <header
          style={{
            height: 48,
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 16px",
            borderBottom: "1px solid var(--ln, #E1E7E9)",
            background: "var(--cd, #FFFFFF)",
          }}
        >
          <div style={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 0 }}>
            <button
              type="button"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                height: 32,
                padding: "0 14px",
                borderRadius: 999,
                background: "var(--sk, #EDF1F2)",
                border: "1px solid var(--ln, #E1E7E9)",
                font: "400 12.5px var(--font-plex-sans), sans-serif",
                color: "var(--i3, #6B7B84)",
                width: "min(420px, 100%)",
                textAlign: "left",
              }}
            >
              <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                Search or jump to…
              </span>
              <span
                className="tabular"
                style={{
                  font: "500 10px var(--font-plex-mono), monospace",
                  border: "1px solid var(--ls, #C8D2D5)",
                  borderRadius: 4,
                  padding: "1px 5px",
                  flex: "none",
                }}
              >
                ⌘K
              </span>
            </button>
          </div>
          <ThemePill />
        </header>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}
