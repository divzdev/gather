"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

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

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [accent, setAccentState] = useState<AccentName>("Coral");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = readStoredTheme();
    setModeState(stored.mode);
    setAccentState(stored.accent);
    applyTheme(stored.mode, stored.accent);
    setDark(isDark(stored.mode));
  }, []);

  // Following the system means following it as it changes, not only at load.
  useEffect(() => {
    if (mode !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyTheme("system", accent);
      setDark(query.matches);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode, accent]);

  const setMode = useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      window.localStorage.setItem(STORAGE_KEYS.theme, next);
      applyTheme(next, accent);
      setDark(isDark(next));
    },
    [accent],
  );

  const setAccent = useCallback(
    (next: AccentName) => {
      setAccentState(next);
      window.localStorage.setItem(STORAGE_KEYS.accent, next);
      applyTheme(mode, next);
    },
    [mode],
  );

  return (
    <ThemeContext.Provider value={{ mode, accent, dark, setMode, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
