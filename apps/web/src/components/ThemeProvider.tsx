"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

import {
  ACCENTS,
  type AccentName,
  applyTheme,
  isDark,
  readStoredTheme,
  STORAGE_KEYS,
  type ThemeMode,
} from "@/lib/theme";

type ThemeContextValue = {
  mode: ThemeMode;
  accent: AccentName;
  dark: boolean;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: AccentName) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Applied before paint so a dark-mode reload never flashes light. Mirrors the
 *  prototypes' behaviour and reads the same localStorage keys. */
export const themeBootScript = `(()=>{try{
  var m=localStorage.getItem("${STORAGE_KEYS.theme}")||"system";
  var a=localStorage.getItem("${STORAGE_KEYS.accent}")||"Coral";
  var A=${JSON.stringify(ACCENTS)};
  var d=m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);
  var r=document.documentElement;r.dataset.theme=d?"dark":"light";
  var v=(A[a]||A.Coral)[d?"d":"l"];
  for(var k in v)r.style.setProperty("--"+k,v[k]);
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
  const { mode, accent } = readStoredTheme();
  return `${mode}|${accent}|${isDark(mode) ? "d" : "l"}`;
}

function getServerSnapshot(): string {
  return "system|Coral|l";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [mode, accent, shade] = snapshot.split("|") as [ThemeMode, AccentName, string];

  const setMode = useCallback((next: ThemeMode) => {
    window.localStorage.setItem(STORAGE_KEYS.theme, next);
    applyTheme(next, readStoredTheme().accent);
    emit();
  }, []);

  const setAccent = useCallback((next: AccentName) => {
    window.localStorage.setItem(STORAGE_KEYS.accent, next);
    applyTheme(readStoredTheme().mode, next);
    emit();
  }, []);

  return (
    <ThemeContext.Provider
      value={{ mode, accent, dark: shade === "d", setMode, setAccent }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
