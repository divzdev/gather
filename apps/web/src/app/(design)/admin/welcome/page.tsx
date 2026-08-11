"use client";

/** First run: name the event and say when it is.
 *
 *  Registering used to invent an event, named after whatever was typed in the
 *  "Event or organization" box and dated ninety days out. A new owner's first
 *  screen therefore described a conference they had never agreed to, and there
 *  was no way to create a real one — the API had no POST at all.
 *
 *  Choosing the name and the dates is the first real decision of running an
 *  event, so it is asked once, here, rather than assumed.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { card, pill } from "@/components/ui";
import { authed, setEventId } from "@/lib/session";

type Event = { id: string; name: string };

/** The zones an organiser is most likely to need, then the rest by name. */
const ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function isoDay(offsetDays: number): string {
  const day = new Date();
  day.setDate(day.getDate() + offsetDays);
  return day.toISOString().slice(0, 10);
}

export default function WelcomePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [location, setLocation] = useState("");
  const [problem, setProblem] = useState("");

  // Someone who already has an event does not need to be asked again.
  const { data: events } = useQuery({
    queryKey: ["my-events"],
    queryFn: () => authed<Event[]>("/events"),
  });

  const create = useMutation({
    mutationFn: () =>
      authed<Event>("/events", {
        method: "POST",
        body: {
          name: name.trim(),
          starts_on: startsOn,
          ends_on: endsOn,
          timezone,
          location: location.trim() === "" ? null : location.trim(),
        },
      }),
    onSuccess: async (event) => {
      setEventId(event.id);
      // The console guard reads the same list to decide whether to send someone
      // here. Without this it is still holding the empty answer and bounces
      // straight back to onboarding.
      await queryClient.invalidateQueries({ queryKey: ["my-events"] });
      router.push("/admin");
    },
    onError: (error: Error) => setProblem(error.message),
  });

  const firstProblem = (): string | null => {
    if (name.trim() === "") return "Give the event a name.";
    if (startsOn === "" || endsOn === "") return "Say when it starts and ends.";
    if (endsOn < startsOn) return "The event cannot end before it starts.";
    return null;
  };

  const input: React.CSSProperties = {
    height: 40,
    padding: "0 12px",
    borderRadius: 8,
    border: "1px solid var(--ls)",
    background: "var(--cd)",
    color: "var(--ik)",
    font: "400 14px var(--font-plex-sans)",
    width: "100%",
    boxSizing: "border-box",
  };
  const label: React.CSSProperties = {
    font: "500 12.5px var(--font-plex-sans)",
    color: "var(--i2)",
    marginBottom: 6,
    display: "block",
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--pp)", padding: "56px 20px" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <h1
          style={{
            font: "700 30px var(--font-bricolage), sans-serif",
            letterSpacing: "-0.02em",
            color: "var(--ik)",
            margin: "0 0 8px",
          }}
        >
          What are you running?
        </h1>
        <p style={{ font: "400 14.5px/1.6 var(--font-plex-sans)", color: "var(--i3)", margin: "0 0 26px" }}>
          {events !== undefined && events.length > 0
            ? "You already have an event. This makes another one."
            : "One event to start. You can change any of this later in Settings."}
        </p>

        <div style={{ ...card, padding: 22, display: "grid", gap: 16 }}>
          <div>
            <label htmlFor="ev-name" style={label}>
              Event name
            </label>
            <input
              id="ev-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="DevFlow Conf 2027"
              style={input}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label htmlFor="ev-starts" style={label}>
                Starts
              </label>
              <input
                id="ev-starts"
                type="date"
                value={startsOn}
                onChange={(event) => {
                  setStartsOn(event.target.value);
                  // Most events are a few days; save them typing the second date.
                  if (endsOn === "" || endsOn < event.target.value) setEndsOn(event.target.value);
                }}
                style={input}
              />
            </div>
            <div>
              <label htmlFor="ev-ends" style={label}>
                Ends
              </label>
              <input
                id="ev-ends"
                type="date"
                value={endsOn}
                min={startsOn}
                onChange={(event) => setEndsOn(event.target.value)}
                style={input}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label htmlFor="ev-tz" style={label}>
                Timezone
              </label>
              <select
                id="ev-tz"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                style={input}
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
                Location <span style={{ color: "var(--i4)" }}>optional</span>
              </label>
              <input
                id="ev-loc"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Moscone West, San Francisco"
                style={input}
              />
            </div>
          </div>

          <p style={{ font: "400 12.5px/1.5 var(--font-plex-sans)", color: "var(--i4)", margin: 0 }}>
            Times are stored in UTC and shown in the event&rsquo;s zone, so a speaker in another
            country sees their own clock.
          </p>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              style={pill}
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
            >
              {create.isPending ? "Creating…" : "Create the event"}
            </button>
            <button
              onClick={() => {
                setName("Untitled event");
                setStartsOn(isoDay(90));
                setEndsOn(isoDay(92));
              }}
              style={{
                background: "none",
                border: "none",
                font: "500 12.5px var(--font-plex-sans)",
                color: "var(--i3)",
                textDecoration: "underline",
              }}
            >
              I don&rsquo;t know yet
            </button>
          </div>

          {problem !== "" && (
            <p role="alert" style={{ font: "400 12.5px var(--font-plex-sans)", color: "var(--cn)", margin: 0 }}>
              {problem}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
