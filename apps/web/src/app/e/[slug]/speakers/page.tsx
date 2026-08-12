import Link from "next/link";

import { API_BASE_URL } from "@/lib/api";

import { PublicShell, getPublic, getPublicOptional, type EventInfo } from "../public";
import { NotPublished } from "../chrome";

export const dynamic = "force-dynamic";

type Speaker = {
  id: string;
  name: string;
  company: string | null;
  job_title: string | null;
  bio: string | null;
  sessions: { id: string; slug: string; title: string }[];
  headshot_file_id: string | null;
};
type Payload = { event: EventInfo; speakers: Speaker[] };

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export default async function Speakers({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getPublicOptional<Payload>(slug, "/speakers");
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
        active="Speakers"
      >
        <NotPublished what="speaker list" slug={slug} />
      </PublicShell>
    );
  }

  return (
    <PublicShell event={data.event} slug={slug} active="Speakers">
      <p style={{ color: "var(--i3)", margin: "0 0 4px", fontSize: 14 }}>
        {data.speakers.length} speakers, by surname
      </p>
      {/* This event's full speaker count runs higher (invited, confirming, or no
          longer presenting all count there) — this gallery is narrower on purpose:
          only people with a talk on the published schedule. Without this line the
          two numbers just look like a bug. */}
      <p style={{ color: "var(--i4)", margin: "0 0 16px", fontSize: 12.5 }}>
        Everyone here has a talk on the published schedule. The event&rsquo;s full speaker list is
        longer — it also counts people who are still confirming or are no longer presenting.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        {data.speakers.map((person) => (
          <article
            key={person.id}
            style={{
              background: "var(--cd)",
              border: "1px solid var(--ln)",
              borderRadius: 14,
              padding: 18,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              {person.headshot_file_id === null || person.headshot_file_id === undefined ? (
                <span
                  aria-hidden
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    flex: "none",
                    background: "var(--sw)",
                    color: "var(--sg)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    font: "600 14px var(--font-plex-condensed), sans-serif",
                  }}
                >
                  {initials(person.name)}
                </span>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element --
                   next/image wants a configured loader and a known host; this is
                   our own API serving a 44px avatar, and the route already sets
                   an immutable cache header. */
                <img
                  src={`${API_BASE_URL}/public/events/${slug}/speakers/${person.headshot_file_id}/photo`}
                  alt=""
                  width={44}
                  height={44}
                  loading="lazy"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    flex: "none",
                    objectFit: "cover",
                    background: "var(--sw)",
                  }}
                />
              )}
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    font: "600 15px var(--font-plex-sans)",
                    color: "var(--ik)",
                  }}
                >
                  {person.name}
                </span>
                <span
                  style={{
                    display: "block",
                    font: "400 12.5px var(--font-plex-sans)",
                    color: "var(--i3)",
                  }}
                >
                  {[person.job_title, person.company].filter(Boolean).join(", ")}
                </span>
              </span>
            </div>
            {person.bio !== null && (
              <p
                style={{
                  font: "400 13.5px var(--font-plex-sans)",
                  color: "var(--i2)",
                  margin: "0 0 10px",
                  lineHeight: 1.55,
                }}
              >
                {person.bio.length > 180 ? `${person.bio.slice(0, 180)}…` : person.bio}
              </p>
            )}
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
              {person.sessions.map((session) => (
                <li key={session.id}>
                  {/* These were bare 17px text links — 55 of the 68 controls on
                      this page sat under the floor, and they are the only route
                      from a speaker to their talk. */}
                  <Link
                    href={`/e/${slug}/schedule/${session.slug}` as never}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      minHeight: 36,
                      padding: "0 12px",
                      borderRadius: 999,
                      background: "var(--sw)",
                      font: "500 13px var(--font-plex-sans)",
                      color: "var(--sg)",
                      textDecoration: "none",
                    }}
                  >
                    {session.title}
                  </Link>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </PublicShell>
  );
}
