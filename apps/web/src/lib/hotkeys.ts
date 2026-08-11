"use client";

/**
 * Window-level keyboard bindings for screens meant to be driven without a mouse.
 *
 * Three screens advertise shortcuts in their headers — the review queue
 * ("1-5 scores · ⌘⏎ saves · j / k navigates"), the speaker roster and the
 * submissions list (both "j / k to move · x selects · Enter opens") — and until
 * now **no keydown listener existed anywhere in the app**. All three were
 * printing a promise nothing kept.
 *
 * What is actually shared between them is small and easy to get wrong: ignore
 * keys typed into a field, ignore the browser's own modifier combinations, and
 * let one binding — the save — through anyway, because that is where the
 * reviewer's hands already are. The key-to-action map itself is per screen and
 * stays there.
 *
 * Tab is never intercepted. Buttons are real buttons, so the browser already
 * walks them; overriding Tab would trap keyboard and screen-reader users to buy
 * nothing.
 */

import { useEffect, useRef } from "react";

export type Hotkey = {
  /** An `event.key` value ("j", "x", "Enter", "1"), optionally prefixed
   *  `mod+` for ⌘ on macOS or Ctrl elsewhere. */
  key: string;
  run: (event: KeyboardEvent) => void;
  /** Fire even while the caret is in an input or textarea. Only a save should:
   *  every other shortcut would eat the character the user meant to type. */
  whileTyping?: boolean;
};

function isTyping(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (node === null) return false;
  return (
    node.tagName === "INPUT" ||
    node.tagName === "TEXTAREA" ||
    node.tagName === "SELECT" ||
    node.isContentEditable
  );
}

export function useHotkeys(keys: readonly Hotkey[], enabled = true): void {
  // The map is rebuilt every render because its closures read current state;
  // re-binding the listener each time would mean a new listener per keystroke,
  // so a ref holds the latest and the listener is attached once.
  //
  // Both refs are refreshed in an effect with no dependency array — that is,
  // after every commit — and never during render. A render can be thrown away
  // under StrictMode and concurrent rendering, and assigning during one can
  // leave the ref holding a closure from a render that never committed.
  const latest = useRef<readonly Hotkey[]>(keys);
  const live = useRef(enabled);
  useEffect(() => {
    latest.current = keys;
    live.current = enabled;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!live.current) return;
      const mod = event.metaKey || event.ctrlKey;
      const typing = isTyping(event.target);

      for (const binding of latest.current) {
        const wantsMod = binding.key.startsWith("mod+");
        const key = wantsMod ? binding.key.slice(4) : binding.key;
        if (event.key !== key) continue;
        if (wantsMod !== mod) continue;
        // Alt is left to the OS: it composes characters on several layouts.
        if (event.altKey) continue;
        if (typing && binding.whileTyping !== true) continue;
        event.preventDefault();
        binding.run(event);
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
