"use client";

/** The speaker's whole world: what they owe, when they are on, and who they are
 *  in the programme. One payload feeds the home tab, because this is opened on a
 *  phone between other things. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { Portal, type PortalData } from "@/components/design/Portal";
import { useTheme } from "@/components/ThemeProvider";
import { API_BASE_URL } from "@/lib/api";
import { getSpeakerToken, portal } from "@/lib/session";
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
    title: string;
    abstract: string | null;
    starts_at: string | null;
    duration_minutes: number;
    room: string | null;
  }[];
  tasks: Task[];
  progress: { total: number; complete: number; outstanding: number; overdue: number };
};

type Submission = {
  id: string;
  code: string;
  title: string;
  status: string;
  submitted_at: string | null;
};

type Tab = "home" | "subs" | "profile";

/** The profile form, held locally so typing never round-trips. */
type Draft = {
  sal: string;
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

const SUBMISSION_LOOK: Record<string, { label: string; fg: string; bg: string; bar: string }> = {
  draft: { label: "Draft", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)", bar: "var(--ls,#C8D2D5)" },
  submitted: { label: "Submitted", fg: "var(--if,#47599F)", bg: "var(--ifw,#E9ECF7)", bar: "var(--if,#47599F)" },
  in_review: { label: "In review", fg: "var(--pd,#B96A1F)", bg: "var(--pdw,#F9EDDF)", bar: "var(--pd,#B96A1F)" },
  accepted: { label: "Accepted", fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)", bar: "var(--ok,#0E7A5F)" },
  waitlisted: { label: "Waitlisted", fg: "var(--pd,#B96A1F)", bg: "var(--pdw,#F9EDDF)", bar: "var(--pd,#B96A1F)" },
  rejected: { label: "Not this time", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)", bar: "var(--ls,#C8D2D5)" },
  withdrawn: { label: "Withdrawn", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)", bar: "var(--ls,#C8D2D5)" },
};

const CTA: Record<Task["kind"], string> = {
  upload: "Upload",
  form: "Fill in",
  acknowledge: "Confirm",
  external_link: "Open",
};

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function PortalPage() {
  const theme = useTheme();
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

  const signedIn = typeof window !== "undefined" && getSpeakerToken() !== null;

  // The clock is read once per fetch, not per render: "2d overdue" must not
  // change because something else re-rendered.
  const { data, error } = useQuery({
    queryKey: ["portal-home"],
    enabled: signedIn,
    queryFn: async () => ({ home: await portal<Home>("/home"), now: Date.now() }),
  });
  const { data: submissions } = useQuery({
    queryKey: ["portal-submissions"],
    enabled: signedIn,
    queryFn: () => portal<Submission[]>("/submissions"),
  });

  const home = data?.home;
  const now = data?.now ?? 0;

  const saveProfile = useMutation({
    mutationFn: (fields: Draft) =>
      portal("/profile", {
        method: "PATCH",
        body: {
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
          | { error?: { message?: string } }
          | undefined;
        throw new Error(problem?.error?.message ?? "That upload was refused.");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portal-home"] });
      say("Uploaded. You can replace it any time; we keep every version.");
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

  if (!signedIn || error) {
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
        <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
          <strong style={{ font: "600 18px 'IBM Plex Sans',sans-serif" }}>
            This portal needs your sign-in link
          </strong>
          <span>Speakers never have a password. Ask for a fresh link and open it on this device.</span>
          <a href="/login" style={{ color: "var(--sg,#E04E4E)" }}>
            Send me a link
          </a>
        </div>
      </main>
    );
  }

  const tasks = home?.tasks ?? [];
  const open = tasks.filter((task) => task.status !== "complete");
  const done = tasks.filter((task) => task.status === "complete");
  const talk = home?.sessions[0] ?? null;
  // Server values until the speaker touches something, their edit after that.
  // Seeding state from the query would need an effect, and an effect that writes
  // state on arrival re-renders the whole screen for nothing.
  const fields: Draft = draft ?? {
    sal: "None",
    pro: home?.speaker.pronouns ?? "",
    title: home?.speaker.job_title ?? "",
    co: home?.speaker.company ?? "",
    bio: home?.speaker.bio ?? "",
    web: home?.speaker.links.website ?? "",
    li: home?.speaker.links.linkedin ?? "",
  };

  const startUpload = (task: Task) => {
    if (task.kind === "acknowledge") {
      acknowledge.mutate(task.id);
      return;
    }
    if (task.kind === "external_link" && task.external_url !== null) {
      window.open(task.external_url, "_blank", "noopener");
      return;
    }
    target.current = task.id;
    upload.current?.click();
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
    db: reached ? "var(--sg,#E04E4E)" : "var(--cd,#FFFFFF)",
    bd: reached ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)",
    dc: reached ? "#FFFFFF" : "var(--i4,#99A6AD)",
    ln: last ? "none" : "block",
    lc: reached ? "var(--sl,#FFC9C0)" : "var(--ln,#E1E7E9)",
    tf: reached ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
    n: name,
    d: note,
  });

  const progress = home?.progress ?? { total: 0, complete: 0, outstanding: 0, overdue: 0 };
  const eventStart = home === undefined ? null : new Date(`${home.event.starts_on}T00:00:00Z`);

  const screen: PortalData = {
    tabs: (
      [
        { key: "home", n: "Home", c: open.length },
        { key: "subs", n: "My submissions", c: submissions?.length ?? 0 },
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
    greet: `${greeting(new Date(now).getHours())}, ${(home?.speaker.name ?? "").split(" ")[0] ?? ""}.`,
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
          task.files.length > 0
            ? `${task.files[0]?.filename ?? "file"} · version ${task.files[0]?.version ?? 1}`
            : (task.description ?? (task.is_required ? "Required" : "Optional")),
        due: due.text,
        dueFg: due.fg,
        bar: task.status === "overdue" ? "var(--cn,#D8432B)" : "var(--sg,#E04E4E)",
        cta: task.files.length > 0 ? "Replace" : CTA[task.kind],
        onGo: () => startUpload(task),
      };
    }),
    doneN: done.length,
    totalN: progress.total,
    doneTasks: done.map((task) => ({
      n: task.name,
      at: task.files[0]?.filename ?? "done",
    })),

    guide: () => say("The speaker guide arrives with your confirmation email."),
    msgTeam: () => {
      window.location.href = `mailto:?subject=${encodeURIComponent(home?.event.name ?? "")}`;
    },

    sessTime:
      talk === null
        ? "Your session time is not set yet."
        : talk.starts_at === null
          ? `${talk.title} · time to be confirmed`
          : `${DAY.format(new Date(talk.starts_at))} · ${new Date(talk.starts_at).toLocaleTimeString(
              "en-GB",
              {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: localTz ? undefined : (home?.event.timezone ?? "UTC"),
              },
            )} · ${talk.room ?? "room to come"}`,
    togCal: () => setCalOpen((current) => !current),
    calOpen,
    dlIcs: () => {
      setCalOpen(false);
      if (home === undefined) return;
      window.open(`${API_BASE_URL}/public/events/${home.event.slug}/schedule`, "_blank");
    },
    calG: () => {
      setCalOpen(false);
      say("Add-to-calendar links arrive with the schedule confirmation.");
    },
    calO: () => {
      setCalOpen(false);
      say("Add-to-calendar links arrive with the schedule confirmation.");
    },

    keyDates: open.slice(0, 4).map((task, index) => {
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
    }),

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
            window.open(`/e/${home.event.slug}/status/${row.code}`, "_blank", "noopener");
          }
        },
      };
    }),
    subCount: `${submissions?.length ?? 0} in total`,
    subLine:
      (submissions?.length ?? 0) === 0
        ? "Nothing submitted to this event yet."
        : "Your proposals and where each one stands.",
    noSubs: (submissions?.length ?? 0) === 0,

    pf: fields,
    onSal: () => undefined,
    onPro: (event) => setDraft({ ...fields, pro: (event.target as HTMLInputElement).value }),
    onTitle: (event) => setDraft({ ...fields, title: (event.target as HTMLInputElement).value }),
    onCo: (event) => setDraft({ ...fields, co: (event.target as HTMLInputElement).value }),
    onBio: (event) => setDraft({ ...fields, bio: (event.target as HTMLTextAreaElement).value }),
    onWeb: (event) => setDraft({ ...fields, web: (event.target as HTMLInputElement).value }),
    onLi: (event) => setDraft({ ...fields, li: (event.target as HTMLInputElement).value }),
    bioCount: `${fields.bio.length} / ${BIO_TARGET}`,
    bioCountFg:
      fields.bio.length > BIO_TARGET ? "var(--cn,#D8432B)" : "var(--i4,#99A6AD)",
    pfStamp: saveProfile.isPending ? "Saving…" : "Saved as you type",
    pvName: home?.speaker.name ?? "",
    pvRole: [fields.title, fields.co].filter(Boolean).join(" · "),
    upShot: () => headshot.current?.click(),

    toasts: notices.map((notice) => ({
      msg: notice.msg,
      canUndo: false,
      onUndo: () => undefined,
      onX: () => setNotices((current) => current.filter((n) => n.id !== notice.id)),
    })),
  };

  return (
    <>
      <Portal d={screen} />
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
        accept="image/*"
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
              background: "#FF6B6B",
              color: "#331313",
              font: "600 13px 'IBM Plex Sans',sans-serif",
              boxShadow: "0 10px 28px rgba(216,86,74,.28)",
            }}
          >
            {saveProfile.isPending ? "Saving…" : "Save profile"}
          </button>
        </div>
      ) : null}
    </>
  );
}
