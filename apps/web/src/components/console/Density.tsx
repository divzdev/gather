"use client";

/** The saved list density, made real.
 *
 *  `density_pref` was written by /admin/profile, stored on `User`, returned by
 *  the API — and read by **nothing**. The operator picked Comfortable, the
 *  screen confirmed it, and every table ignored it. A control that persists a
 *  value nobody reads is worse than a missing one: the choice is made, the app
 *  agrees, and nothing changes, so the reasonable conclusion is that the app is
 *  broken or that you misread your own screen.
 *
 *  One writer, many readers: this sets `--row-h` on the document element and the
 *  console's tables size their rows from it. No prop threading, no store, and a
 *  table opts in by reading a variable rather than by being wired to anything.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { authed, getToken } from "@/lib/session";

export const ROW_H = { comfortable: "44px", compact: "36px" } as const;

export type Density = keyof typeof ROW_H;

export function densityOf(value: string | null | undefined): Density {
  return value === "comfortable" ? "comfortable" : "compact";
}

/** Paint it now, before React has fetched anything — the alternative is every
 *  table rendering at the default height and jumping one frame later. */
export function applyDensity(value: Density): void {
  document.documentElement.style.setProperty("--row-h", ROW_H[value]);
}

export function DensityBridge() {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => authed<{ density_pref: string }>("/auth/me"),
    staleTime: 5 * 60_000,
    enabled: typeof window !== "undefined" && getToken() !== null,
  });

  useEffect(() => {
    if (me === undefined) return;
    applyDensity(densityOf(me.density_pref));
  }, [me]);

  return null;
}
