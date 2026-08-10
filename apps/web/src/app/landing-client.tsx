"use client";

import { useState } from "react";

import { GatherLanding } from "@/components/design/GatherLanding";
import { LandingMotion } from "@/components/landing/LandingMotion";

import { FAQS } from "./faqs";

/** The marketing page's interactive parts.
 *
 *  Split from page.tsx so the route stays a Server Component and keeps its
 *  metadata and structured data. Everything animated — the seven looping demos,
 *  the annotation arrows, the parallax — belongs to LandingMotion; this supplies
 *  only the state the prototype actually drives from React.
 */
export function LandingClient() {
  // One panel open at a time, the first by default. Clicking the open one shuts
  // it, which is why this is an index and not a Set.
  const [open, setOpen] = useState(0);
  const [copied, setCopied] = useState<"embed" | "install" | null>(null);

  const panel = (index: number) => ({
    q: FAQS[index]!.q,
    a: FAQS[index]!.a,
    open: (open === index ? "true" : "false") as "true" | "false",
    glyph: open === index ? "\u2212" : "+",
    rows: open === index ? "1fr" : "0fr",
    toggle: () => setOpen((current) => (current === index ? -1 : index)),
  });

  const copy = (which: "embed" | "install", text: string) => () => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(which);
    window.setTimeout(() => setCopied((current) => (current === which ? null : current)), 1600);
  };

  return (
    // marketing.css scopes the landing's fonts, breakpoints and page background
    // to this attribute, and LandingMotion looks it up to find its demos. The v6
    // prototype moved data-screen-label down onto the sections, so there is
    // nothing else stable at the root to hang them off.
    <div data-marketing>
      <GatherLanding
        d={{
          faqsL: FAQS.slice(0, 4).map((_, index) => panel(index)),
          faqsR: FAQS.slice(4).map((_, index) => panel(index + 4)),
          copyEmbed: copy("embed", EMBED_SNIPPET),
          copyInstall: copy("install", INSTALL_COMMAND),
          showGuides: false,
          showScene: true,
        }}
      />
      <LandingMotion />
      <span aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {copied === null ? "" : "Copied to clipboard"}
      </span>
    </div>
  );
}

const EMBED_SNIPPET =
  '<div id="gather-schedule"></div>\n<script src="https://your-event.example/v1/public/events/your-event/embed.js?widget=schedule" async></script>';

const INSTALL_COMMAND = "git clone https://github.com/your-org/gather && make setup && make dev";
