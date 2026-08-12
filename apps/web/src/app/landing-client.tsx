"use client";

import { GatherLanding } from "@/components/design/GatherLanding";

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
export function LandingClient() {
  return (
    // marketing.css scopes the landing's palette, layout and keyframes to this
    // attribute. Unscoped, the prototype's `body` and `a` rules would repaint
    // every console screen. Nothing in the generated markup is stable enough to
    // select on instead, and a scope a redesign could silently drop would take
    // the page's whole stylesheet with it.
    <div data-marketing>
      <GatherLanding d={FOOTER_WORDMARK} />
    </div>
  );
}
