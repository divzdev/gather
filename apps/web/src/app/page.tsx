import type { Metadata } from "next";

import { LandingClient } from "./landing-client";

/** Taken from the prototype's <helmet>, which dc2tsx drops — fonts and shell
 *  live in layout.tsx, so the metadata has to be restated here. */
export const metadata: Metadata = {
  title: "Gather: open source speaker and program management for conferences",
  description:
    "Run your call for papers, committee review, speaker onboarding and agenda in one open source tool. Self-hosted, MIT licensed, and fast enough to use all day.",
  openGraph: {
    title: "So, you're running a conference.",
    description:
      "Gather runs the speaker program end to end. Proposals, scoring, decisions, speaker onboarding, the schedule, and the public program page.",
  },
  twitter: { card: "summary_large_image" },
};

const SOFTWARE = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Gather",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Self-hosted",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  license: "https://opensource.org/licenses/MIT",
  description: metadata.description,
};

/* The FAQPage structured data that used to sit here is gone with the FAQ. The
 * redesigned page asks no questions, and a rich result promising answers a
 * visitor then cannot find is exactly the markup search engines penalise — the
 * schema has to describe this page, not the one it replaced. */

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        // Built above from literals in this repo, never from user input, so
        // there is nothing here to escape.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE) }}
      />
      <LandingClient />
    </>
  );
}
