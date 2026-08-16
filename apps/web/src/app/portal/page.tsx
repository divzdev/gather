"use client";

/** The speaker's whole world: what they owe, when they are on, and who they are
 *  in the programme. One payload feeds the home tab, because this is opened on a
 *  phone between other things. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";

import { Portal, type PortalData } from "@/components/design/Portal";

import { ConferenceSwitcher } from "./conferences";
import { ParticipationBand, type Participation as ParticipationState } from "./participation";
import { PortalComments, useFeedbackCount } from "./comments";
import { SpeakerIdentity, SpeakerPortrait } from "./hero";
import { TaskFilePreview } from "./thumb";
import { useTheme } from "@/components/ThemeProvider";
import { API_BASE_URL, ApiError } from "@/lib/api";
import { getSpeakerToken, getToken, portal, portalBlobUrl, portalDownload } from "@/lib/session";
import type { ThemeMode } from "@/lib/theme";

type PortalFile = {
  id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  version: number;
  uploaded_at: string;
};

type Task = {
  id: string;
  name: string;
  description: string | null;
  kind: "upload" | "form" | "acknowledge" | "external_link";
  is_required: boolean;
  external_url: string | null;
  requires_review: boolean;
  accepted_file_types: Record<string, unknown>;
  max_file_mb: number | null;
  due_at: string | null;
  status: string;
  form_response: Record<string, unknown> | null;
  files: PortalFile[];
};

type Home = {
  event: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    starts_on: string;
    ends_on: string;
    location: string | null;
    cfp_closes_at: string | null;
  };
  speaker: {
    id: string;
    name: string;
    email: string;
    pronouns: string | null;
    company: string | null;
    job_title: string | null;
    bio: string | null;
    links: Record<string, string>;
    headshot_file_id: string | null;
  };
  sessions: {
    id: string;
    slug: string;
    title: string;
    abstract: string | null;
    starts_at: string | null;
    duration_minutes: number;
    room: string | null;
  }[];
  tasks: Task[];
  progress: { total: number; complete: number; outstanding: number; overdue: number };
  participation: ParticipationState;
};

type Submission = {
  id: string;
  code: string;
  title: string;
  status: string;
  submitted_at: string | null;
};

type Tab = "home" | "subs" | "profile" | "resources" | "feedback";

/** A resource page as the portal receives it. The HTML in an `embed` block was
 *  sanitised server-side on write against an allowlist, which is the only
 *  reason it can be rendered here at all. */
type PortalPage = {
  id: string;
  title: string;
  slug: string;
  blocks: ({ type: "text"; text: string } | { type: "embed"; html: string })[];
  is_pinned_in_portal: boolean;
};

/** The profile form, held locally so typing never round-trips. */
type Draft = {
  name: string;
  pro: string;
  title: string;
  co: string;
  bio: string;
  web: string;
  li: string;
};

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short" });
const BIO_TARGET = 600;

/** The speaker token is read through an external store rather than a
 *  `typeof window` branch, matching RequireStaff. The branch made the server
 *  render the signed-out screen and the client render the portal, which is a
 *  hydration mismatch: React discarded the whole tree and rebuilt it on every
 *  load, so the speaker saw a flash of "this portal needs your sign-in link"
 *  before their own page appeared. */
