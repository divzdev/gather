import {
  NotPublished,
  PublicShell,
  calendarDate,
  getPublic,
  getPublicOptional,
  type EventInfo,
} from "../public";

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
        <NotPublished what="agenda" />
      </PublicShell>
    );
  }

  return (
    <PublicShell event={data.event} slug={slug} active="Agenda">
      {data.days.map((day) => (
        <section key={day.id} style={{ marginBottom: 28 }}>
          <h2
            style={{
              font: "600 18px var(--font-plex-sans)",
              color: "var(--ik)",
              margin: "0 0 12px",
            }}
          >
            {day.label ??
              calendarDate(day.date, { weekday: "long", day: "numeric", month: "long" })}
          </h2>
          {day.sessions.length === 0 ? (
            <p style={{ color: "var(--i3)", fontSize: 14 }}>Nothing scheduled on this day yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {day.sessions.map((session) => (
                <div
                  key={session.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "96px 1fr",
                    gap: 14,
                    background: "var(--cd)",
                    border: "1px solid var(--ln)",
                    borderRadius: 10,
                    padding: "12px 16px",
                  }}
                >
                  <span
                    className="tabular"
                    style={{ font: "500 13px var(--font-plex-mono)", color: "var(--i3)" }}
                  >
                    {time(session.starts_at, data.event.timezone)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        font: "600 14px var(--font-plex-sans)",
                        color: "var(--ik)",
                      }}
                    >
                      {session.title}
                    </span>
                    <span
                      style={{
                        display: "block",
                        font: "400 12.5px var(--font-plex-sans)",
                        color: "var(--i3)",
                        marginTop: 2,
                      }}
                    >
                      {[session.room, session.track, session.speakers.map((s) => s.name).join(", ")]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
      {data.unscheduled.length > 0 && (
        <section>
          <h2
            style={{
              font: "600 15px var(--font-plex-sans)",
              color: "var(--i3)",
              margin: "0 0 10px",
            }}
          >
            Not yet scheduled
          </h2>
          <div style={{ display: "grid", gap: 6 }}>
            {data.unscheduled.map((session) => (
              <p
                key={session.id}
                style={{ margin: 0, font: "400 13.5px var(--font-plex-sans)", color: "var(--i2)" }}
              >
                {session.title}
              </p>
            ))}
          </div>
        </section>
      )}
    </PublicShell>
  );
}
