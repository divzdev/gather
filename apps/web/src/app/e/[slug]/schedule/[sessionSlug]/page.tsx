import {
  PublicShell,
  eventDay,
  eventTime,
  getPublic,
  zoneLabel,
  type EventInfo,
} from "../../public";
import { Back } from "./back";

export const dynamic = "force-dynamic";

type Payload = {
  event: EventInfo;
  session: {
    title: string;
    abstract: string | null;
    track: string | null;
    room: string | null;
    format: string | null;
    starts_at: string | null;
    duration_minutes: number;
    speakers: { id: string; name: string; job_title: string | null; company: string | null }[];
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
      <Back slug={slug} />
      <article
        style={{
          background: "var(--e-raised, #101018)",
          border: "1px solid var(--e-edge, rgba(255,255,255,.10))",
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
          style={{
            font: "500 14px ui-monospace,'SF Mono',Menlo,monospace",
            color: "var(--e-text, #F3F4F8)",
            margin: "0 0 6px",
          }}
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
            font: "400 12.5px ui-monospace,'SF Mono',Menlo,monospace",
            color: "var(--e-muted, #9A9FB1)",
            margin: "0 0 8px",
          }}
        >
          {/* `format` is in the snapshot and was the one attribute this page
              dropped — and it is the one telling a visitor whether they are
              reading about a 30-minute talk, a workshop or a panel.

              Formats here are named with their nominal length ("Keynote
              (45 min)"), which is not always what this session was scheduled
              for. Printing both gave "Keynote (45 min) · 30 min", so the real
              duration is only added when the name does not already claim one. */}
          {[
            s.track ?? "Unassigned",
            s.format,
            s.format !== null && /\d+\s*min/i.test(s.format) ? null : `${s.duration_minutes} min`,
            s.room,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {/* `PublicShell` already renders the event name as this page's `<h1>` —
            a second one here (the session title) gave every session page two
            top-level headings, which is what a screen reader's landmark list
            reads as "which one is the page actually about?" */}
        <h2
          style={{
            font: "600 28px var(--font-manrope), sans-serif",
            color: "var(--e-text, #F3F4F8)",
            margin: "0 0 12px",
          }}
        >
          {s.title}
        </h2>
        <p
          style={{
            font: "500 14px var(--font-manrope), sans-serif",
            color: "var(--e-muted, #9A9FB1)",
            margin: "0 0 18px",
          }}
        >
          {s.speakers
            .map((p) => [p.name, p.job_title, p.company].filter(Boolean).join(", "))
            .join(" · ")}
        </p>
        {s.abstract !== null && (
          <p
            style={{
              font: "400 16px var(--font-manrope), sans-serif",
              color: "var(--e-muted, #9A9FB1)",
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
