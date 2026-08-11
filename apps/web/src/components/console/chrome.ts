"use client";

/** The bits of chrome every console screen carries: the account menu, the theme
 *  and accent controls, and the toast stack. The prototypes repeat this block on
 *  each screen; here it is written once and spread into each screen's data.
 */

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { useTheme } from "@/components/ThemeProvider";
import { ACCENT_NAMES, ACCENTS } from "@/lib/theme";
import { authed, clearToken } from "@/lib/session";

const TOAST_MS = 6000;
/** The prototype keeps the last three; more than that stacks off the screen. */
type Me = { name: string; role: string; org_name: string | null };

const TOAST_LIMIT = 3;

export type Toast = { id: string; msg: string; revert?: () => void };

export type ConsoleChrome = {
  readonly popUser: boolean;
  readonly togUser: () => void;
  readonly closeUser: () => void;
  readonly profileGo: () => void;
  readonly signOut: () => void;
  readonly themeWord: string;
  readonly themeGlyph: string;
  readonly themeTitle: string;
  readonly togTheme: () => void;
  //: Who is actually signed in. The prototypes carry "Sasha Whitfield ·
  //: program lead · demo org" as literal markup on fifteen screens, so until
  //: these are bound every organiser sees a stranger's name in their own
  //: console.
  readonly youName: string;
  readonly youRole: string;
  readonly youOrg: string;
  readonly youInitials: string;
  readonly accents: readonly {
    readonly n: string;
    readonly c: string;
    readonly on: () => void;
    readonly ring: string;
  }[];
};

export function useConsoleChrome(): {
  chrome: ConsoleChrome;
  toasts: Toast[];
  toast: (msg: string, revert?: () => void) => void;
  dismiss: (id: string) => void;
} {
  const router = useRouter();
  const theme = useTheme();
  const [userMenu, setUserMenu] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const toast = useCallback(
    (msg: string, revert?: () => void) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current.slice(-(TOAST_LIMIT - 1)), { id, msg, revert }]);
      window.setTimeout(() => dismiss(id), TOAST_MS);
    },
    [dismiss],
  );

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => authed<Me>("/auth/me"),
    staleTime: 5 * 60_000,
  });

  const chrome: ConsoleChrome = {
    youName: me?.name ?? "",
    youRole: (me?.role ?? "").replace(/_/g, " "),
    youOrg: me?.org_name ?? "",
    youInitials: (me?.name ?? "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase(),
    popUser: userMenu,
    togUser: () => setUserMenu((open) => !open),
    closeUser: () => setUserMenu(false),
    profileGo: () => {
      setUserMenu(false);
      router.push("/admin/settings");
    },
    signOut: () => {
      setUserMenu(false);
      clearToken();
      router.push("/login");
    },
    themeWord: theme.mode.replace(/^./, (c) => c.toUpperCase()),
    themeGlyph: theme.mode === "system" ? "◐" : theme.mode === "light" ? "○" : "●",
    themeTitle: `Theme: ${theme.mode}, click to change`,
    togTheme: () =>
      theme.setMode(theme.mode === "system" ? "light" : theme.mode === "light" ? "dark" : "system"),
    accents: ACCENT_NAMES.map((name) => ({
      n: name,
      c: ACCENTS[name].dot,
      on: () => theme.setAccent(name),
      ring:
        theme.accent === name
          ? `0 0 0 2px var(--cd,#FFFFFF), 0 0 0 4px ${ACCENTS[name].dot}`
          : "inset 0 0 0 1px rgba(0,0,0,.12)",
    })),
  };

  return { chrome, toasts, toast, dismiss };
}
