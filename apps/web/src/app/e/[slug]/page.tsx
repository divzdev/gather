import { PublicShell, getPublic, type EventInfo } from "./public";

export const dynamic = "force-dynamic";

type Form = {
  event_name: string;
  event_description: string | null;
  event_starts_on: string;
  event_ends_on: string;
  event_location: string | null;
  is_open: boolean;
  closes_at: string | null;
};

export default async function EventLanding({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = await getPublic<Form>(slug, "/cfp-form");
  const event: EventInfo = {
    name: form.event_name,
    slug,
    description: form.event_description,
    location: form.event_location,
    starts_on: form.event_starts_on,
    ends_on: form.event_ends_on,
  };

  return (
    <PublicShell event={event} slug={slug} active="About">
      <div style={{ background: "var(--cd)", border: "1px solid var(--ln)", borderRadius: 14, padding: 28 }}>
        <p style={{ font: "400 17px var(--font-plex-sans)", color: "var(--i2)", margin: 0, lineHeight: 1.6 }}>
          {form.event_description ?? "Details coming soon."}
        </p>
        {form.is_open && (
          <a
            href={`/e/${slug}/cfp`}
            style={{
              display: "inline-block",
              marginTop: 20,
              padding: "10px 22px",
              borderRadius: 999,
              background: "var(--bt)",
              color: "var(--bf)",
              textDecoration: "none",
              font: "600 14px var(--font-plex-sans), sans-serif",
            }}
          >
            Submit a proposal
          </a>
        )}
      </div>
    </PublicShell>
  );
}
