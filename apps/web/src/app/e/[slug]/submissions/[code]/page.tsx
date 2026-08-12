import { PublicShell, getPublicOptional, type EventInfo } from "../../public";
import { SubmissionStatus } from "./status";

export const dynamic = "force-dynamic";

type FormHead = {
  event_name: string;
  event_description: string | null;
  event_location: string | null;
  event_starts_on: string;
  event_ends_on: string;
  event_timezone: string;
};

/** A speaker checking on their own proposal.
 *
 *  This was the one public route that drew no chrome at all — a title, three
 *  lines and a black page, with the browser's back button as the only way out.
 *  A speaker arrives here from an email weeks after submitting, so it is often
 *  the *only* page of the event they see, and it should be a page of the event.
 *
 *  The event's own details come from the call-for-papers endpoint, the one
 *  public route that carries them before a schedule is published. Where there
 *  is no form to read — deleted, or an event that never opened one — the status
 *  still renders, unframed, rather than 404ing a speaker who did nothing wrong.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; code: string }>;
}) {
  const { slug, code } = await params;
  const form = await getPublicOptional<FormHead>(slug, "/cfp-form");
  if (form === null) return <SubmissionStatus slug={slug} code={code} />;

  const event: EventInfo = {
    name: form.event_name,
    slug,
    description: form.event_description,
    location: form.event_location,
    starts_on: form.event_starts_on,
    ends_on: form.event_ends_on,
    timezone: form.event_timezone,
  };
  const published = (await getPublicOptional<unknown>(slug, "/schedule")) !== null;

  return (
    <PublicShell event={event} slug={slug} active="Your proposal" programmePublished={published}>
      <SubmissionStatus slug={slug} code={code} />
    </PublicShell>
  );
}
