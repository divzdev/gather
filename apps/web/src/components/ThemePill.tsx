"use client";

import { ACCENT_NAMES, ACCENTS } from "@/lib/theme";
import { useTheme } from "@/components/ThemeProvider";

/** Top-chrome control: five accent dots, a divider, then the tri-state
 *  system/light/dark toggle. Same shape as the prototypes. */
export function ThemePill() {
  const { accent, mode, setAccent, setMode } = useTheme();

  const cycle = () => setMode(mode === "system" ? "light" : mode === "light" ? "dark" : "system");
  const glyph = mode === "system" ? "◐" : mode === "light" ? "○" : "●";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 32,
        padding: "0 10px",
        borderRadius: 999,
        background: "var(--sk, #EDF1F2)",
        border: "1px solid var(--ln, #E1E7E9)",
      }}
    >
      <span
        style={{
          font: "600 9.5px 'IBM Plex Sans Condensed', sans-serif",
          letterSpacing: "0.1em",
          color: "var(--i4, #99A6AD)",
        }}
      >
        THEME
      </span>
      <span style={{ display: "flex", gap: 5 }}>
        {ACCENT_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setAccent(name)}
            title={name}
            aria-label={`${name} accent`}
            aria-pressed={accent === name}
            style={{
              width: 13,
              height: 13,
              borderRadius: "50%",
              background: ACCENTS[name].dot,
              border: "none",
              padding: 0,
              outline: accent === name ? "2px solid var(--ik, #16232B)" : "none",
              outlineOffset: 1,
            }}
          />
        ))}
      </span>
      <span style={{ width: 1, height: 16, background: "var(--ln, #E1E7E9)" }} />
      <button
        type="button"
        onClick={cycle}
        title={`Theme: ${mode}`}
        aria-label={`Theme: ${mode}. Click to change.`}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          font: "400 13px 'IBM Plex Sans', sans-serif",
          color: "var(--i2, #3E4E58)",
          lineHeight: 1,
        }}
      >
        {glyph}
      </button>
    </div>
  );
}
