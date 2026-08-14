/**
 * Light/dark theming.
 *
 * Colour lives entirely in tokens.css since spec 0002 — the console chrome is
 * the ink pill and colour is element-level state, so the old five-accent
 * runtime picker is gone. The only thing that varies at runtime is the theme
 * attribute, stored under the same localStorage key the prototypes used
 * (`gather.theme`); a stale `gather.accent` key in old sessions is ignored.
 */

export type ThemeMode = "system" | "light" | "dark";

export const STORAGE_KEYS = { theme: "gather.theme" } as const;

export function isDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Toggle the theme attribute on the root element. */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = isDark(mode) ? "dark" : "light";
}

export function readStoredTheme(): { mode: ThemeMode } {
  if (typeof window === "undefined") return { mode: "system" };
  const mode = window.localStorage.getItem(STORAGE_KEYS.theme) as ThemeMode | null;
  return {
    mode: mode === "light" || mode === "dark" || mode === "system" ? mode : "system",
  };
}
