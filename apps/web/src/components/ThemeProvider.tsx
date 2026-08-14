"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

import { applyTheme, isDark, readStoredTheme, STORAGE_KEYS, type ThemeMode } from "@/lib/theme";

type ThemeContextValue = {
  mode: ThemeMode;
  dark: boolean;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Applied before paint so a dark-mode reload never flashes light. Only the
 *  theme attribute: the palette is fixed in tokens.css (spec 0002), so the
 *  boot script no longer writes colour variables. */
export const themeBootScript = `(()=>{try{
  var m=localStorage.getItem("${STORAGE_KEYS.theme}")||"system";
  var d=m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme=d?"dark":"light";
}catch(e){}})()`;

/* Theme lives in localStorage and the OS, not in React. useSyncExternalStore is
 * the sanctioned way to read that: no state set from an effect, and no flash,
 * because the boot script has already painted the right colours. The snapshot is
 * a string so repeated calls are referentially stable. */

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    query.removeEventListener("change", listener);
    window.removeEventListener("storage", listener);
  };
}

function getSnapshot(): string {
  const { mode } = readStoredTheme();
  return `${mode}|${isDark(mode) ? "d" : "l"}`;
}

function getServerSnapshot(): string {
  return "system|l";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [mode, shade] = snapshot.split("|") as [ThemeMode, string];

  const setMode = useCallback((next: ThemeMode) => {
    window.localStorage.setItem(STORAGE_KEYS.theme, next);
    applyTheme(next);
    emit();
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, dark: shade === "d", setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
