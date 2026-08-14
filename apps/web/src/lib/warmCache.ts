"use client";

/** Last-known-value snapshots for the queries the console chrome paints from.
 *
 *  The rail badges, the header, and the Overview pulse all read TanStack
 *  queries whose counts default to zero in flight — so every load painted a
 *  bare rail and then popped the numbers in a few hundred milliseconds later.
 *  Wrong-then-right, the same disease as the theme and auth flashes, just fed
 *  by the network instead of hydration.
 *
 *  The cure is the one real dashboards use: paint the last known values
 *  immediately and refetch behind them. Selected queries are mirrored into
 *  sessionStorage on every success, and seeded back into a fresh QueryClient
 *  at creation — synchronously, before anything renders — with `updatedAt: 0`
 *  so they are stale on arrival and refetch at once. A changed number still
 *  updates; an unchanged one never visibly moves at all.
 *
 *  sessionStorage, not localStorage: a snapshot of one tab's session, gone
 *  when the tab closes. It never outlives the identity that wrote it because
 *  every identity change goes through `restartAt`, which calls `clearWarmCache`
 *  first — a new sign-in must never paint the previous account's numbers.
 */

import type { QueryClient } from "@tanstack/react-query";

const PREFIX = "gather.warm.";

/** Queries worth warming: identity (name in the greeting, role in the rail)
 *  and the program stats behind every badge. Key must be JSON of the exact
 *  queryKey the live query uses. */
const WARMED = new Set(['["me"]']);

function isWarmed(key: readonly unknown[]): boolean {
  return WARMED.has(JSON.stringify(key)) || key[0] === "program-stats";
}

export function seedWarmCache(client: QueryClient): void {
  if (typeof window === "undefined") return;
  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const name = sessionStorage.key(i);
      if (name === null || !name.startsWith(PREFIX)) continue;
      const raw = sessionStorage.getItem(name);
      if (raw === null) continue;
      const key = JSON.parse(name.slice(PREFIX.length)) as unknown[];
      client.setQueryData(key, JSON.parse(raw), { updatedAt: 0 });
    }
  } catch {
    // A malformed snapshot costs nothing but the warm start it would have given.
  }
}

export function subscribeWarmCache(client: QueryClient): void {
  if (typeof window === "undefined") return;
  client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    const { queryKey, state } = event.query;
    if (!isWarmed(queryKey) || state.data === undefined) return;
    try {
      sessionStorage.setItem(PREFIX + JSON.stringify(queryKey), JSON.stringify(state.data));
    } catch {
      // Quota or serialization failure — the next load is merely cold again.
    }
  });
}

/** Called by `restartAt` before any identity change leaves the page. */
export function clearWarmCache(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const name = sessionStorage.key(i);
      if (name !== null && name.startsWith(PREFIX)) sessionStorage.removeItem(name);
    }
  } catch {
    // Nothing to clear is the same as cleared.
  }
}