function subscribeToSpeakerSession(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

const SUBMISSION_LOOK: Record<string, { label: string; fg: string; bg: string; bar: string }> = {
  draft: {
    label: "Draft",
    fg: "var(--i3,#6B7B84)",
    bg: "var(--sk,#EDF1F2)",
    bar: "var(--ls,#C8D2D5)",
  },
  submitted: {
    label: "Submitted",
    fg: "var(--if,#47599F)",
    bg: "var(--ifw,#E9ECF7)",
    bar: "var(--if,#47599F)",
  },
  in_review: {
    label: "In review",
    fg: "var(--pd,#B96A1F)",
    bg: "var(--pdw,#F9EDDF)",
    bar: "var(--pd,#B96A1F)",
  },
  accepted: {
    label: "Accepted",
    fg: "var(--ok,#0E7A5F)",
    bg: "var(--okw,#E2F1EC)",
    bar: "var(--ok,#0E7A5F)",
  },
  waitlisted: {
    label: "Waitlisted",
    fg: "var(--pd,#B96A1F)",
    bg: "var(--pdw,#F9EDDF)",
    bar: "var(--pd,#B96A1F)",
  },
  rejected: {
    label: "Not this time",
    fg: "var(--i3,#6B7B84)",
    bg: "var(--sk,#EDF1F2)",
    bar: "var(--ls,#C8D2D5)",
  },
  withdrawn: {
    label: "Withdrawn",
    fg: "var(--i3,#6B7B84)",
    bg: "var(--sk,#EDF1F2)",
    bar: "var(--ls,#C8D2D5)",
  },
};

/** Is a delivered task still the speaker's to change?
 *
 *  A delivered task had no way back at all: once it left "Waiting on you" the
 *  row was a line of text, so somebody who uploaded the wrong photograph could
 *  see that it was wrong and do nothing about it.
 *
 *  Acceptance is the thing that locks it, not delivery. `submitted` is sitting
 *  in front of an organiser who has not acted yet, so it is still theirs.
 *  `complete` on a task with no review was never approved by anyone — nobody
 *  looked, so there is no decision to invalidate. Only an accepted deliverable
 *  freezes, because the acceptance was of that exact file.
 */
function changeable(task: Task): boolean {
  if (task.kind === "acknowledge" || task.kind === "external_link") return false;
  if (task.status === "submitted") return true;
  return task.status === "complete" && !task.requires_review;
}

const CTA: Record<Task["kind"], string> = {
  upload: "Upload",
  form: "Fill in",
  acknowledge: "Confirm",
  external_link: "Open",
};

/** Google and Outlook take the whole event in a URL, so these are links rather
 *  than files. The brief names all three targets; only iCal is ever a download. */
function calendarLink(
  which: "google" | "outlook",
  talk: {
    title: string;
    starts_at: string | null;
    duration_minutes: number;
    room: string | null;
  } | null,
  eventName: string,
): string | null {
  if (talk === null || talk.starts_at === null) return null;
  const starts = new Date(talk.starts_at);
  const ends = new Date(starts.getTime() + talk.duration_minutes * 60_000);
  const stamp = (at: Date) => at.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const title = encodeURIComponent(talk.title);
  const where = encodeURIComponent([talk.room, eventName].filter(Boolean).join(" · "));

  return which === "google"
    ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}` +
        `&dates=${stamp(starts)}/${stamp(ends)}&location=${where}`
    : `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose` +
        `&subject=${title}&startdt=${starts.toISOString()}&enddt=${ends.toISOString()}&location=${where}`;
}

/** The CFP deadline, every part of it read in the conference's timezone.
 *
 *  Not a detail: this event closes at 23:59 on 30 April in San Francisco, which
 *  is 06:59 on 1 May in UTC. Formatting any part of it in UTC — as the rest of
 *  this file does for due dates, which carry no time of day — puts the wrong
 *  month on the chip and tells a speaker their deadline is a day later than it
 *  is. `en-US` rather than `en-GB` only because it names the zone "PDT" instead
 *  of "GMT-7".
 */
function cfpClose(event: { cfp_closes_at: string | null; timezone: string }): {
  mon: string;
  day: string;
  n: string;
  sub: string;
  bt: string;
  cb: string;
  cbd: string;
  cf: string;
} {
  const at = new Date(event.cfp_closes_at ?? "");
  const inZone = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { ...options, timeZone: event.timezone }).format(at);
  return {
    mon: inZone({ month: "short" }).toUpperCase(),
    day: inZone({ day: "numeric" }),
    n: "CFP closes",
    sub: `edits lock at ${inZone({
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    })}`,
    bt: "none",
    cb: "var(--sw,#FFEAE6)",
    cbd: "var(--sl,#FFC9C0)",
    cf: "var(--sg,#E04E4E)",
  };
}

/** The single Key dates row shown when nothing is outstanding: the speaker's own
 *  slot if they have one, and otherwise an honest note that no date is set. */
function restingKeyDate(talk: { starts_at: string | null; room: string | null } | null): {
  mon: string;
  day: string;
  n: string;
  sub: string;
  bt: string;
  cb: string;
  cbd: string;
  cf: string;
} {
  const calm = {
    bt: "none",
    cb: "var(--pp,#F4F6F7)",
    cbd: "var(--ln,#E1E7E9)",
    cf: "var(--ik,#16232B)",
  };
  if (talk === null || talk.starts_at === null) {
    return {
      mon: "TBC",
      day: "—",
      n: "Nothing due",
      sub: "we email you when a date is set",
      ...calm,
    };
  }
  const when = new Date(talk.starts_at);
  return {
    mon: MONTH.format(when).toUpperCase(),
    day: String(when.getUTCDate()),
    n: "You are on stage",
    sub: talk.room ?? "room to come",
    ...calm,
  };
}

/** "12–14 Oct · Fort Mason, SF" from whatever this event actually is. */
function eventWhen(event: { starts_on: string; ends_on: string; location: string | null }): string {
  const from = new Date(`${event.starts_on}T00:00:00Z`);
  const to = new Date(`${event.ends_on}T00:00:00Z`);
  const day = (at: Date) => at.getUTCDate();
  const month = (at: Date) => MONTH.format(at).toUpperCase();
  const span =
    month(from) === month(to)
      ? `${day(from)}–${day(to)} ${month(to)}`
      : `${day(from)} ${month(from)} – ${day(to)} ${month(to)}`;
  return event.location === null ? span : `${span} · ${event.location.toUpperCase()}`;
}

/** The date the earliest outstanding task is due — the honest version of the
 *  prototype's fixed "ALL EDITABLE UNTIL 5 OCT". */
function openDeadline(open: Task[]): string {
  const due = open
    .map((task) => task.due_at)
    .filter((at): at is string => at !== null)
    .sort();
  const first = due[0];
  return first === undefined
    ? "NO DEADLINES SET"
    : `FIRST DUE ${DAY.format(new Date(first)).toUpperCase()}`;
}

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** The full-screen shell for both ways this portal has nothing to show: no
 *  session, and no answer from the server. Shared so the two messages stay
 *  visually identical apart from the words and the one has a retry. */
function PortalMessage({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100vh",
        padding: 24,
        font: "400 14px 'IBM Plex Sans',sans-serif",
        color: "var(--i2,#3E4E58)",
        textAlign: "center",
      }}
    >
      <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>{children}</div>
    </main>
  );
}

export default function PortalPage() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const upload = useRef<HTMLInputElement>(null);
  const headshot = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);

  const [tab, setTab] = useState<Tab>("home");
  const [calOpen, setCalOpen] = useState(false);
  const [localTz, setLocalTz] = useState(false);
  const [notices, setNotices] = useState<{ id: string; msg: string }[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  const say = (msg: string) => {
    const id = crypto.randomUUID();
    setNotices((current) => [...current.slice(-2), { id, msg }]);
    window.setTimeout(() => setNotices((c) => c.filter((n) => n.id !== id)), 6000);
  };

  const signedIn = useSyncExternalStore(
    subscribeToSpeakerSession,
    () => getSpeakerToken() !== null,
    () => false,
  );

  // The clock is read once per fetch, not per render: "2d overdue" must not
  // change because something else re-rendered.
  const {
    data,
    error,
    refetch: retryHome,
    isFetching: retryingHome,
  } = useQuery({
    queryKey: ["portal-home"],
    enabled: signedIn,
    queryFn: async () => ({ home: await portal<Home>("/home"), now: Date.now() }),
  });
  const { data: submissions } = useQuery({
    queryKey: ["portal-submissions"],
    enabled: signedIn,
    queryFn: () => portal<Submission[]>("/submissions"),
  });
  const { data: pages } = useQuery({
    queryKey: ["portal-pages"],
    enabled: signedIn,
    queryFn: () => portal<PortalPage[]>("/pages"),
  });
  const feedbackCount = useFeedbackCount(signedIn);

  const home = data?.home;
  const now = data?.now ?? 0;

  // The headshot is read through the speaker's own token: no public route will
  // serve it until the programme is published, and the window before that is
  // exactly when the speaker wants to see whether the photo they just uploaded
  // is the one they want on the programme.
  const shotId = home?.speaker.headshot_file_id ?? null;
  const { data: shotUrl } = useQuery({
    queryKey: ["portal-headshot", shotId],
    enabled: shotId !== null,
    staleTime: Infinity,
    queryFn: async () => {
      if (shotId === null) throw new Error("No headshot to load.");
      return portalBlobUrl(`/files/${shotId}`);
    },
  });

  const saveProfile = useMutation({
    mutationFn: (fields: Draft) =>
      portal("/profile", {
        method: "PATCH",
        body: {
          name: fields.name,
          pronouns: fields.pro,
          job_title: fields.title,
          company: fields.co,
          bio: fields.bio,
          links: { website: fields.web, linkedin: fields.li },
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portal-home"] });
      say("Profile saved. The organisers see this straight away.");
    },
    onError: (problem: Error) => say(problem.message),
  });

  const sendFile = useMutation({
    mutationFn: async ({ path, file }: { path: string; file: File }) => {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`${API_BASE_URL}/portal${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getSpeakerToken() ?? ""}` },
        body,
      });
      if (!response.ok) {
        const problem = (await response.json().catch(() => undefined)) as
          { error?: { message?: string } } | undefined;
        throw new Error(problem?.error?.message ?? "That upload was refused.");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portal-home"] });
      void queryClient.invalidateQueries({ queryKey: ["portal-file-comments"] });
      // Names the Feedback tab at the one moment it is relevant. Someone who
      // has just uploaded is the person most likely to want to say something
      // about the file, and a tab nobody opens is a feature nobody has.
      say("Uploaded. Every version is kept — add a note about it under Feedback.");
    },
    onError: (problem: Error) => say(problem.message),
  });

  const acknowledge = useMutation({
    mutationFn: (taskId: string) =>
      portal(`/tasks/${taskId}`, { method: "PUT", body: { acknowledged: true } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portal-home"] });
      say("Noted, thank you.");
    },
    onError: (problem: Error) => say(problem.message),
  });

  // No token, or the token the API actually rejected (401/403): the fix is a
  // fresh magic link, not a retry. Anything else — a 500, a dropped
  // connection — is the server's fault, not the speaker's, and a retry can
  // genuinely fix it; telling them to go re-request a link would not.
  const needsSignIn =
    !signedIn || (error instanceof ApiError && (error.status === 401 || error.status === 403));

  if (needsSignIn) {
    // An organiser who clicked "Speaker portal" in the console rail lands here
    // holding a staff token but no speaker session — a dead end unless the
    // page says how previewing actually works.
    const isStaff = typeof window !== "undefined" && getToken() !== null;
    return (
      <PortalMessage>
        <strong style={{ font: "600 18px 'IBM Plex Sans',sans-serif" }}>
          This portal needs your sign-in link
        </strong>
        <span>
          Speakers never have a password. Ask for a fresh link and open it on this device.
        </span>
        <a href="/login" style={{ color: "var(--sg,#E04E4E)" }}>
          Send me a link
        </a>
        {isStaff ? (
          <span
            style={{
              font: "400 12.5px/1.6 'IBM Plex Sans',sans-serif",
              color: "var(--i3,#6B7B84)",
            }}
          >
            You are signed in as staff, and staff have no portal of their own. To see what a speaker
            sees, open anyone on the{" "}
            <a href="/admin/speakers" style={{ color: "var(--sg,#E04E4E)" }}>
              Speakers screen
            </a>{" "}
            and use “Open portal as speaker”.
          </span>
        ) : null}
      </PortalMessage>
    );
  }

  if (error) {
    return (
      <PortalMessage>
        <strong style={{ font: "600 18px 'IBM Plex Sans',sans-serif" }}>
          We could not reach your portal
        </strong>
        <span>The server did not answer. Nothing has been lost — try again in a moment.</span>
        <button
          type="button"
          onClick={() => void retryHome()}
          disabled={retryingHome}
          style={{
            justifySelf: "center",
            height: 44,
            padding: "0 24px",
            borderRadius: 999,
            border: "none",
            background: "var(--bt,#FF6B6B)",
            color: "var(--bf,#331313)",
            font: "600 14px 'IBM Plex Sans',sans-serif",
            cursor: retryingHome ? "wait" : "pointer",
          }}
        >
          {retryingHome ? "Trying again…" : "Try again"}
        </button>
      </PortalMessage>
    );
  }

  const tasks = home?.tasks ?? [];
  const open = tasks.filter((task) => task.status !== "complete");
  const done = tasks.filter((task) => task.status === "complete");
  // A speaker with two accepted talks saw one. The card shows the next one by
  // start time, and says how many others there are rather than hiding them.
  const sessions = [...(home?.sessions ?? [])].sort((a, b) =>
    (a.starts_at ?? "").localeCompare(b.starts_at ?? ""),
  );
  const talk = sessions[0] ?? null;
  // Server values until the speaker touches something, their edit after that.
  // Seeding state from the query would need an effect, and an effect that writes
  // state on arrival re-renders the whole screen for nothing.
  const fields: Draft = draft ?? {
    name: home?.speaker.name ?? "",
    pro: home?.speaker.pronouns ?? "",
    title: home?.speaker.job_title ?? "",
    co: home?.speaker.company ?? "",
    bio: home?.speaker.bio ?? "",
    web: home?.speaker.links.website ?? "",
    li: home?.speaker.links.linkedin ?? "",
  };

  /** What a task's own button does. Every kind is named; nothing falls through.
   *
   *  It used to: `acknowledge` and `external_link` returned early and everything
   *  else reached the file input — which caught `form` too. So a task labelled
   *  "Fill in" opened a file chooser and asked a speaker to pick a file for
   *  "which OS will you present from?". They could not answer it, and it was
   *  required, so the organiser chased something the portal made impossible.
   *
   *  A `switch` over the union rather than a chain of guards, so adding a kind
   *  is a compile error here instead of a silent trip to the file picker.
   */
  const startTask = (task: Task) => {
    switch (task.kind) {
      case "acknowledge":
        acknowledge.mutate(task.id);
        return;
      case "external_link":
        if (task.external_url !== null) window.open(task.external_url, "_blank", "noopener");
        return;
      case "form":
        // `typedRoutes` checks this against `.next/types/routes.d.ts`, which is
        // a build artifact and is stale in this tree — it predates the route.
        // The cast goes away the next time the dev server or a build rewrites
        // the map; it is not papering over a route that does not exist.
        router.push(`/portal/tasks/${task.id}` as Route);
        return;
      case "upload":
        target.current = task.id;
        upload.current?.click();
        return;
    }
  };

  const dueOf = (task: Task): { text: string; fg: string } => {
    if (task.status === "complete") return { text: "Done", fg: "var(--ok,#0E7A5F)" };
    if (task.status === "submitted") return { text: "With the team", fg: "var(--if,#47599F)" };
    if (task.due_at === null) return { text: "No deadline", fg: "var(--i4,#99A6AD)" };
    const days = Math.round((new Date(task.due_at).getTime() - now) / 86_400_000);
    if (task.status === "overdue") {
      return { text: `${Math.abs(days)}d overdue`, fg: "var(--cn,#D8432B)" };
    }
    return { text: `due ${DAY.format(new Date(task.due_at))}`, fg: "var(--i4,#99A6AD)" };
  };

  const step = (index: number, reached: boolean, name: string, note: string, last: boolean) => ({
    fx: last ? "0 0 auto" : "1",
    g: reached ? "✓" : String(index),
    db: reached ? "var(--ok,#177A53)" : "var(--cd,#FFFFFF)",
    bd: reached ? "var(--ok,#177A53)" : "var(--ls,#C9C9CF)",
    dc: reached ? "var(--bf,#FFFFFF)" : "var(--i4,#99A6AD)",
    ln: last ? "none" : "block",
    lc: reached ? "var(--okl,#C3E3D3)" : "var(--ln,#E3E3E7)",
    tf: reached ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
    n: name,
    d: note,
  });

  const progress = home?.progress ?? { total: 0, complete: 0, outstanding: 0, overdue: 0 };
  const eventStart = home === undefined ? null : new Date(`${home.event.starts_on}T00:00:00Z`);

  const screen: PortalData = {
    youName: home?.speaker.name ?? "",
    /* Both contact blocks rendered `youName` and `youInitials` — so the card
     * headed "Your organiser" showed the speaker their own name and their own
     * avatar. The portal has no organiser identity to show, and inventing one
     * would be the same defect again, so it names the event. */
    contactName: home?.event.name ?? "The organisers",
    contactInitials: (home?.event.name ?? "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join(""),
    youInitials: (home?.speaker.name ?? "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase(),
    tabs: (
      [
        { key: "home", n: "Home", c: open.length },
        { key: "subs", n: "My submissions", c: submissions?.length ?? 0 },
        { key: "resources", n: "Resources", c: pages?.length ?? 0 },
        { key: "feedback", n: "Feedback", c: feedbackCount },
        { key: "profile", n: "Profile", c: 0 },
      ] as const
    ).map((entry) => ({
      n: entry.n,
      c: entry.c,
      badge: entry.c > 0 ? "inline-flex" : "none",
      bg: tab === entry.key ? "var(--cd,#FFFFFF)" : "transparent",
      fg: tab === entry.key ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
      wt: tab === entry.key ? "600" : "400",
      sh: tab === entry.key ? "0 1px 2px rgba(13,16,32,.12)" : "none",
      on: () => setTab(entry.key),
    })),
    themeSeg: (["light", "system", "dark"] as ThemeMode[]).map((mode) => ({
      g: mode === "light" ? "○" : mode === "system" ? "◐" : "●",
      tt: `Theme: ${mode}`,
      bg: theme.mode === mode ? "var(--cd,#FFFFFF)" : "transparent",
      sh: theme.mode === mode ? "0 1px 2px rgba(13,16,32,.12)" : "none",
      on: () => theme.setMode(mode),
    })),
    tzLabel: localTz
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : (home?.event.timezone ?? "UTC"),
    togTz: () => setLocalTz((current) => !current),

    tHome: tab === "home",
    tSubs: tab === "subs",
    tProfile: tab === "profile",

    heroEyebrow: talk === null ? "YOU ARE ON THE PROGRAMME" : "YOU ARE ON THE PROGRAMME",
    /* The speaker's own face, at a size you can judge a photograph at. It was
     * nowhere on this screen: initials in the corner, and the actual file only
     * ever named in a checklist row. */
    heroPortrait: home === undefined ? null : <SpeakerPortrait speaker={home.speaker} />,
    heroIdentity:
      home === undefined ? null : (
        <SpeakerIdentity speaker={home.speaker} onEdit={() => setTab("profile")} />
      ),
    /* Was "Good evening, ." on every first paint — the greeting rendered before
     * the name arrived, with the comma and full stop already in place. */
    greet: (() => {
      const hello = greeting(new Date(now).getHours());
      const first = (home?.speaker.name ?? "").trim().split(" ")[0] ?? "";
      return first === "" ? `${hello}.` : `${hello}, ${first}.`;
    })(),
    heroSub:
      progress.total === 0
        ? "Nothing is assigned to you yet. We will email you the moment there is."
        : `${progress.complete} of ${progress.total} done` +
          (progress.overdue > 0
            ? `, ${progress.overdue} past its date. The overdue ones are at the top.`
            : progress.outstanding > 0
              ? `. The rest are below, newest deadline first.`
              : ". Nothing is waiting on you."),

    steps: [
      step(1, true, "Accepted", "you are in", false),
      step(2, (home?.speaker.bio ?? "") !== "", "Profile", "bio and links", false),
      step(3, progress.complete > 0, "Assets", "slides and headshot", false),
      step(4, progress.outstanding === 0 && progress.total > 0, "Ready", "everything in", false),
      step(5, false, "On stage", talk?.room ?? "room to come", true),
    ],

    openN: open.length,
    homeBadge: open.length > 0 ? "inline-flex" : "none",
    noneOpen: open.length === 0,
    tasks: open.map((task) => {
      const due = dueOf(task);
      return {
        n: task.name,
        sub:
          task.files[0] !== undefined ? (
            <TaskFilePreview file={task.files[0]} />
          ) : (
            (task.description ?? (task.is_required ? "Required" : "Optional"))
          ),
        due: due.text,
        dueFg: due.fg,
        bar: task.status === "overdue" ? "var(--cn,#B3243F)" : "var(--pd,#92590A)",
        cta: task.files.length > 0 ? "Replace" : CTA[task.kind],
        onGo: () => startTask(task),
      };
    }),
    doneN: done.length,
    totalN: progress.total,
    doneTasks: done.map((task) => ({
      n: task.name,
      // A finished task is where the speaker checks what the organiser is
      // holding, so the picture belongs here too — this row is the whole reason
      // "Headshot · statusline-combined.png" was possible to miss.
      at: task.files[0] !== undefined ? <TaskFilePreview file={task.files[0]} /> : "done",
      /* A delivered task had no way back. Once it left "Waiting on you" the row
       * became a line of text, so a speaker who uploaded the wrong photograph
       * could see it was wrong and do nothing about it.
       *
       * Editable until somebody accepts it. `submitted` is still the speaker's
       * — it is sitting in front of an organiser who has not acted. `complete`
       * on a task that needs no review was never approved by anyone, so it stays
       * the speaker's too. Only an accepted deliverable locks, because that
       * acceptance was of *this* file. */
      act: changeable(task) ? (
        <button
          onClick={() => startTask(task)}
          style={{
            height: 30,
            padding: "0 12px",
            borderRadius: 999,
            border: "1px solid var(--ls,#C8D2D5)",
            background: "var(--cd,#FFFFFF)",
            font: "500 11.5px var(--font-plex-sans)",
            color: "var(--ik,#16232B)",
            whiteSpace: "nowrap",
          }}
        >
          {task.kind === "form" ? "Change" : "Replace"}
        </button>
      ) : null,
    })),

    guide: () => say("The speaker guide arrives with your confirmation email."),
    /* Was `mailto:?subject=…` — no recipient, so it opened an empty compose
     * window addressed to nobody, under a heading offering to message the
     * organiser. The portal has no organiser address to give, so it says that
     * instead of pretending. */
    msgTeam: () =>
      say(
        "Reply to any email you have had from " +
          `${home?.event.name ?? "the event"} — it reaches the organisers directly.`,
      ),

    // The prototype hardcoded all six of these. A speaker was shown "AI Engineer
    // 2026", "Opening keynote" and a 5 October deadline whichever conference,
    // talk and dates were actually theirs.
    evName: home?.event.name ?? "",
    evWhen: home === undefined ? "" : eventWhen(home.event),
    sessTitle: talk?.title ?? "No session yet",
    // The room rides with the time in `sessTime`. Naming it here as well printed
    // "Main Stage" twice on consecutive lines, so it stays only for the case
    // sessTime cannot cover: a room assigned before a time is.
    sessMeta:
      talk === null
        ? "It will appear here once the organisers schedule you."
        : talk.starts_at === null && talk.room !== null
          ? `${talk.duration_minutes} min · ${talk.room}`
          : `${talk.duration_minutes} min`,
    editUntil: openDeadline(open),
    contactRole: "Your organiser · replies within a day",

    sessTime:
      talk === null
        ? "Your session time is not set yet."
        : talk.starts_at === null
          ? // The title is the card's heading two lines up; repeating it here
            // read as a glitch. What this line owes the speaker is the when.
            "Time to be confirmed — we email you the moment it is set."
          : `${DAY.format(new Date(talk.starts_at))} · ${new Date(
              talk.starts_at,
            ).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: localTz ? undefined : (home?.event.timezone ?? "UTC"),
            })} · ${talk.room ?? "room to come"}`,
    togCal: () => setCalOpen((current) => !current),
    calOpen,
    dlIcs: () => {
      setCalOpen(false);
      if (home === undefined || talk === null) {
        say("Your session time is not set yet.");
        return;
      }
      // The speaker's own route, not the public one: between acceptance and
      // publication there is no public schedule to read the time from. Fetched
      // rather than opened — the route wants the speaker's bearer token, which
      // a top-level navigation cannot carry.
      void portalDownload(`/sessions/${talk.id}.ics`, `${talk.slug}.ics`).catch((error: unknown) =>
        say(error instanceof Error ? error.message : "That calendar file could not be built."),
      );
    },
    calG: () => {
      setCalOpen(false);
      const link = calendarLink("google", talk, home?.event.name ?? "");
      if (link === null) say("Your session time is not set yet.");
      else window.open(link, "_blank", "noopener");
    },
    calO: () => {
      setCalOpen(false);
      const link = calendarLink("outlook", talk, home?.event.name ?? "");
      if (link === null) say("Your session time is not set yet.");
      else window.open(link, "_blank", "noopener");
    },

    // A card whose only content is its own heading is not an empty state, and a
    // speaker who has finished every task — the state we most want them to reach
    // — was the one who got it. With nothing outstanding there is still exactly
    // one date that matters to them, so the card falls back to it.
    keyDates:
      open.length > 0
        ? open.slice(0, 4).map((task, index) => {
            const when = task.due_at === null ? eventStart : new Date(task.due_at);
            const late = task.status === "overdue";
            return {
              mon: when === null ? "TBC" : MONTH.format(when).toUpperCase(),
              day: when === null ? "—" : String(when.getUTCDate()),
              n: task.name,
              sub: task.is_required ? "required" : "optional",
              bt: index === 0 ? "none" : "1px solid var(--sk,#EDF1F2)",
              cb: late ? "var(--sw,#FFEAE6)" : "var(--pp,#F4F6F7)",
              cbd: late ? "var(--sl,#FFC9C0)" : "var(--ln,#E1E7E9)",
              cf: late ? "var(--sg,#E04E4E)" : "var(--ik,#16232B)",
            };
          })
        : [restingKeyDate(talk)],

    subs: (submissions ?? []).map((row) => {
      const look = SUBMISSION_LOOK[row.status] ?? SUBMISSION_LOOK.submitted!;
      return {
        n: row.title,
        st: look.label,
        fg: look.fg,
        bg: look.bg,
        bar: look.bar,
        meta: `${row.code}${row.submitted_at === null ? " · not submitted yet" : ` · submitted ${DAY.format(new Date(row.submitted_at))}`}`,
        note:
          row.status === "accepted"
            ? "You are in. The checklist on the Home tab covers what happens next."
            : row.status === "rejected"
              ? "Not this time. The programme was heavily oversubscribed."
              : "We email you the moment there is news.",
        onView: () => {
          if (home !== undefined) {
            window.open(`/e/${home.event.slug}/submissions/${row.code}`, "_blank", "noopener");
          }
        },
      };
    }),
    // Only the date the schema actually holds. "Reviews wrap up" and "Decisions
    // out" were the other two rows here; nothing in the model knows when either
    // happens, so they are gone rather than guessed — a speaker planning around
    // an invented date is worse served than one told nothing.
    cfpDates: home?.event.cfp_closes_at == null ? [] : [cfpClose(home.event)],
    subCount: `${submissions?.length ?? 0} in total`,
    subLine:
      (submissions?.length ?? 0) === 0
        ? "Nothing submitted to this event yet."
        : "Your proposals and where each one stands.",
    noSubs: (submissions?.length ?? 0) === 0,

    pf: fields,
    onName: (event) => setDraft({ ...fields, name: (event.target as HTMLInputElement).value }),
    onPro: (event) => setDraft({ ...fields, pro: (event.target as HTMLInputElement).value }),
    onTitle: (event) => setDraft({ ...fields, title: (event.target as HTMLInputElement).value }),
    onCo: (event) => setDraft({ ...fields, co: (event.target as HTMLInputElement).value }),
    onBio: (event) => setDraft({ ...fields, bio: (event.target as HTMLTextAreaElement).value }),
    onWeb: (event) => setDraft({ ...fields, web: (event.target as HTMLInputElement).value }),
    onLi: (event) => setDraft({ ...fields, li: (event.target as HTMLInputElement).value }),
    bioCount: `${fields.bio.length} / ${BIO_TARGET}`,
    bioCountFg: fields.bio.length > BIO_TARGET ? "var(--cn,#D8432B)" : "var(--i4,#99A6AD)",
    pfStamp: saveProfile.isPending ? "Saving…" : "Saved as you type",
    pvName: home?.speaker.name ?? "",
    pvRole: [fields.title, fields.co].filter(Boolean).join(" · "),
    upShot: () => headshot.current?.click(),
    // The raw token is shown exactly once; the server keeps only its hash.
    // Asking again mints a new link and quietly revokes the copied one, which
    // is the entire revocation story — so the toast says so.
    copyLink: () => {
      void portal<{ token: string }>("/link", { method: "POST" })
        .then(async ({ token }) => {
          await navigator.clipboard.writeText(`${window.location.origin}/p/${token}`);
          say(
            "Link copied. It opens this portal without a sign-in — and it replaces any link you copied before.",
          );
        })
        .catch(() => say("Could not create your link. Try again."));
    },
    shotUrl: shotUrl ?? null,
    shotAction: shotId === null ? "Add photo" : "Replace photo",
    // The rules the server already enforces (files.check_upload), said out loud.
    // Stating them is not decoration: the picker below is narrowed to the same
    // list, and between them a speaker cannot pick a file that will bounce.
    shotHint: "JPG, PNG or WebP · max 8 MB",

    toasts: notices.map((notice) => ({
      msg: notice.msg,
      canUndo: false,
      onUndo: () => undefined,
      onX: () => setNotices((current) => current.filter((n) => n.id !== notice.id)),
    })),
  };

  return (
    // `data-portal` scopes portal.css, which is where this screen's responsive
    // behaviour lives — the generated prototype styles every node inline and
    // carries no media query. `data-portal-tab` is read by the same file to hide
    // the prototype's footer on the two tabs whose body is injected after it.
    <div data-portal data-portal-tab={tab}>
      {/* Above the participation band: which conference you are looking at
          outranks anything it is asking of you. */}
      <ConferenceSwitcher />
      <ParticipationBand state={home?.participation} />
      <Portal d={screen} />
      {/* Rendered here rather than through the Portal prototype, which has no
       *  Resources tab and is regenerated from the design. The tab strip is
       *  data-driven, so adding the tab costs nothing there; every one of the
       *  prototype's own tab bodies is gated on a boolean that is false while
       *  this tab is selected, so it has the screen to itself. */}
      {tab === "resources" ? <PortalResources pages={pages ?? []} /> : null}
      {tab === "feedback" ? <PortalComments /> : null}
      <input
        ref={upload}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          const taskId = target.current;
          event.target.value = "";
          if (file !== undefined && taskId !== null) {
            sendFile.mutate({ path: `/tasks/${taskId}/files`, file });
          }
        }}
      />
      <input
        ref={headshot}
        type="file"
        // Exactly what files.check_upload accepts on the other end. `image/*`
        // let a phone offer its camera roll's HEIC, which the picker took and
        // the API then refused — a failure the speaker could do nothing about
        // and which looked like the portal was broken.
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) sendFile.mutate({ path: "/profile/headshot", file });
        }}
      />
      {tab === "profile" ? (
        <div style={{ position: "fixed", right: 24, bottom: 24, zIndex: 80 }}>
          <button
            onClick={() => saveProfile.mutate(fields)}
            disabled={saveProfile.isPending}
            style={{
              height: 40,
              padding: "0 20px",
              borderRadius: 999,
              border: "none",
              background: "var(--bt,#141417)",
              color: "var(--bf,#FFFFFF)",
              font: "600 13px 'IBM Plex Sans',sans-serif",
              boxShadow: "0 10px 28px rgba(20,20,23,.22)",
            }}
          >
            {saveProfile.isPending ? "Saving…" : "Save profile"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The event's resource and wiki pages, as a speaker reads them.
 *
 *  `embed` blocks are injected as HTML because that is the feature: an
 *  organiser pastes the run-of-show table or a walkthrough video and speakers
 *  see it rendered. It is safe here only because the API sanitises that HTML on
 *  write against a strict allowlist — `features/pages/service.py`. Nothing on
 *  this path may ever render HTML that did not come through there.
 */
