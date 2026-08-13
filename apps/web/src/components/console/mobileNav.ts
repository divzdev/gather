"use client";

/** Whether the rail is open as a drawer, on a screen too narrow to hold it.
 *
 *  Two components need this and they are not related by ancestry: the rail,
 *  which slides, and the header, whose button slides it. A module-level store
 *  read through `useSyncExternalStore` is the smallest thing that works, and it
 *  matches how the rail already reads its collapsed flag — no provider, no
 *  context, no prop drilled through thirteen generated screens.
 *
 *  Deliberately not persisted. A collapsed rail is a preference; an open drawer
 *  is a moment, and restoring one on the next page load would be a surprise.
 */

const listeners = new Set<() => void>();
let open = false;

export function setMobileNav(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

export function toggleMobileNav(): void {
  setMobileNav(!open);
}

export function subscribeMobileNav(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readMobileNav(): boolean {
  return open;
}

/** The server has no viewport, so it always renders closed. */
export function serverMobileNav(): boolean {
  return false;
}
