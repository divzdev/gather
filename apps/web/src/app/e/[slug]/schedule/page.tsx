import Link from "next/link";

import { NotPublished, PublicShell, getPublic, type EventInfo } from "../public";

export const dynamic = "force-dynamic";

type Session = {
  id: string; slug: string; title: string; abstract: string | null;
  starts_at: string | null; room: string | null; track: string | null;
  duration_minutes: number; speakers: { id: string; name: string }[];
};
type Payload = { event: EventInfo; sessions: Session[]; tracks: { id: string; name: string }[] };

export default async function SessionsList({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let data: Payload | null = null;
  try {
    data = await getPublic<Payload>(slug, "/schedule");
  } catch {
    data = null;
  }
  if (data === null) {
    const form = await getPublic<{ event_name: string; event_description: string | null }>(slug, "/cfp-form");
    return (
      <PublicShell
        event={{ name: form.event_name, slug, description: form.event_description, location: null, starts_on: new Date().toISOString(), ends_on: new Date().toISOString() }}
        slug={slug}
        active="Sessions"
      >
        <NotPublished what="schedule" />
      </PublicShell>
    );
  }

  return (
    <PublicShell event={data.event} slug={slug} active="Sessions">
      <p style={{ color: "var(--i3)", margin: "0 0 16px", fontSize: 14 }}>
        {data.sessions.length} sessions
      </p>
      <div style={{ display: "grid", gap: 12 }}>
        {data.sessions.map((session) => (
          <article
            key={session.id}
            style={{
              background: "var(--cd)",
              border: "1px solid var(--ln)",
              borderRadius: 14,
              borderLeft: "3px solid var(--sg)",
              padding: 20,
            }}
          >
            <h2 style={{ font: "600 17px var(--font-plex-sans)", color: "var(--ik)", margin: "0 0 6px" }}>
              <Link href={`/e/${slug}/schedule/${session.slug}` as never} style={{ color: "inherit", textDecoration: "none" }}>
                {session.title}
              </Link>
            </h2>
            <p className="tabular" style={{ font: "400 12.5px var(--font-plex-mono)", color: "var(--i3)", margin: "0 0 8px" }}>
              {session.track ?? "Unassigned"} · {session.duration_minutes} min
              {session.room !== null ? ` · ${session.room}` : ""}
            </p>
            {session.abstract !== null && (
              <p style={{ font: "400 14px var(--font-plex-sans)", color: "var(--i2)", margin: "0 0 8px", lineHeight: 1.55 }}>
                {session.abstract.length > 240 ? `${session.abstract.slice(0, 240)}…` : session.abstract}
              </p>
            )}
            <p style={{ font: "500 13px var(--font-plex-sans)", color: "var(--i2)", margin: 0 }}>
              {session.speakers.map((s) => s.name).join(", ")}
            </p>
          </article>
        ))}
      </div>
    </PublicShell>
  );
}
