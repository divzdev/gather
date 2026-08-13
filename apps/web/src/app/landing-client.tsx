"use client";

import Link from "next/link";
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

type Entry = { signInHref: string; signInLabel: string; navExtra?: React.ReactNode };

/** The quiet second door.
 *
 *  A session in localStorage turned the pill into that session's destination
 *  and nothing else, so a visitor holding a speaker token — anyone who has
 *  looked at the portal, which is most of a walkthrough — met a nav offering
 *  "Your portal" and no way to sign in as an organiser. `/login` was reachable
 *  the whole time; the marketing page simply stopped linking to it.
 */
const ORGANISER_SIGN_IN = (
  <Link className="nalt" href="/login">
    Organiser sign-in
  </Link>
);

const SPEAKER_PORTAL = (
  <Link className="nalt" href="/portal">
    Speaker portal
  </Link>
);

function useEntry(): Entry {
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
  // Both surfaces are named, always, and never by a pronoun. "Your portal"
  // beside "Console" told a visitor which one was theirs but not what either
  // one was — and offering "Sign in" to somebody already signed in is worse
  // than offering nothing.
  if (staff && speaker)
    return { signInHref: "/admin", signInLabel: "Console", navExtra: SPEAKER_PORTAL };
  if (staff) return { signInHref: "/admin", signInLabel: "Console" };
  if (speaker)
    return { signInHref: "/portal", signInLabel: "Speaker portal", navExtra: ORGANISER_SIGN_IN };
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
