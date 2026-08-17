"use client";

/** Getting out of a session page.
 *
 *  Browser back is not a control — a visitor who followed a shared link has no
 *  back to press, and one who came from the agenda after scrolling to 16:00
 *  wants that scroll position, which a fresh navigation to /agenda throws away.
 *
 *  So this is a real link to the agenda that *upgrades itself* to a history step
 *  when it can see we came from this site. No state and no effect: the referrer
 *  is only consulted at the moment of the click, by which time the browser has
 *  long since decided what it is, and with JavaScript off the anchor still
 *  works.
 */

import { useRouter } from "next/navigation";

export function Back({ slug }: { slug: string }) {
  const router = useRouter();

  return (
    <a
      href={`/e/${slug}/agenda`}
      onClick={(event) => {
        let internal = false;
        try {
          internal =
            document.referrer !== "" &&
            new URL(document.referrer).origin === window.location.origin;
        } catch {
          internal = false;
        }
        if (!internal) return;
        event.preventDefault();
        router.back();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: "var(--control-h-sm, 36px)",
        padding: "0 14px",
        marginBottom: 16,
        borderRadius: 999,
        border: "1px solid var(--e-edge-strong, rgba(255,255,255,.18))",
        background: "none",
        color: "var(--e-muted, #9A9FB1)",
        font: "500 12.5px var(--font-manrope), sans-serif",
        textDecoration: "none",
      }}
    >
      ← Back to the agenda
    </a>
  );
}
