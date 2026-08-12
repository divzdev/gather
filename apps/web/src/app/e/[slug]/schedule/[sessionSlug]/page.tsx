import {
  PublicShell,
  eventDay,
  eventTime,
  getPublic,
  zoneLabel,
  type EventInfo,
} from "../../public";

export const dynamic = "force-dynamic";

type Payload = {
  event: EventInfo;
  session: {
    title: string;
    abstract: string | null;
    track: string | null;
    room: string | null;
    starts_at: string | null;
    duration_minutes: number;
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
      <article
        style={{
          background: "var(--cd)",
          border: "1px solid var(--ln)",
          borderRadius: 14,
          padding: 28,
          maxWidth: 720,
        }}
      >
        {/* `starts_at` was in the payload type and rendered nowhere, so anyone
            arriving from a shared link or a search result could not tell when
            the talk was without leaving the page. */}
        <p
          className="tabular"
          style={{ font: "500 14px var(--font-plex-mono)", color: "var(--ik)", margin: "0 0 6px" }}
        >
          {s.starts_at === null
            ? "Time to be confirmed"
            : `${eventDay(s.starts_at, data.event.timezone)} · ${eventTime(s.starts_at, data.event.timezone)}–${eventTime(
                new Date(
                  new Date(s.starts_at).getTime() + s.duration_minutes * 60_000,
                ).toISOString(),
                data.event.timezone,
              )} ${zoneLabel(s.starts_at, data.event.timezone)}`}
        </p>
        <p
          className="tabular"
          style={{
            font: "400 12.5px var(--font-plex-mono)",
            color: "var(--i3)",
            margin: "0 0 8px",
          }}
        >
          {s.track ?? "Unassigned"} · {s.duration_minutes} min
          {s.room !== null ? ` · ${s.room}` : ""}
        </p>
        {/* `PublicShell` already renders the event name as this page's `<h1>` —
            a second one here (the session title) gave every session page two
            top-level headings, which is what a screen reader's landmark list
            reads as "which one is the page actually about?" */}
        <h2
          style={{
            font: "600 28px var(--font-bricolage), sans-serif",
            color: "var(--ik)",
            margin: "0 0 12px",
          }}
        >
          {s.title}
        </h2>
        <p
          style={{ font: "500 14px var(--font-plex-sans)", color: "var(--i2)", margin: "0 0 18px" }}
        >
          {s.speakers.map((p) => (p.company ? `${p.name}, ${p.company}` : p.name)).join(" · ")}
        </p>
        {s.abstract !== null && (
          <p
            style={{
              font: "400 16px var(--font-plex-sans)",
              color: "var(--i2)",
              lineHeight: 1.65,
              margin: 0,
              whiteSpace: "pre-wrap",
            }}
          >
            {s.abstract}
          </p>
        )}
      </article>
    </PublicShell>
  );
}