/** The Portal prototype carries an inline `min-height:100vh`, so any tab
 *  rendered as its sibling starts a full screen below the fold — the speaker
 *  taps Resources and sees an empty screen. Measured at 1280×800: the section
 *  began at y=870. Inline styles beat a stylesheet, hence `!important`; scoped
 *  to this tab so the prototype is untouched everywhere else. Same fix, and the
 *  same marker pattern, as the Feedback tab in `comments.tsx`. */
function AboveTheFold() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html:
          'body:has([data-portal-resources]) [data-screen-label="Speaker portal"]{min-height:0!important}',
      }}
    />
  );
}

function PortalResources({ pages }: { pages: readonly PortalPage[] }) {
  if (pages.length === 0) {
    return (
      <section
        data-portal-resources
        style={{ maxWidth: 760, margin: "0 auto", padding: "28px 20px 80px" }}
      >
        <AboveTheFold />
        <p style={{ font: "400 14px var(--font-plex-sans)", color: "var(--i3,#6B7B84)" }}>
          Nothing here yet. Guides, templates and run-of-show notes from the organisers will appear
          on this tab.
        </p>
      </section>
    );
  }

  return (
    <section
      data-portal-resources
      style={{ maxWidth: 760, margin: "0 auto", padding: "28px 20px 80px" }}
    >
      <AboveTheFold />
      {pages.map((page) => (
        <article key={page.id} style={{ marginBottom: 36 }}>
          <h2
            style={{
              font: "600 19px var(--font-plex-sans)",
              color: "var(--ik,#16232B)",
              margin: "0 0 4px",
            }}
          >
            {page.title}
          </h2>
          {page.is_pinned_in_portal ? (
            <p
              style={{
                font: "500 10px var(--font-plex-mono), monospace",
                letterSpacing: "0.08em",
                color: "var(--sg,#E04E4E)",
                margin: "0 0 10px",
              }}
            >
              START HERE
            </p>
          ) : null}
          {page.blocks.map((block, index) =>
            block.type === "text" ? (
              <p
                key={index}
                style={{
                  font: "400 14px/1.7 var(--font-plex-sans)",
                  color: "var(--i2,#3E4E58)",
                  whiteSpace: "pre-line",
                  margin: "0 0 12px",
                }}
              >
                {block.text}
              </p>
            ) : (
              <div
                key={index}
                style={{ margin: "0 0 12px", maxWidth: "100%", overflowX: "auto" }}
                dangerouslySetInnerHTML={{ __html: block.html }}
              />
            ),
          )}
        </article>
      ))}
    </section>
  );
}
