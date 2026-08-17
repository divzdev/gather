import Link from "next/link";

import { BROWSER_API_BASE_URL } from "@/lib/api";

import {
  PublicShell,
  eventDay,
  eventTime,
  getPublic,
  getPublicOptional,
  type EventInfo,
} from "../public";
import { Card, INK, MONO, SANS, Section, trackHue } from "../chrome";
import { NotPublished } from "../chrome";
import { Bio } from "./bio";

export const dynamic = "force-dynamic";

type Speaker = {
  id: string;
  name: string;
  company: string | null;
  job_title: string | null;
  bio: string | null;
  sessions: {
    id: string;
    slug: string;
    title: string;
    starts_at: string | null;
    room: string | null;
  }[];
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

export default async function Speakers({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const openId = Array.isArray(query.speaker) ? query.speaker[0] : query.speaker;
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
        programmePublished={false}
      >
        <NotPublished what="speaker list" slug={slug} />
      </PublicShell>
    );
  }

  const open = data.speakers.find((person) => person.id === openId);

  return (
    <PublicShell event={data.event} slug={slug} active="Speakers">
      <Section
        eyebrow="Speakers"
        title={`${data.speakers.length} people are talking.`}
        lede={
          // The event's full roster runs higher — invited, still confirming, or
          // no longer presenting all count there. Without saying so the two
          // numbers read as a bug.
          "Everyone here has a talk on the published schedule. The event's full speaker list is longer: it also counts people still confirming, and people no longer presenting."
        }
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
            gap: 16,
          }}
        >
          {data.speakers.map((person, index) => {
            const hue = trackHue(index);
            return (
              <Card key={person.id} hue={hue} padding={20}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                  {person.headshot_file_id === null || person.headshot_file_id === undefined ? (
                    <span
                      aria-hidden
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 999,
                        flex: "none",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: `color-mix(in srgb, ${hue} 22%, ${INK.raised})`,
                        border: `1px solid color-mix(in srgb, ${hue} 40%, transparent)`,
                        color: hue,
                        fontFamily: SANS,
                        fontWeight: 800,
                        fontSize: 16,
                      }}
                    >
                      {initials(person.name)}
                    </span>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element --
                       next/image wants a configured loader and a known host; this
                       is our own API serving a 48px avatar, and the route already
                       sets an immutable cache header. */
                    <img
                      src={`${BROWSER_API_BASE_URL}/public/events/${slug}/speakers/${person.headshot_file_id}/photo`}
                      alt=""
                      width={48}
                      height={48}
                      loading="lazy"
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 999,
                        flex: "none",
                        objectFit: "cover",
                        background: INK.raised,
                      }}
                    />
                  )}
                  <span style={{ minWidth: 0 }}>
                    {/* The gallery was a wall: a card carried a truncated bio
                        and links to the talks, and no way to read the rest of
                        the person. The name opens them. */}
                    <Link
                      href={`/e/${slug}/speakers?speaker=${person.id}` as never}
                      scroll={false}
                      style={{
                        display: "block",
                        fontFamily: SANS,
                        fontSize: 16,
                        fontWeight: 700,
                        color: INK.text,
                        textDecoration: "none",
                      }}
                    >
                      {person.name}
                    </Link>
                    <span
                      style={{
                        display: "block",
                        fontFamily: SANS,
                        fontSize: 13,
                        fontWeight: 500,
                        color: INK.faint,
                      }}
                    >
                      {[person.job_title, person.company].filter(Boolean).join(" · ") || "Speaker"}
                    </span>
                  </span>
                </div>
                {person.bio === null ? null : (
                  <p
                    style={{
                      fontFamily: SANS,
                      fontSize: 14,
                      fontWeight: 500,
                      color: INK.muted,
                      lineHeight: 1.55,
                      margin: "0 0 14px",
                    }}
                  >
                    {person.bio.length > 170 ? `${person.bio.slice(0, 170)}…` : person.bio}
                  </p>
                )}
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
                  {person.sessions.map((session) => (
                    <li key={session.id}>
                      {/* These were bare 17px text links — 55 of the 68 controls
                          on this page sat under the floor, and they are the only
                          route from a speaker to their talk. */}
                      <Link
                        href={`/e/${slug}/schedule/${session.slug}` as never}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          minHeight: 36,
                          padding: "0 14px",
                          borderRadius: 999,
                          background: `color-mix(in srgb, ${hue} 14%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${hue} 32%, transparent)`,
                          fontFamily: SANS,
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: INK.text,
                          textDecoration: "none",
                        }}
                      >
                        {session.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      </Section>
      {open === undefined ? null : (
        <SpeakerPanel speaker={open} slug={slug} timezone={data.event.timezone} />
      )}
    </PublicShell>
  );
}

