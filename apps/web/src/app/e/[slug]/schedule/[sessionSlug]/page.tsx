import { PublicShell, getPublic, type EventInfo } from "../../public";

export const dynamic = "force-dynamic";

type Payload = {
  event: EventInfo;
  session: {
    title: string; abstract: string | null; track: string | null; room: string | null;
    starts_at: string | null; duration_minutes: number;
    speakers: { id: string; name: string; company: string | null }[];
  };
};

export default async function SessionDetail({
  params,
}: {
  params: Promise<{ slug: string; sessionSlug: string }>;
}) {
  const { slug, sessionSlug } = await params;
  const data = await getPublic<Payload>(slug, `/schedule/${sessionSlug}`);
  const s = data.session;

  return (
    <PublicShell event={data.event} slug={slug} active="Sessions">
      <article style={{ background: "var(--cd)", border: "1px solid var(--ln)", borderRadius: 14, padding: 28, maxWidth: 720 }}>
        <p className="tabular" style={{ font: "400 12.5px var(--font-plex-mono)", color: "var(--i3)", margin: "0 0 8px" }}>
          {s.track ?? "Unassigned"} · {s.duration_minutes} min{s.room !== null ? ` · ${s.room}` : ""}
        </p>
        <h1 style={{ font: "600 28px var(--font-bricolage), sans-serif", color: "var(--ik)", margin: "0 0 12px" }}>
          {s.title}
        </h1>
        <p style={{ font: "500 14px var(--font-plex-sans)", color: "var(--i2)", margin: "0 0 18px" }}>
          {s.speakers.map((p) => (p.company ? `${p.name}, ${p.company}` : p.name)).join(" · ")}
        </p>
        {s.abstract !== null && (
          <p style={{ font: "400 16px var(--font-plex-sans)", color: "var(--i2)", lineHeight: 1.65, margin: 0, whiteSpace: "pre-wrap" }}>
            {s.abstract}
          </p>
        )}
      </article>
    </PublicShell>
  );
}
