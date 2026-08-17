import Link from "next/link";

import { PublicShell, calendarDate, getPublic, getPublicOptional, type EventInfo } from "../public";
import { Card, INK, MONO, SANS, display, trackHue } from "../chrome";
import { NotPublished } from "../chrome";

export const dynamic = "force-dynamic";

type Session = {
  id: string;
  //: The public agenda payload has always carried this; nothing read it until
  //: the card became a link.
  slug: string;
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

export default async function Agenda({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const rawDay = Array.isArray(query.day) ? query.day[0] : query.day;
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
        programmePublished={false}
      >
        <NotPublished what="agenda" slug={slug} />
      </PublicShell>
    );
  }

  // An attendee reads this page to plan their days, and a day with nothing on
  // it is not a plan — it is scaffolding the organiser has not used yet. Skip
  // empty days once anything is scheduled; if nothing is scheduled anywhere,
  // keep them, because a wall of headings at least shows the shape to come.
  const anyScheduled = data.days.some((day) => day.sessions.length > 0);
  const withSessions = anyScheduled
    ? data.days.filter((day) => day.sessions.length > 0)
    : data.days;

  /** Day navigation, as links rather than client state.
   *
   *  This page rendered every day at once and offered no way to move between
   *  them: on a three-day conference that is a wall you scroll past to reach
   *  Thursday. Links keep it a Server Component, keep one day shareable, and
   *  work with JavaScript off — and "All days" keeps the view that existed
   *  before, because reading the whole programme at once is a real thing to
   *  want. An unknown ?day= falls back to all rather than to nothing. */
  const selected = withSessions.some((day) => day.date === rawDay) ? rawDay : undefined;
  const days =
    selected === undefined ? withSessions : withSessions.filter((d) => d.date === selected);

  const dayTab = (label: string, href: string, on: boolean) => (
    <Link
      key={href}
      href={href as never}
      aria-current={on ? "page" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 40,
        padding: "0 18px",
        borderRadius: 999,
        border: `1px solid ${on ? "transparent" : INK.edge}`,
        background: on ? INK.text : "transparent",
        color: on ? INK.page : INK.muted,
        fontFamily: SANS,
        fontSize: 13.5,
        fontWeight: 600,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </Link>
  );

  return (
    <PublicShell event={data.event} slug={slug} active="Agenda">
      {withSessions.length < 2 ? null : (
        <nav
          aria-label="Conference days"
          style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 28px" }}
        >
          {dayTab("All days", `/e/${slug}/agenda`, selected === undefined)}
          {withSessions.map((day) =>
            dayTab(
              day.label ??
                calendarDate(day.date, { weekday: "short", day: "numeric", month: "short" }),
              `/e/${slug}/agenda?day=${day.date}`,
              selected === day.date,
            ),
          )}
        </nav>
      )}
      <div style={{ display: "grid", gap: 40 }}>
        {days.map((day, dayIndex) => (
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
                          {/* The agenda was the one surface where a talk was a
                              dead end: the title sat as plain text while the
                              same session on the Sessions list linked through
                              to a page carrying its abstract, full time range,
                              room, track and format. Someone reading the
                              programme is exactly the person deciding what to
                              go to, so it is the worst place to stop. */}
                          <Link
                            href={`/e/${slug}/schedule/${session.slug}` as never}
                            style={{
                              display: "block",
                              fontFamily: SANS,
                              fontSize: 15.5,
                              fontWeight: 700,
                              color: INK.text,
                              textDecoration: "none",
                            }}
                          >
                            {session.title}
                          </Link>
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
