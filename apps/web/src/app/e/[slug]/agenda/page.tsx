import {
    PublicShell,
  calendarDate,
  getPublic,
  getPublicOptional,
  type EventInfo,
} from "../public";
import { Card, INK, MONO, SANS, display, trackHue } from "../chrome";
import { NotPublished } from "../chrome";

export const dynamic = "force-dynamic";

type Session = {
  id: string;
  title: string;
  starts_at: string | null;
  room: string | null;
  track: string | null;
  duration_minutes: number;
  speakers: { id: string; name: string }[];
};
type Day = { id: string; date: string; label: string | null; sessions: Session[] };
type Payload = {
  event: EventInfo;
  rooms: { id: string; name: string }[];
  days: Day[];
  unscheduled: Session[];
};

/** This runs on the server, so `undefined` here meant "whatever OS timezone the
 *  Next process happens to be in" — measured as America/Detroit on the dev box,
 *  which is neither the reader's zone nor the event's, and would silently change
 *  on redeploy to another region. A conference programme is stated in the
 *  conference's own local time. */
function time(iso: string | null, timezone: string): string {
  if (iso === null) return "";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(new Date(iso));
}

export default async function Agenda({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getPublicOptional<Payload>(slug, "/agenda");
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
        active="Agenda"
      >
        <NotPublished what="agenda" slug={slug} />
      </PublicShell>
    );
  }

  return (
    <PublicShell event={data.event} slug={slug} active="Agenda">
      <div style={{ display: "grid", gap: 40 }}>
        {data.days.map((day, dayIndex) => (
          <section key={day.id}>
            <h2
              style={{
                ...display("1.4rem", 700),
                color: INK.text,
                paddingBottom: 12,
                marginBottom: 18,
                borderBottom: `1px solid ${INK.edge}`,
                display: "flex",
                alignItems: "baseline",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              {day.label ??
                calendarDate(day.date, { weekday: "long", day: "numeric", month: "long" })}
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 12,
                  fontWeight: 400,
                  letterSpacing: ".1em",
                  color: INK.faint,
                }}
              >
                {day.sessions.length} {day.sessions.length === 1 ? "SESSION" : "SESSIONS"}
              </span>
            </h2>
            {day.sessions.length === 0 ? (
              <p style={{ fontFamily: SANS, fontSize: 15, color: INK.faint, fontWeight: 500 }}>
                Nothing scheduled on this day yet.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {day.sessions.map((session, index) => {
                  const hue = trackHue(dayIndex + index);
                  return (
                    <Card key={session.id} hue={hue} padding={16}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "84px minmax(0,1fr)",
                          gap: 16,
                          alignItems: "baseline",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: MONO,
                            fontSize: 16,
                            color: INK.text,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {time(session.starts_at, data.event.timezone)}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span
                            style={{
                              display: "block",
                              fontFamily: SANS,
                              fontSize: 15.5,
                              fontWeight: 700,
                              color: INK.text,
                            }}
                          >
                            {session.title}
                          </span>
                          <span
                            style={{
                              display: "block",
                              fontFamily: SANS,
                              fontSize: 13.5,
                              fontWeight: 500,
                              color: INK.muted,
                              marginTop: 4,
                            }}
                          >
                            {[
                              session.room,
                              session.track,
                              session.speakers.map((speaker) => speaker.name).join(", "),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        ))}

        {data.unscheduled.length === 0 ? null : (
          <section>
            <h2
              style={{
                ...display("1.15rem", 700),
                color: INK.muted,
                paddingBottom: 12,
                marginBottom: 16,
                borderBottom: `1px solid ${INK.edge}`,
              }}
            >
              Not yet scheduled
            </h2>
            <div style={{ display: "grid", gap: 8 }}>
              {data.unscheduled.map((session) => (
                <p
                  key={session.id}
                  style={{
                    margin: 0,
                    fontFamily: SANS,
                    fontSize: 14.5,
                    fontWeight: 500,
                    color: INK.muted,
                  }}
                >
                  {session.title}
                </p>
              ))}
            </div>
          </section>
        )}
      </div>
    </PublicShell>
  );
}
