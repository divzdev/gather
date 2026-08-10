import { Suspense } from "react";

import { NotPublished, PublicShell, getPublic, type EventInfo } from "../public";
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
    const form = await getPublic<{ event_name: string; event_description: string | null }>(
      slug,
      "/cfp-form",
    );
    return (
      <PublicShell
        event={{
          name: form.event_name,
          slug,
          description: form.event_description,
          location: null,
          starts_on: new Date().toISOString(),
          ends_on: new Date().toISOString(),
        }}
        slug={slug}
        active="My schedule"
      >
        <NotPublished what="schedule" />
      </PublicShell>
    );
  }

  return (
    <PublicShell event={data.event} slug={slug} active="My schedule">
      <Suspense fallback={null}>
        <Picker slug={slug} sessions={data.sessions} />
      </Suspense>
    </PublicShell>
  );
}
