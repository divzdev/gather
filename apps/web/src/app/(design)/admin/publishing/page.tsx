"use client";

/** Embeds: pick a widget, style it, copy the snippet.
 *
 *  The preview renders from the same published snapshot the embed script reads,
 *  so what an organiser sees here is what their website will show. It reads the
 *  public endpoint with no credentials for exactly that reason — if the preview
 *  needed a login it would prove nothing about the anonymous case.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useConsoleChrome } from "@/components/console/chrome";
import { useProgramStats } from "@/components/console/stats";
import { Publishing, type PublishingData } from "@/components/design/Publishing";
import { API_BASE_URL, apiFetch } from "@/lib/api";
import { authed } from "@/lib/session";

type PublicSession = {
  title: string;
  starts_at: string | null;
  room: string | null;
  track: string | null;
  speakers: { name: string }[];
};

type PublicSchedule = {
  event: { name: string };
  tracks: { name: string }[];
  days: { date: string; label: string | null }[];
  sessions: PublicSession[];
};

type PublicSpeakers = {
  speakers: { name: string; company: string | null; job_title: string | null }[];
};

const PALETTES = {
  light: {
    page: "#FFFFFF",
    card: "#FFFFFF",
    ink: "#16232B",
    muted: "#6B7B84",
    line: "#E1E7E9",
  },
  dark: {
    page: "#101013",
    card: "#17171B",
    ink: "#F2F2F0",
    muted: "#929290",
    line: "#2A2A31",
  },
} as const;

const CLOCK = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export default function PublishingPage() {
  const { toasts, toast, dismiss } = useConsoleChrome();
  const { eventId } = useProgramStats();

  const [widget, setWidget] = useState<"schedule" | "speakers">("schedule");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [track, setTrack] = useState<string | null>(null);
  const [day, setDay] = useState("");
  const [search, setSearch] = useState(true);
  const [wide, setWide] = useState(true);

  const { data: event } = useQuery({
    queryKey: ["event-slug", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<{ slug: string; name: string }>(`/events/${eventId}`),
  });
  const slug = event?.slug ?? null;

  // No auth header on purpose: this is the anonymous payload the embed will get.
  const { data: schedule, error } = useQuery({
    queryKey: ["public-schedule", slug],
    enabled: slug !== null,
    retry: false,
    queryFn: () => apiFetch<PublicSchedule>(`/public/events/${slug}/schedule`),
  });
  const { data: speakers } = useQuery({
    queryKey: ["public-speakers", slug],
    enabled: slug !== null && widget === "speakers",
    retry: false,
    queryFn: () => apiFetch<PublicSpeakers>(`/public/events/${slug}/speakers`),
  });

  const palette = PALETTES[theme];
  const origin = API_BASE_URL.replace(/\/v1$/, "");
  const query = `?widget=${widget}&theme=${theme}${track === null ? "" : `&track=${encodeURIComponent(track)}`}`;
  const code =
    slug === null
      ? "Publish the schedule first."
      : `<div id="gather-${widget}"></div>\n<script src="${window.location.origin}${origin}/v1/public/events/${slug}/embed.js${query}" async></script>`;

  const sessions = useMemo(() => {
    const rows = schedule?.sessions ?? [];
    return rows.filter((row) => {
      if (track !== null && row.track !== track) return false;
      if (day !== "" && (row.starts_at ?? "").slice(0, 10) !== day) return false;
      return true;
    });
  }, [schedule, track, day]);

  const notPublished = error !== null;

  const screen: PublishingData = {

    widgets: (
      [
        { key: "schedule", n: "Schedule" },
        { key: "speakers", n: "Speakers" },
      ] as const
    ).map((entry) => ({
      n: entry.n,
      on: () => setWidget(entry.key),
      bd: widget === entry.key ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)",
      bg: widget === entry.key ? "var(--sw,#FFEAE6)" : "var(--cd,#FFFFFF)",
      fg: widget === entry.key ? "var(--sg,#E04E4E)" : "var(--i2,#3E4E58)",
    })),
    isSchedule: widget === "schedule",
    isSpeakers: widget === "speakers",

    themes: (["light", "dark"] as const).map((entry) => ({
      n: entry === "light" ? "Light" : "Dark",
      on: () => setTheme(entry),
      bg: theme === entry ? "var(--cd,#FFFFFF)" : "none",
      fg: theme === entry ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
      wt: theme === entry ? "600" : "400",
      sh: theme === entry ? "0 1px 2px rgba(13,16,32,.12)" : "none",
    })),

    trackChips: (schedule?.tracks ?? []).map((entry) => ({
      n: entry.name,
      on: () => setTrack((current) => (current === entry.name ? null : entry.name)),
      bd: track === entry.name ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)",
      bg: track === entry.name ? "var(--sw,#FFEAE6)" : "var(--cd,#FFFFFF)",
      fg: track === entry.name ? "var(--sg,#E04E4E)" : "var(--i2,#3E4E58)",
    })),

    day,
    onDay: (entry) => setDay((entry.target as HTMLInputElement).value),
    search,
    togSearch: () => setSearch((current) => !current),
    searchSwBg: search ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)",
    searchSwX: search ? "18px" : "2px",

    devDesk: () => setWide(true),
    devMob: () => setWide(false),
    dD: {
      bg: wide ? "var(--cd,#FFFFFF)" : "none",
      fg: wide ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
      wt: wide ? "600" : "400",
    },
    dM: {
      bg: wide ? "none" : "var(--cd,#FFFFFF)",
      fg: wide ? "var(--i3,#6B7B84)" : "var(--ik,#16232B)",
      wt: wide ? "400" : "600",
    },
    pvW: wide ? "100%" : "375px",
    pvCols: wide ? "repeat(auto-fill,minmax(260px,1fr))" : "1fr",

    pvPage: palette.page,
    pvCard: palette.card,
    pvInk: palette.ink,
    pvMut: palette.muted,
    pvLn: palette.line,
    pvSunk: theme === "dark" ? "#1F1F24" : "#EDF1F2",
    pvTitle: notPublished ? "Nothing published yet" : (schedule?.event.name ?? ""),
    pvSub: notPublished
      ? "Publish the schedule from the agenda, then this preview fills in."
      : `${sessions.length} session${sessions.length === 1 ? "" : "s"}`,
    pvCount: widget === "speakers" ? (speakers?.speakers.length ?? 0) : sessions.length,

    pvRows: sessions.map((row) => ({
      t: row.title,
      time: row.starts_at === null ? "TBC" : CLOCK.format(new Date(row.starts_at)),
      room: row.room ?? "",
      sp: row.speakers.map((person) => person.name).join(", "),
      col: "var(--sg,#E04E4E)",
    })),
    pvSpeakers: (speakers?.speakers ?? []).map((person) => ({
      n: person.name,
      c: [person.job_title, person.company].filter(Boolean).join(", "),
      ini: person.name
        .split(" ")
        .map((part) => part[0] ?? "")
        .join("")
        .slice(0, 2)
        .toUpperCase(),
    })),

    codeText: code,
    copyCode: () => {
      void navigator.clipboard?.writeText(code);
      toast("Snippet copied. It updates the moment you publish, with no cache to wait out.");
    },

    toasts: toasts.map((entry) => ({
      msg: entry.msg,
      onX: () => dismiss(entry.id),
    })),
  };

  return <Publishing d={screen} />;
}
