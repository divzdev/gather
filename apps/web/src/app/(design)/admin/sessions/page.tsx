"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useConsoleChrome } from "@/components/console/chrome";
import { stripData, useProgramStats } from "@/components/console/stats";
import { Sessions, type SessionsData } from "@/components/design/Sessions";
import { authed } from "@/lib/session";

type SessionRow = {
  id: string;
  title: string;
  slug: string;
  abstract: string | null;
  submission_id: string | null;
  track_id: string | null;
  session_format_id: string | null;
  duration_minutes: number;
  event_day_id: string | null;
  room_id: string | null;
  starts_at: string | null;
  is_locked: boolean;
  status: string;
  content_status: string;
  speakers: { id: string; name: string; role: string }[];
};
type Named = { id: string; name: string; hue_index?: number };

const TRACK_HUES = ["#3E8896", "#A85788", "#5A6BA8", "#7E5CB8", "#C4703A", "#34526B"];

const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  unscheduled: { label: "Unscheduled", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)" },
  scheduled: { label: "Scheduled", fg: "var(--if,#47599F)", bg: "var(--ifw,#E9ECF7)" },
  confirmed: { label: "Confirmed", fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)" },
};

type View = "All" | "Unscheduled" | "Scheduled" | "Needs approval";
type SortKey = "title" | "code" | "track" | "sched";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export default function SessionsPage() {
  const { chrome, toasts, toast, dismiss } = useConsoleChrome();
  const { stats, eventId } = useProgramStats();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("All");
  const [trackFilter, setTrackFilter] = useState<string[]>([]);
  const [formatFilter, setFormatFilter] = useState<string[]>([]);
  const [filterPop, setFilterPop] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<"detail" | "participants">("detail");
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [partDraft, setPartDraft] = useState("");

  const { data } = useQuery({
    queryKey: ["sessions", eventId],
    enabled: eventId !== null,
    queryFn: async () => {
      const [sessions, tracks, formats, rooms] = await Promise.all([
        authed<SessionRow[]>(`/events/${eventId}/sessions`),
        authed<{ data: Named[] }>(`/events/${eventId}/tracks?per_page=100`),
        authed<{ data: Named[] }>(`/events/${eventId}/session-formats?per_page=100`),
        authed<{ data: Named[] }>(`/events/${eventId}/rooms?per_page=100`),
      ]);
      return { sessions, tracks: tracks.data, formats: formats.data, rooms: rooms.data };
    },
  });

  const approve = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      authed(`/events/${eventId}/sessions/${id}/approval`, {
        method: "POST",
        body: { content_status: status },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions", eventId] });
      toast("Content approval updated. Only approved content reaches the public site.");
    },
    onError: (error: Error) => toast(error.message),
  });

  const all = useMemo(() => data?.sessions ?? [], [data]);
  const trackById = useMemo(
    () => new Map((data?.tracks ?? []).map((t) => [t.id, t])),
    [data],
  );
  const formatById = useMemo(
    () => new Map((data?.formats ?? []).map((f) => [f.id, f])),
    [data],
  );
  const roomById = useMemo(() => new Map((data?.rooms ?? []).map((r) => [r.id, r])), [data]);

  const trackName = (row: SessionRow) =>
    row.track_id === null ? "" : (trackById.get(row.track_id)?.name ?? "");
  const trackColour = (row: SessionRow) => {
    const hue = row.track_id === null ? undefined : trackById.get(row.track_id)?.hue_index;
    return TRACK_HUES[((hue ?? 1) - 1) % TRACK_HUES.length] ?? TRACK_HUES[0]!;
  };
  const formatName = (row: SessionRow) =>
    row.session_format_id === null
      ? `${row.duration_minutes} min`
      : (formatById.get(row.session_format_id)?.name ?? `${row.duration_minutes} min`);

  const counts = {
    All: all.length,
    Unscheduled: all.filter((row) => row.starts_at === null).length,
    Scheduled: all.filter((row) => row.starts_at !== null).length,
    "Needs approval": all.filter((row) => row.content_status !== "approved").length,
  } satisfies Record<View, number>;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = all.filter((row) => {
      if (view === "Unscheduled" && row.starts_at !== null) return false;
      if (view === "Scheduled" && row.starts_at === null) return false;
      if (view === "Needs approval" && row.content_status === "approved") return false;
      if (trackFilter.length > 0 && !trackFilter.includes(trackName(row))) return false;
      if (formatFilter.length > 0 && !formatFilter.includes(formatName(row))) return false;
      if (needle === "") return true;
      const hay = [row.title, ...row.speakers.map((s) => s.name)].join(" ").toLowerCase();
      return hay.includes(needle);
    });
    return [...rows].sort((a, b) => {
      const by =
        sortKey === "track"
          ? trackName(a).localeCompare(trackName(b))
          : sortKey === "sched"
            ? (a.starts_at ?? "").localeCompare(b.starts_at ?? "")
            : sortKey === "code"
              ? a.slug.localeCompare(b.slug)
              : a.title.localeCompare(b.title);
      return by * sortDir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query, view, trackFilter, formatFilter, sortKey, sortDir, trackById, formatById]);

  const open = openId === null ? null : (all.find((row) => row.id === openId) ?? null);

  const check = (on: boolean) => ({
    ck: on ? "✓" : "",
    ckBg: on ? "var(--sg,#E04E4E)" : "var(--cd,#FFFFFF)",
  });
  const tile = (name: View) => ({
    c: counts[name],
    on: () => setView(name),
    bd: view === name ? "var(--sg,#E04E4E)" : "var(--ln,#E1E7E9)",
    ring: view === name ? "0 0 0 3px var(--sw,#FFEAE6)" : "0 1px 2px rgba(13,16,32,.04)",
    numFg: view === name ? "var(--sg,#E04E4E)" : "var(--ik,#16232B)",
  });
  const sorter = (key: SortKey) => ({
    on: () => {
      if (sortKey === key) setSortDir((dir) => (dir === 1 ? -1 : 1));
      else {
        setSortKey(key);
        setSortDir(1);
      }
    },
    g: sortKey === key ? (sortDir === 1 ? "↑" : "↓") : "↑↓",
    gc: sortKey === key ? "var(--sg,#E04E4E)" : "var(--i4,#99A6AD)",
    fg: sortKey === key ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
  });
  const notBuilt = (what: string) => () => toast(`${what} is not built yet.`);

  const screen: SessionsData = {
    ...chrome,
    ...stripData(stats),
    total: all.length,

    rows: filtered.map((row) => ({
      id: row.slug.slice(-6).toUpperCase(),
      t: row.title,
      sp: row.speakers.map((speaker) => speaker.name).join(", ") || "No speaker yet",
      tr: trackName(row),
      trCol: trackColour(row),
      fmt: formatName(row),
      sched:
        row.starts_at === null
          ? "unscheduled"
          : `${WHEN.format(new Date(row.starts_at))}${row.room_id === null ? "" : ` · ${roomById.get(row.room_id)?.name ?? ""}`}`,
      schedFg: row.starts_at === null ? "var(--i4,#99A6AD)" : "var(--ik,#16232B)",
      st: (STATUS[row.status] ?? STATUS.unscheduled!).label,
      stFg: (STATUS[row.status] ?? STATUS.unscheduled!).fg,
      stBg: (STATUS[row.status] ?? STATUS.unscheduled!).bg,
      onOpen: () => {
        setOpenId(row.id);
        setTab("detail");
      },
    })),

    tAll: tile("All"),
    tQu: tile("Unscheduled"),
    tAcc: tile("Scheduled"),
    tPe: tile("Needs approval"),

    q: query,
    onQ: (event: React.SyntheticEvent) => setQuery((event.target as HTMLInputElement).value),
    countLine: `${filtered.length} of ${all.length} sessions`,
    sumLine: `${counts.Scheduled} placed · ${counts.Unscheduled} still to schedule · ${counts["Needs approval"]} awaiting approval`,
    schedN: counts.Scheduled,
    empty: all.length === 0,

    soTitle: sorter("title"),
    soCode: sorter("code"),
    soTrack: sorter("track"),
    soSched: sorter("sched"),

    togFPop: () => setFilterPop((on) => !on),
    closeFPop: () => setFilterPop(false),
    fPopOn: filterPop,
    fTrackOpts: (data?.tracks ?? []).map((track) => ({
      n: track.name,
      col: TRACK_HUES[((track.hue_index ?? 1) - 1) % TRACK_HUES.length] ?? TRACK_HUES[0]!,
      ...check(trackFilter.includes(track.name)),
      on: () =>
        setTrackFilter((current) =>
          current.includes(track.name)
            ? current.filter((entry) => entry !== track.name)
            : [...current, track.name],
        ),
    })),
    fFmtOpts: (data?.formats ?? []).map((format) => ({
      n: format.name,
      col: "var(--i4,#99A6AD)",
      ...check(formatFilter.includes(format.name)),
      on: () =>
        setFormatFilter((current) =>
          current.includes(format.name)
            ? current.filter((entry) => entry !== format.name)
            : [...current, format.name],
        ),
    })),
    fCount: trackFilter.length + formatFilter.length,
    fBg: filterPop ? "var(--sw,#FFEAE6)" : "var(--cd,#FFFFFF)",
    fFg: filterPop ? "var(--sg,#E04E4E)" : "var(--i2,#3E4E58)",
    fBd: filterPop ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)",
    clearF: () => {
      setTrackFilter([]);
      setFormatFilter([]);
      setQuery("");
      setView("All");
    },

    drawer: open !== null,
    closeDrawer: () => setOpenId(null),
    isEdit: false,
    openNew: notBuilt("Creating an invited session"),
    dTitle: open?.title ?? "",
    dStamp:
      open === null
        ? ""
        : open.submission_id === null
          ? "invited · no proposal"
          : "promoted from a proposal",
    titleCount: `${(open?.title ?? "").length}/300`,
    titleBd: "var(--ls,#C8D2D5)",
    save: () =>
      open === null
        ? undefined
        : approve.mutate({
            id: open.id,
            status: open.content_status === "approved" ? "pending" : "approved",
          }),
    saveLabel:
      open?.content_status === "approved" ? "Withdraw approval" : "Approve for the public site",

    f: {
      t: open?.title ?? "",
      desc: open?.abstract ?? "",
      tr: open === null ? "" : trackName(open),
      fmt: open === null ? "" : formatName(open),
      room: open?.room_id == null ? "Not placed" : (roomById.get(open.room_id)?.name ?? ""),
      starts: open?.starts_at == null ? "Not scheduled" : WHEN.format(new Date(open.starts_at)),
      cap: String(open?.duration_minutes ?? ""),
      st: open === null ? "" : (STATUS[open.status] ?? STATUS.unscheduled!).label,
    },
    onT: notBuilt("Renaming a session"),
    onDesc: notBuilt("Editing the abstract"),
    onTr: notBuilt("Changing the track"),
    onFmt: notBuilt("Changing the format"),
    onRoom: notBuilt("Placing a session"),
    onStarts: notBuilt("Scheduling"),
    onCap: notBuilt("Changing the duration"),
    onSt: notBuilt("Changing the status"),

    tabs: [
      { key: "detail", label: "Detail" },
      { key: "participants", label: "Speakers" },
    ].map((entry) => ({
      n: entry.label,
      c: entry.key === "participants" ? (open?.speakers.length ?? 0) : 0,
      on: () => setTab(entry.key as "detail" | "participants"),
      fg: tab === entry.key ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
      bd: tab === entry.key ? "var(--sg,#E04E4E)" : "transparent",
      bg: tab === entry.key ? "var(--sw,#FFEAE6)" : "none",
    })),
    tabDet: () => setTab("detail"),
    tabPar: () => setTab("participants"),
    onDet: tab === "detail",
    onPar: tab === "participants",
    detFg: tab === "detail" ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
    detUl: tab === "detail" ? "2px solid var(--sg,#E04E4E)" : "2px solid transparent",
    detWt: tab === "detail" ? "600" : "500",
    parFg: tab === "participants" ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
    parUl: tab === "participants" ? "2px solid var(--sg,#E04E4E)" : "2px solid transparent",
    parWt: tab === "participants" ? "600" : "500",

    parts: (open?.speakers ?? []).map((speaker) => ({
      n: speaker.name,
      ini: speaker.name
        .split(" ")
        .map((part) => part[0] ?? "")
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      role: speaker.role,
      onX: notBuilt("Removing a speaker"),
    })),
    partN: open?.speakers.length ?? 0,
    partDraft,
    onPartDraft: (event: React.SyntheticEvent) =>
      setPartDraft((event.target as HTMLInputElement).value),
    addPart: notBuilt("Adding a speaker to a session"),

    optOpen: false,
    togOpt: notBuilt("Session options"),
    doCsv: () => {
      const header = ["title", "speakers", "track", "format", "status", "scheduled"];
      const lines = filtered.map((row) =>
        [
          row.title,
          row.speakers.map((s) => s.name).join("; "),
          trackName(row),
          formatName(row),
          row.status,
          row.starts_at ?? "",
        ]
          .map((cell) => `"${cell.replaceAll('"', '""')}"`)
          .join(","),
      );
      const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "sessions.csv";
      anchor.click();
      URL.revokeObjectURL(url);
      toast(`Exported ${filtered.length} sessions.`);
    },
    doXlsx: notBuilt("XLSX export"),
    doFiles: notBuilt("Bulk file download"),
    doImport: notBuilt("Importing sessions"),

    imp: false,
    impClose: () => undefined,
    impRaw: "",
    onImpRaw: () => undefined,
    impRows: [],
    impCount: 0,
    impErr: "",
    impErrShow: false,
    impExample: notBuilt("Importing sessions"),
    impFile: notBuilt("Choosing a file"),
    impGo: notBuilt("Importing sessions"),
    impGoBg: "var(--ls,#C8D2D5)",
    impGoFg: "var(--i3,#6B7B84)",
    impLabel: "Import",
    impReady: false,

    toasts: toasts.map((entry) => ({
      msg: entry.msg,
      canUndo: entry.revert !== undefined,
      onUndo: () => {
        entry.revert?.();
        dismiss(entry.id);
      },
      onX: () => dismiss(entry.id),
    })),
  };

  return <Sessions d={screen} />;
}
