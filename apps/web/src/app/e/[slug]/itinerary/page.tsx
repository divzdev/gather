import { Suspense } from "react";

import { PublicShell, getPublic, type EventInfo } from "../public";
import { NotPublished } from "../chrome";
import { Picker } from "./picker";

export const dynamic = "force-dynamic";

type Session = {
  id: string;
  slug: string;
  title: string;
  starts_at: string | null;
  room: string | null;
  track: string | null;
  duration_minutes: number;
  speakers: { id: string; name: string }[];
};

type Payload = { event: EventInfo; sessions: Session[] };

export default async function Itinerary({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let data: Payload | null = null;
  try {
    // The whole programme is fetched here; which of it is *yours* comes from the
    // query string, and that is client state by design.
    data = await getPublic<Payload>(slug, "/schedule");
  } catch {
    data = null;
  }

  if (data === null) {
    const form = await getPublic<{
      event_name: string;
      event_description: string | null;
      event_starts_on: string;
      event_ends_on: string;
      event_location: string | null;
      event_timezone: string;
    }>(slug, "/cfp-form");
    return (
      <PublicShell
        event={{
          name: form.event_name,
          slug,
          description: form.event_description,
          location: form.event_location,
          starts_on: form.event_starts_on,
          ends_on: form.event_ends_on,
          timezone: form.event_timezone,
        }}
        slug={slug}
        active="My schedule"
      >
        <NotPublished what="schedule" slug={slug} />
      </PublicShell>
    );
  }

  return (
    <PublicShell event={data.event} slug={slug} active="My schedule">
      <Suspense fallback={null}>
        <Picker slug={slug} sessions={data.sessions} timezone={data.event.timezone} />
      </Suspense>
    </PublicShell>
  );
}
