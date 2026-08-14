"use client";

import Link from "next/link";
import { useEffect } from "react";

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
/** The nav pill, decided by whether there is a session — decided by CSS.
 *
 *  The token lives in localStorage, which the server cannot read. The previous
 *  version read it through useSyncExternalStore, whose server snapshot is
 *  signed-out — so SSR painted "Sign in" and hydration flipped it to "Console"
 *  a visible frame later. The wrong state must never paint. So every variant is
 *  in the HTML, tagged with `data-when`, and marketing.css shows exactly one
 *  based on the `data-auth` stamp that `authBootScript` writes on <html>
 *  before first paint. React renders the same markup on both sides; nothing
 *  swaps after hydration.
 *
 *  Both surfaces are named, always, and never by a pronoun: a visitor holding
 *  both sessions gets "Console" plus a named "Speaker portal" side door, and a
 *  speaker still gets a way to sign in as an organiser — `/login` must never
 *  become unreachable from the marketing page.
 */
const ENTRY_LINKS = (
  <>
    <Link className="nalt" data-when="both" href="/portal">
      Speaker portal
    </Link>
    <Link className="nalt" data-when="speaker" href="/login">
      Organiser sign-in
    </Link>
    <Link className="npill" data-when="staff both" href="/admin">
      Console
    </Link>
    <Link className="npill" data-when="speaker" href="/portal">
      Speaker portal
    </Link>
  </>
);

/** Cross-tab only: sign-in and sign-out in *this* tab are document loads
 *  (`restartAt`), which re-run the boot script. A change made in another tab
 *  arrives as a storage event, and the stamp should follow it. */
function useAuthStamp(): void {
  useEffect(() => {
    const restamp = () => {
      const staff = getToken() !== null;
      const speaker = getSpeakerToken() !== null;
      document.documentElement.dataset.auth =
        staff && speaker ? "both" : staff ? "staff" : speaker ? "speaker" : "none";
    };
    window.addEventListener("storage", restamp);
    return () => window.removeEventListener("storage", restamp);
  }, []);
}

export function LandingClient() {
  useAuthStamp();
  // The generated pill is the signed-out default: visible until the stamp says
  // otherwise, and visible with JavaScript off, when no stamp is ever written.
  const entry = { signInHref: "/login", signInLabel: "Sign in", navExtra: ENTRY_LINKS };
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