/** Server-rendered, opened by `?speaker=`, closed by a link back.
 *
 *  A client dialog would have meant shipping the whole grid to the browser to
 *  hold one id. This way the panel is shareable, the back button closes it, and
 *  `scroll={false}` on both links means the grid is exactly where it was. */
function SpeakerPanel({
  speaker,
  slug,
  timezone,
}: {
  speaker: Speaker;
  slug: string;
  timezone: string;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={speaker.name}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "grid",
        placeItems: "center",
        padding: 20,
        background: "rgba(0,0,0,.66)",
      }}
    >
      <Link
        href={`/e/${slug}/speakers` as never}
        scroll={false}
        aria-label="Close"
        style={{ position: "absolute", inset: 0 }}
      />
      <div
        style={{
          position: "relative",
          width: "min(560px, 100%)",
          maxHeight: "84vh",
          overflowY: "auto",
          background: INK.raised,
          border: `1px solid ${INK.edge}`,
          borderRadius: 16,
          padding: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          {speaker.headshot_file_id === null ? (
            <span
              aria-hidden
              style={{
                width: 64,
                height: 64,
                borderRadius: 999,
                flex: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: INK.page,
                border: `1px solid ${INK.edge}`,
                color: INK.muted,
                fontFamily: SANS,
                fontWeight: 800,
                fontSize: 20,
              }}
            >
              {initials(speaker.name)}
            </span>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element -- our own API,
               already cache-immutable; next/image wants a configured host. */
            <img
              src={`${BROWSER_API_BASE_URL}/public/events/${slug}/speakers/${speaker.headshot_file_id}/photo`}
              alt=""
              width={64}
              height={64}
              style={{ width: 64, height: 64, borderRadius: 999, flex: "none", objectFit: "cover" }}
            />
          )}
          <span style={{ minWidth: 0, flex: 1 }}>
            <span
              style={{
                display: "block",
                fontFamily: SANS,
                fontSize: 20,
                fontWeight: 700,
                color: INK.text,
              }}
            >
              {speaker.name}
            </span>
            <span
              style={{
                display: "block",
                fontFamily: SANS,
                fontSize: 13.5,
                fontWeight: 500,
                color: INK.muted,
                marginTop: 2,
              }}
            >
              {[speaker.job_title, speaker.company].filter(Boolean).join(" · ") || "Speaker"}
            </span>
          </span>
          <Link
            href={`/e/${slug}/speakers` as never}
            scroll={false}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              flex: "none",
              borderRadius: 999,
              border: `1px solid ${INK.edge}`,
              color: INK.muted,
              fontFamily: SANS,
              fontSize: 15,
              textDecoration: "none",
            }}
          >
            ✕
          </Link>
        </div>

        {speaker.bio === null || speaker.bio === "" ? null : (
          <Bio text={speaker.bio} color={INK.muted} font={SANS} />
        )}

        <p
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: ".08em",
            color: INK.faint,
            margin: "0 0 10px",
          }}
        >
          SESSIONS ({speaker.sessions.length})
        </p>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {speaker.sessions.map((session) => (
            <li key={session.id}>
              <Link
                href={`/e/${slug}/schedule/${session.slug}` as never}
                style={{
                  display: "block",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: `1px solid ${INK.edge}`,
                  textDecoration: "none",
                }}
              >
                <span
                  style={{
                    display: "block",
                    fontFamily: SANS,
                    fontSize: 14.5,
                    fontWeight: 600,
                    color: INK.text,
                  }}
                >
                  {session.title}
                </span>
                <span
                  style={{
                    display: "block",
                    fontFamily: MONO,
                    fontSize: 12,
                    color: INK.faint,
                    marginTop: 4,
                  }}
                >
                  {session.starts_at === null
                    ? "Time to be confirmed"
                    : `${eventDay(session.starts_at, timezone)} · ${eventTime(session.starts_at, timezone)}`}
                  {session.room === null ? "" : ` · ${session.room}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
