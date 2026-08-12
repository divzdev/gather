import { PublicShell, getPublic, getPublicOptional, type EventInfo } from "../public";
import { CfpForm } from "./form";

export const dynamic = "force-dynamic";

/** Only the fields the shell needs. The wizard fetches the same endpoint for
 *  itself — it needs the schema, the draft token and the save state, none of
 *  which survive a server boundary — so this is a second read of one cached
 *  route, not a second source of truth. */
type FormHead = {
  event_name: string;
  event_description: string | null;
  event_location: string | null;
  event_starts_on: string;
  event_ends_on: string;
  event_timezone: string;
};

/** The call for papers, inside the event's own site.
 *
 *  It used to draw its own header and live under a different route group, so
 *  "Submit a talk" in the event nav led somewhere that looked like a different
 *  product and offered no way back to Sessions, Speakers or About. The wizard
 *  is unchanged; what changed is that it is now a page of this site.
 */
export default async function Cfp({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = await getPublic<FormHead>(slug, "/cfp-form");

  const event: EventInfo = {
    name: form.event_name,
    slug,
    description: form.event_description,
    location: form.event_location,
    starts_on: form.event_starts_on,
    ends_on: form.event_ends_on,
    timezone: form.event_timezone,
  };

  // The nav dims what the programme cannot yet give. A call for papers is
  // usually open *before* a schedule exists, so this page is the one most
  // likely to be seen with four of the six destinations still waiting.
  const published = (await getPublicOptional<unknown>(slug, "/schedule")) !== null;

  return (
    <PublicShell event={event} slug={slug} active="Submit a talk" programmePublished={published}>
      <CfpForm slug={slug} />
    </PublicShell>
  );
}
