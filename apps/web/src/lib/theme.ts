/**
 * Accent and light/dark theming.
 *
 * Values and behaviour are taken from the GatherDesign prototypes so a ported
 * screen behaves identically: same five accents, same tri-state theme, same
 * localStorage keys (`gather.accent`, `gather.theme`).
 */

export type ThemeMode = "system" | "light" | "dark";
export type AccentName = "Coral" | "Jade" | "Sky" | "Slate" | "Graphite";

/** `sg` is the accent as **text** and `bt` the accent as a **fill**, which is
 *  why they differ. Text carries the AA burden: measured on screen, Coral's
 *  #E04E4E was 3.38:1 on its own tint and Sky's #2B77B3 was 4.18:1, so both are
 *  darker here while the buttons stay exactly as vivid as they were. Jade,
 *  Slate and Graphite already passed and are untouched. */
type AccentVars = { sg: string; sw: string; sl: string; bt: string; bf: string };

export const ACCENTS: Record<AccentName, { dot: string; l: AccentVars; d: AccentVars }> = {
  Coral: {
    dot: "#FF6B6B",
    l: { sg: "#D02525", sw: "#FFEAE6", sl: "#FFC9C0", bt: "#FF6B6B", bf: "#331313" },
    d: { sg: "#FF8E8E", sw: "#3A1D1D", sl: "#66302E", bt: "#FF6B6B", bf: "#331313" },
  },
  /* Replaced Sunset (10 Aug). #00C59E is Ordel's accent exactly, given as
     lab(69.7163% -60.7207 5.19905). Not the dull teals this palette rejected
     (#2E6E7A, #47818C): at OKLCH chroma 0.143 it is half again as saturated.
     It does share a hue with the "clear/done" status (172 vs 170), so the two
     are told apart by weight, not hue — the status greens sit at chroma 0.10
     and only ever appear as small chips, while the accent is reserved for
     buttons and links. */
  Jade: {
    dot: "#00C59E",
    l: { sg: "#00775B", sw: "#DFF9EF", sl: "#A1E5CE", bt: "#00C59E", bf: "#002118" },
    d: { sg: "#48DAB3", sw: "#063126", sl: "#0B5E4A", bt: "#00C59E", bf: "#002118" },
  },
  Sky: {
    dot: "#4A9BD8",
    l: { sg: "#2971A9", sw: "#E7F1FA", sl: "#BFDCF1", bt: "#4A9BD8", bf: "#0D2333" },
    d: { sg: "#7FBCE8", sw: "#152A3A", sl: "#2C4E66", bt: "#4A9BD8", bf: "#0D2333" },
  },
  Slate: {
    dot: "#5A6BA8",
    l: { sg: "#4A5A99", sw: "#EAEDF7", sl: "#C8CFE9", bt: "#5A6BA8", bf: "#FFFFFF" },
    d: { sg: "#98A6DA", sw: "#1F2542", sl: "#3A4370", bt: "#8B9AD0", bf: "#12162E" },
  },
  Graphite: {
    dot: "#5F6B79",
    l: { sg: "#46535F", sw: "#ECEFF2", sl: "#C9D2DA", bt: "#4A5764", bf: "#FFFFFF" },
    d: { sg: "#A9B6C2", sw: "#232B33", sl: "#3E4A56", bt: "#93A3B1", bf: "#111921" },
  },
};

export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[];

export const STORAGE_KEYS = { accent: "gather.accent", theme: "gather.theme" } as const;

export function isDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Toggle the theme attribute. Since spec 0002 the palette is fixed in
 *  tokens.css — chrome is the ink pill, colour is element-level state — so
 *  nothing writes colour variables at runtime any more. The accent argument
 *  survives only so stored preferences keep parsing; it changes nothing. */
export function applyTheme(mode: ThemeMode, _accent?: AccentName): void {
  void _accent;
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = isDark(mode) ? "dark" : "light";
}

export function readStoredTheme(): { mode: ThemeMode; accent: AccentName } {
  if (typeof window === "undefined") return { mode: "system", accent: "Coral" };
  const mode = window.localStorage.getItem(STORAGE_KEYS.theme) as ThemeMode | null;
  const accent = window.localStorage.getItem(STORAGE_KEYS.accent) as AccentName | null;
  return {
    mode: mode === "light" || mode === "dark" || mode === "system" ? mode : "system",
    accent: accent && accent in ACCENTS ? accent : "Coral",
  };
}
