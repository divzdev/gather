"use client";

/** A rail item that says it heard you, while the next screen is still coming.
 *
 *  `admin/loading.tsx` used to cover this window, and the cure was worse than
 *  the disease: it is the Suspense fallback for the whole page, so every
 *  navigation threw away the rail and the header — identical on both screens —
 *  and rebuilt them from grey bones. Warm transitions here are about 40ms, so
 *  what that produced was not a loading state anyone could read, just a flash.
 *  Worse on a phone, where the skeleton drew a 256px rail on a 390px screen and
 *  the content jumped 390 → 134 → 390.
 *
 *  Without it React simply holds the current screen until the next one is
 *  ready, which is seamless at 40ms and silent at 700ms — measured on a
 *  throttled connection. Hence this: the one thing the skeleton was genuinely
 *  buying, at the size of the thing that needed feedback.
 *
 *  Absolutely positioned, so it cannot move the row it appears in. Not
 *  `position: fixed`: on mobile the rail carries a `transform` to slide
 *  off-canvas, and a transformed ancestor becomes the containing block for
 *  fixed descendants — a top-of-viewport progress bar rendered from in here
 *  would be positioned against a box parked at -100%.
 */

import { useLinkStatus } from "next/link";

export function NavPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      data-nav-pending
      style={{
        position: "absolute",
        right: 10,
        top: "50%",
        width: 12,
        height: 12,
        marginTop: -6,
        borderRadius: "50%",
        border: "1.5px solid var(--ls)",
        borderTopColor: "var(--sg)",
        /* Held invisible for 160ms. A warm navigation is done in about 40, and
           a spinner that appears and vanishes inside 40ms is its own small
           flicker — the exact complaint this whole change exists to answer. So
           it stays hidden unless the wait is real enough to need explaining. */
        opacity: 0,
        animation: "nav-pending-spin .6s linear infinite, nav-pending-in 1ms linear 160ms forwards",
      }}
    />
  );
}
