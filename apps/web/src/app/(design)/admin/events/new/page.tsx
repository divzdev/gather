"use client";

/** Founding an event.
 *
 *  This used to live at /admin/welcome and look like a contact form: four
 *  fields in a grey box. Naming a conference and fixing its dates is the first
 *  real decision of running one — every deadline, every reminder and the whole
 *  public programme hang off what is typed here — so it is given the weight of
 *  the thing it is, and shows the public page taking shape beside it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { authed, setEventId } from "@/lib/session";

type EventRow = { id: string; name: string };

const ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** A calendar date, not an instant: `new Date("2027-05-12")` is the day before
 *  in any western timezone. */
function parseDay(iso: string): Date | null {
  if (iso === "") return null;
  const [year, month, day] = iso.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  return new Date(year, month - 1, day);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export default function NewEventPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [problem, setProblem] = useState("");

  const { data: events } = useQuery({
    queryKey: ["my-events"],
    queryFn: () => authed<EventRow[]>("/events"),
  });
  const isFirst = events !== undefined && events.length === 0;

  const publicSlug = slugTouched ? slug : slugify(name);

  /** Today in the event's own zone, which is the floor the API enforces.
   *
   *  Taking it from the browser instead would disagree with the server by a day
   *  for anyone whose clock has turned over and the conference's has not — the
   *  form would accept a date the API then refuses, or refuse one it would take.
   *  Recomputed only when the zone changes rather than on every render. */
  const earliest = useMemo(
    () => new Date().toLocaleDateString("en-CA", { timeZone: timezone }),
    [timezone],
  );

  const start = parseDay(startsOn);
  const end = parseDay(endsOn);
  const days =
    start !== null && end !== null
      ? Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
      : null;

  const create = useMutation({
    mutationFn: () =>
      authed<EventRow>("/events", {
        method: "POST",
        body: {
          name: name.trim(),
          starts_on: startsOn,
          ends_on: endsOn,
          timezone,
          location: location.trim() === "" ? null : location.trim(),
          description: description.trim() === "" ? null : description.trim(),
          slug: publicSlug === "" ? null : publicSlug,
        },
      }),
    onSuccess: async (event) => {
      setEventId(event.id);
      // The console guard reads the same list to decide whether to send someone
      // here; without this it still holds the empty answer and bounces back.
      await queryClient.invalidateQueries({ queryKey: ["my-events"] });
      router.push("/admin");
    },
    onError: (error: Error) => setProblem(error.message),
  });

  const firstProblem = (): string | null => {
    if (name.trim() === "") return "Give the event a name.";
    if (startsOn === "" || endsOn === "") return "Say when it starts and ends.";
    // The picker's `min` is a suggestion a keyboard can walk straight past, so
    // the same rule is stated here and enforced again by the API.
    if (startsOn < earliest) return "An event cannot start in the past.";
    if (end !== null && start !== null && end < start) return "It cannot end before it starts.";
    return null;
  };

  const field: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    height: 44,
    padding: "0 14px",
    borderRadius: 10,
    border: "1px solid var(--ls)",
    background: "var(--cd)",
    color: "var(--ik)",
    font: "400 14.5px var(--font-plex-sans)",
  };
  const label: React.CSSProperties = {
    display: "block",
    font: "500 12px var(--font-plex-sans)",
    letterSpacing: "0.02em",
    color: "var(--i2)",
    marginBottom: 7,
  };
  const optional = (
    <span style={{ font: "400 11.5px var(--font-plex-sans)", color: "var(--i4)" }}> optional</span>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--pp)", position: "relative" }}>
      {/* A wash of the event's own accent, so the page reads as a beginning
          rather than a settings pane. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          height: 420,
          background:
            "radial-gradient(90% 120% at 12% 0%, var(--sw) 0%, transparent 60%), radial-gradient(70% 100% at 88% 4%, var(--sw) 0%, transparent 55%)",
          opacity: 0.75,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          maxWidth: 1080,
          margin: "0 auto",
          padding: "clamp(40px,7vh,84px) 24px 96px",
        }}
      >
        <p
          style={{
            font: "600 11px var(--font-plex-mono), monospace",
            letterSpacing: "0.14em",
            color: "var(--sg)",
            margin: "0 0 14px",
          }}
        >
          {isFirst ? "FIRST EVENT" : "NEW EVENT"}
        </p>
        <h1
          style={{
            font: "700 clamp(34px,5vw,52px)/1.04 var(--font-bricolage), sans-serif",
            letterSpacing: "-0.03em",
            color: "var(--ik)",
            margin: "0 0 12px",
            maxWidth: 14 + "ch",
          }}
        >
          Let&rsquo;s make an event.
        </h1>
        <p
          style={{
            font: "400 16px/1.6 var(--font-plex-sans)",
            color: "var(--i2)",
            margin: "0 0 40px",
            maxWidth: "52ch",
          }}
        >
          {isFirst
            ? "Everything else hangs off this: the call for papers, every speaker deadline, and the programme the public sees."
            : "A second event, with its own speakers, programme and public page. Your speaker directory is shared across both."}
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(340px,100%), 1fr))",
            gap: 28,
            alignItems: "start",
          }}
        >
          {/* ---- the form ---- */}
          <div style={{ display: "grid", gap: 22 }}>
            <div>
              <label htmlFor="ev-name" style={label}>
                What is it called?
              </label>
              <input
                id="ev-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="DevFlow Conf 2027"
                style={{
                  ...field,
                  height: 62,
                  font: "600 24px var(--font-bricolage), sans-serif",
                  letterSpacing: "-0.01em",
                  padding: "0 18px",
                }}
              />
              <p
                style={{
                  font: "400 12px var(--font-plex-mono), monospace",
                  color: "var(--i4)",
                  margin: "8px 0 0",
                }}
              >
                {publicSlug === "" ? (
                  "Its public address appears here as you type."
                ) : (
                  <>
                    gather.dev/e/
                    <input
                      aria-label="Public address"
                      value={publicSlug}
                      onChange={(event) => {
                        setSlugTouched(true);
                        setSlug(slugify(event.target.value));
                      }}
                      style={{
                        border: "none",
                        background: "none",
                        color: "var(--sg)",
                        font: "500 12px var(--font-plex-mono), monospace",
                        width: `${Math.max(publicSlug.length, 8)}ch`,
                        padding: 0,
                      }}
                    />
                  </>
                )}
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label htmlFor="ev-starts" style={label}>
                  First day
                </label>
                <input
                  id="ev-starts"
                  type="date"
                  value={startsOn}
                  min={earliest}
                  onChange={(event) => {
                    setStartsOn(event.target.value);
                    if (endsOn === "" || endsOn < event.target.value) setEndsOn(event.target.value);
                  }}
                  style={field}
                />
              </div>
              <div>
                <label htmlFor="ev-ends" style={label}>
                  Last day
                </label>
                <input
                  id="ev-ends"
                  type="date"
                  value={endsOn}
                  min={startsOn === "" ? earliest : startsOn}
                  onChange={(event) => setEndsOn(event.target.value)}
                  style={field}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label htmlFor="ev-tz" style={label}>
                  Timezone
                </label>
                <select
                  id="ev-tz"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  style={field}
                >
                  {ZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ev-loc" style={label}>
                  Where{optional}
                </label>
                <input
                  id="ev-loc"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="Moscone West, San Francisco"
                  style={field}
                />
              </div>
            </div>

            <div>
              <label htmlFor="ev-desc" style={label}>
                One line for the public page{optional}
              </label>
              <input
                id="ev-desc"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Three days on how software actually ships."
                style={field}
              />
            </div>

            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <button
                disabled={create.isPending}
                onClick={() => {
                  const wrong = firstProblem();
                  if (wrong !== null) {
                    setProblem(wrong);
                    return;
                  }
                  setProblem("");
                  create.mutate();
                }}
                style={{
                  height: 48,
                  padding: "0 26px",
                  borderRadius: 999,
                  border: "none",
                  background: "var(--bt)",
                  color: "var(--bf)",
                  font: "600 15px var(--font-plex-sans)",
                  cursor: "pointer",
                }}
              >
                {create.isPending ? "Creating…" : "Create the event"}
              </button>
              {!isFirst && (
                <button
                  onClick={() => router.push("/admin")}
                  style={{
                    height: 48,
                    padding: "0 18px",
                    borderRadius: 999,
                    border: "none",
                    background: "none",
                    color: "var(--i3)",
                    font: "500 14px var(--font-plex-sans)",
                  }}
                >
                  Cancel
                </button>
              )}
            </div>

            {problem !== "" && (
              <p
                role="alert"
                style={{ font: "400 13px var(--font-plex-sans)", color: "var(--cn)", margin: 0 }}
              >
                {problem}
              </p>
            )}
          </div>

          {/* ---- what the public will see ---- */}
          <div style={{ display: "grid", gap: 14, position: "sticky", top: 40 }}>
            <p
              style={{
                font: "600 10px var(--font-plex-sans)",
                letterSpacing: "0.12em",
                color: "var(--i4)",
                margin: 0,
              }}
            >
              THE PUBLIC PAGE
            </p>
            <div
              style={{
                borderRadius: 16,
                border: "1px solid var(--ln)",
                background: "var(--cd)",
                overflow: "hidden",
                boxShadow: "0 12px 40px rgba(13,16,32,.10)",
              }}
            >
              <div
                style={{
                  padding: "26px 24px",
                  background:
                    "linear-gradient(135deg, var(--sw) 0%, var(--cd) 70%)",
                  borderBottom: "1px solid var(--ln)",
                }}
              >
                <h2
                  style={{
                    font: "700 26px/1.15 var(--font-bricolage), sans-serif",
                    letterSpacing: "-0.02em",
                    color: name === "" ? "var(--i4)" : "var(--ik)",
                    margin: "0 0 8px",
                  }}
                >
                  {name === "" ? "Your event" : name}
                </h2>
                <p
                  className="tabular"
                  style={{
                    font: "400 13px var(--font-plex-mono), monospace",
                    color: "var(--i3)",
                    margin: 0,
                  }}
                >
                  {start === null
                    ? "Dates to come"
                    : days === 1
                      ? LONG.format(start)
                      : `${DAY.format(start)} – ${end === null ? "" : DAY.format(end)}`}
                  {location.trim() === "" ? "" : ` · ${location.trim()}`}
                </p>
                {description.trim() !== "" && (
                  <p
                    style={{
                      font: "400 14px/1.55 var(--font-plex-sans)",
                      color: "var(--i2)",
                      margin: "12px 0 0",
                    }}
                  >
                    {description.trim()}
                  </p>
                )}
              </div>
              <div style={{ padding: "16px 24px", display: "grid", gap: 10 }}>
                {[
                  ["Days", days === null ? "—" : `${days}`],
                  ["Timezone", timezone.replace(/_/g, " ")],
                  ["Status", "Draft, not public yet"],
                ].map(([key, value]) => (
                  <div key={key} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                    <span
                      style={{
                        font: "400 12px var(--font-plex-sans)",
                        color: "var(--i4)",
                        width: 78,
                        flex: "none",
                      }}
                    >
                      {key}
                    </span>
                    <span
                      style={{ font: "500 13px var(--font-plex-sans)", color: "var(--i2)" }}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <p
              style={{
                font: "400 12.5px/1.6 var(--font-plex-sans)",
                color: "var(--i4)",
                margin: 0,
              }}
            >
              Nothing is public until you publish. Times are stored in UTC and shown in the
              event&rsquo;s zone, so a speaker in another country sees their own clock.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
