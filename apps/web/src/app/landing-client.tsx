"use client";

import { useSyncExternalStore } from "react";

import { GatherLanding } from "@/components/design/GatherLanding";
import { getSpeakerToken, getToken } from "@/lib/session";

import { FOOTER_WORDMARK } from "./footer-wordmark";

/** The marketing page's client half.
 *
 *  Split from page.tsx so the route stays a Server Component and keeps its
 *  metadata and structured data.
 *
 *  There is very little here, and that is the design: the v11 landing animates
 *  itself. Its seven product vignettes are CSS keyframes in marketing.css, the
 *  hero lines rise on `animation`, and the scroll reveals and count-ups come
 *  from `DesignMotion`, which the generated component already renders. The
 *  previous landing drove all of that from a JavaScript module per demo; this
 *  one needs one computed value, and it is a list of SVG paths.
 */
/** The nav pill, decided by whether there is a session.
 *
 *  The token lives in localStorage, which the server cannot read, so the
 *  landing rendered "Sign in" to everybody — including an operator who was
 *  signed in, whose click then landed on a login form. Read through an external
 *  store rather than an effect, matching the console rail: the server renders
 *  signed-out and the client corrects on hydration in one pass.
 */
function subscribe(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

function useEntry(): { signInHref: string; signInLabel: string } {
  const staff = useSyncExternalStore(
    subscribe,
    () => getToken() !== null,
    () => false,
  );
  const speaker = useSyncExternalStore(
    subscribe,
    () => getSpeakerToken() !== null,
    () => false,
  );
  if (staff) return { signInHref: "/admin", signInLabel: "Open console" };
  if (speaker) return { signInHref: "/portal", signInLabel: "Your portal" };
  return { signInHref: "/login", signInLabel: "Sign in" };
}

export function LandingClient() {
  const entry = useEntry();
  return (
    // marketing.css scopes the landing's palette, layout and keyframes to this
    // attribute. Unscoped, the prototype's `body` and `a` rules would repaint
    // every console screen. Nothing in the generated markup is stable enough to
    // select on instead, and a scope a redesign could silently drop would take
    // the page's whole stylesheet with it.
    <div data-marketing>
      <GatherLanding d={{ ...FOOTER_WORDMARK, ...entry }} />
    </div>
  );
}
