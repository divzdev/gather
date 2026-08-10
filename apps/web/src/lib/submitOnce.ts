"use client";

import { useRef } from "react";

/** A synchronous guard for submit handlers.
 *
 *  `disabled={mutation.isPending}` is not enough on its own: `isPending` only
 *  becomes true after React re-renders, and a fast double-click fires the
 *  handler twice inside the same tick. A ref flips immediately, so the second
 *  click has something true to read.
 *
 *  Used on anything that creates a record. Read-only actions do not need it —
 *  a doubled GET costs nothing.
 */
export function useSubmitOnce(): (run: () => unknown) => void {
  const busy = useRef(false);

  return (run: () => unknown) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = run();
      if (result instanceof Promise) {
        void result.finally(() => {
          busy.current = false;
        });
        return;
      }
    } catch (error) {
      busy.current = false;
      throw error;
    }
    // A mutate() call returns immediately; release on the next macrotask so the
    // second half of a double-click is swallowed and a deliberate second submit
    // a moment later is not.
    setTimeout(() => {
      busy.current = false;
    }, 800);
  };
}
