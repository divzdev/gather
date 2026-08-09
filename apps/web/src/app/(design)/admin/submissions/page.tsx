"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import { useConsoleChrome } from "@/components/console/chrome";
import { stripData, useProgramStats } from "@/components/console/stats";
import { Submissions, type SubmissionsData } from "@/components/design/Submissions";
import { authed } from "@/lib/session";

type Speaker = { name: string; organisation: string | null };
type Submission = {
  id: string;
  code: string;
  title: string;
  answers: Record<string, unknown>;
  status: string;
  decision_status: string;
  track_id: string | null;
  session_format_id: string | null;
  score_avg: string | null;
  review_count: number;
  submitted_at: string | null;
  speakers: Speaker[];
};
type Named = { id: string; name: string; hue_index?: number };

/** The prototype's status palette, kept verbatim so the table reads the same. */
const STATUS = {
  draft: { label: "Draft", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)", dot: "#6B7B84" },
  submitted: { label: "Submitted", fg: "var(--if,#47599F)", bg: "var(--ifw,#E9ECF7)", dot: "#47599F" },
  in_review: { label: "In review", fg: "var(--pd,#B96A1F)", bg: "var(--pdw,#F9EDDF)", dot: "#B96A1F" },
  accepted: { label: "Accepted", fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)", dot: "#0E7A5F" },
  waitlisted: { label: "Waitlisted", fg: "var(--pd,#B96A1F)", bg: "var(--pdw,#F9EDDF)", dot: "#B96A1F" },
  rejected: { label: "Rejected", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)", dot: "#6B7B84" },
  withdrawn: { label: "Withdrawn", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)", dot: "#6B7B84" },
} as const;

type StatusKey = keyof typeof STATUS;
const DECIDABLE = ["accepted", "waitlisted", "rejected"] as const;

/** Track colours in the prototype's order; the API hands back a hue index. */
const TRACK_HUES = ["#3E8896", "#A85788", "#5A6BA8", "#7E5CB8", "#C4703A", "#34526B"];

type View = "All" | "Needs review" | "Ready to decide" | "Accepted";
type SortKey = "title" | "score" | "date";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function statusOf(row: Submission): (typeof STATUS)[StatusKey] {
  return STATUS[row.status as StatusKey] ?? STATUS.submitted;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function SubmissionsPage() {
  const { chrome, toasts, toast, dismiss } = useConsoleChrome();
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const { stats, eventId } = useProgramStats();

  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("All");
  const [trackFilter, setTrackFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusKey[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [dense, setDense] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [popover, setPopover] = useState<"track" | "status" | "switch" | "help" | null>(null);
  const [hideBanner, setHideBanner] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [notes, setNotes] = useState<Record<string, { a: string; t: string; x: string }[]>>({});

  const { data, isPending } = useQuery({
    queryKey: ["submissions", eventId],
    enabled: eventId !== null,
    queryFn: async () => {
      const [page, tracks, formats] = await Promise.all([
        authed<{ data: Submission[]; meta: { total: number } }>(
          `/events/${eventId}/submissions?per_page=200`,
        ),
        authed<{ data: Named[] }>(`/events/${eventId}/tracks?per_page=100`),
        authed<{ data: Named[] }>(`/events/${eventId}/session-formats?per_page=100`),
      ]);
      return { page, tracks: tracks.data, formats: formats.data };
    },
  });

  const decide = useMutation({
    mutationFn: async ({ ids, outcome }: { ids: string[]; outcome: string }) => {
      if (ids.length === 1) {
        await authed(`/events/${eventId}/submissions/${ids[0]}/decision`, {
          method: "POST",
          body: { outcome },
        });
        return;
      }
      await authed(`/events/${eventId}/submissions/bulk-decision`, {
        method: "POST",
        body: { submission_ids: ids, outcome },
      });
    },
    onSuccess: (_result, { ids, outcome }) => {
      void queryClient.invalidateQueries({ queryKey: ["submissions", eventId] });
      // The strip, the rail badges and Overview all read program-stats.
      void queryClient.invalidateQueries({ queryKey: ["program-stats", eventId] });
      const label = STATUS[outcome as StatusKey]?.label.toLowerCase() ?? outcome;
      toast(
        `${ids.length} ${ids.length === 1 ? "proposal" : "proposals"} marked ${label}. Nothing is emailed until you send.`,
      );
      setSelected([]);
    },
    onError: (error: Error) => toast(error.message),
  });

  const all = useMemo(() => data?.page.data ?? [], [data]);
  const trackById = useMemo(
    () => new Map((data?.tracks ?? []).map((track) => [track.id, track])),
    [data],
  );
  const formatById = useMemo(
    () => new Map((data?.formats ?? []).map((format) => [format.id, format])),
    [data],
  );

  const trackName = (row: Submission) =>
    row.track_id === null ? "" : (trackById.get(row.track_id)?.name ?? "");
  const trackColour = (row: Submission) => {
    const hue = row.track_id === null ? undefined : trackById.get(row.track_id)?.hue_index;
    return TRACK_HUES[((hue ?? 1) - 1) % TRACK_HUES.length] ?? TRACK_HUES[0]!;
  };
  const formatName = (row: Submission) =>
    row.session_format_id === null ? "" : (formatById.get(row.session_format_id)?.name ?? "");
  const score = (row: Submission) => (row.score_avg === null ? null : Number(row.score_avg));

  const counts = {
    All: all.length,
    "Needs review": all.filter((row) => row.status === "submitted" || row.status === "in_review")
      .length,
    "Ready to decide": all.filter(
      (row) => row.status === "in_review" && row.review_count > 0,
    ).length,
    Accepted: all.filter((row) => row.status === "accepted").length,
  } satisfies Record<View, number>;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = all.filter((row) => {
      if (view === "Needs review" && row.status !== "submitted" && row.status !== "in_review") {
        return false;
      }
      if (view === "Ready to decide" && !(row.status === "in_review" && row.review_count > 0)) {
        return false;
      }
      if (view === "Accepted" && row.status !== "accepted") return false;
      if (trackFilter.length > 0 && !trackFilter.includes(trackName(row))) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(row.status as StatusKey)) return false;
      if (needle === "") return true;
      const haystack = [row.title, row.code, ...row.speakers.map((s) => s.name)]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });

    return [...rows].sort((a, b) => {
      const by =
        sortKey === "title"
          ? a.title.localeCompare(b.title)
          : sortKey === "score"
            ? (score(a) ?? -1) - (score(b) ?? -1)
            : (a.submitted_at ?? "").localeCompare(b.submitted_at ?? "");
      return by * sortDir;
    });
    // trackName/score read from `data` via the memoised maps above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query, view, trackFilter, statusFilter, sortKey, sortDir, trackById]);

  const open = openId === null ? null : (all.find((row) => row.id === openId) ?? null);
  const allSelected = filtered.length > 0 && filtered.every((row) => selected.includes(row.id));

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  const exportCsv = () => {
    const header = ["code", "title", "speakers", "track", "format", "status", "score", "reviews"];
    const lines = filtered.map((row) =>
      [
        row.code,
        row.title,
        row.speakers.map((s) => s.name).join("; "),
        trackName(row),
        formatName(row),
        statusOf(row).label,
        score(row)?.toFixed(1) ?? "",
        String(row.review_count),
      ]
        .map((cell) => `"${cell.replaceAll('"', '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "submissions.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${filtered.length} rows.`);
  };

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

  const check = (on: boolean) => ({
    ck: on ? "✓" : "",
    ckBg: on ? "var(--sg,#E04E4E)" : "var(--cd,#FFFFFF)",
  });

  const openStatus = open === null ? STATUS.submitted : statusOf(open);
  const openScore = open === null ? null : score(open);
  const decidedAs = (outcome: string, on: string, off: string, border: string) =>
    open?.status === outcome
      ? { bg: `var(--${on})`, fg: "#FFFFFF", bd: `var(--${on})` }
      : { bg: "transparent", fg: `var(--${off})`, bd: `var(--${border})` };
  const accepted = decidedAs("accepted", "ok,#0E7A5F", "ok,#0E7A5F", "okl,#C2E0D5");
  const waitlisted = decidedAs("waitlisted", "pd,#B96A1F", "pd,#B96A1F", "pdl,#EFD3B6");
  const rejected = decidedAs("rejected", "i3,#6B7B84", "i3,#6B7B84", "ls,#C8D2D5");

  const screen: SubmissionsData = {
    ...chrome,
    ...stripData(stats),
    pendingCount: stats.pendingSend,

    rows: filtered.map((row) => {
      const status = statusOf(row);
      const isSelected = selected.includes(row.id);
      const value = score(row);
      const filled = value === null ? 0 : Math.round(value);
      const segment = (n: number) =>
        n <= filled ? "var(--i2,#3E4E58)" : "var(--ln,#E1E7E9)";
      const lead = row.speakers[0];
      return {
        id: row.code,
        t: row.title,
        tr: trackName(row),
        trCol: trackColour(row),
        fmt: formatName(row),
        dt: row.submitted_at === null ? "—" : DAY.format(new Date(row.submitted_at)),
        spName: lead?.name ?? "No speaker",
        spSub:
          row.speakers.length > 1
            ? `with ${row.speakers[1]?.name ?? ""}`
            : (lead?.organisation ?? ""),
        ini: lead === undefined ? "?" : initials(lead.name),
        sc: value === null ? "–" : value.toFixed(1),
        s1: segment(1),
        s2: segment(2),
        s3: segment(3),
        s4: segment(4),
        s5: segment(5),
        rev: String(row.review_count),
        st: status.label,
        stFg: status.fg,
        stBg: status.bg,
        bg: isSelected
          ? "var(--sw,#FFEAE6)"
          : hover === row.id
            ? "var(--sk,#EDF1F2)"
            : "transparent",
        ring: openId === row.id ? "inset 2px 0 0 var(--sg,#E04E4E)" : "none",
        op: row.status === "rejected" ? "0.6" : "1",
        ...(({ ck, ckBg }) => ({
          ck,
          ckBg,
          ckBd: isSelected ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)",
        }))(check(isSelected)),
        showQ: hover === row.id && !isSelected,
        onEnter: () => setHover(row.id),
        onChk: (event: React.SyntheticEvent) => {
          event.stopPropagation();
          toggle(row.id);
        },
        onOpen: () => setOpenId(row.id),
        onOpenBtn: (event: React.SyntheticEvent) => {
          event.stopPropagation();
          setOpenId(row.id);
        },
        onAcc: (event: React.SyntheticEvent) => {
          event.stopPropagation();
          decide.mutate({ ids: [row.id], outcome: "accepted" });
        },
        onRej: (event: React.SyntheticEvent) => {
          event.stopPropagation();
          decide.mutate({ ids: [row.id], outcome: "rejected" });
        },
      };
    }),

    vAll: tile("All"),
    vNeed: tile("Needs review"),
    vReady: tile("Ready to decide"),
    vAcc: tile("Accepted"),

    trackOpts: (data?.tracks ?? []).map((track) => ({
      n: track.name,
      col: TRACK_HUES[((track.hue_index ?? 1) - 1) % TRACK_HUES.length] ?? TRACK_HUES[0]!,
      ...check(trackFilter.includes(track.name)),
      on: () =>
        setTrackFilter((current) =>
          current.includes(track.name)
            ? current.filter((x) => x !== track.name)
            : [...current, track.name],
        ),
    })),
    statusOpts: (Object.keys(STATUS) as StatusKey[]).map((key) => ({
      n: STATUS[key].label,
      dot: STATUS[key].dot,
      ...check(statusFilter.includes(key)),
      on: () =>
        setStatusFilter((current) =>
          current.includes(key) ? current.filter((x) => x !== key) : [...current, key],
        ),
    })),
    chips: [
      ...trackFilter.map((name) => ({
        t: `Track: ${name}`,
        on: () => setTrackFilter((current) => current.filter((x) => x !== name)),
      })),
      ...statusFilter.map((key) => ({
        t: `Status: ${STATUS[key].label}`,
        on: () => setStatusFilter((current) => current.filter((x) => x !== key)),
      })),
    ],
    hasChips: trackFilter.length + statusFilter.length > 0,
    clearFilters: () => {
      setTrackFilter([]);
      setStatusFilter([]);
      setQuery("");
      setView("All");
    },
    trackCountLabel: trackFilter.length > 0 ? `(${trackFilter.length})` : "",
    statusCountLabel: statusFilter.length > 0 ? `(${statusFilter.length})` : "",

    q: query,
    onQ: (event: React.SyntheticEvent) =>
      setQuery((event.target as HTMLInputElement).value),
    focusSearch: () => searchRef.current?.focus(),
    countLine: `${filtered.length} of ${data?.page.meta.total ?? 0} matching`,
    rowH: dense ? "36px" : "44px",
    densTitle: dense ? "Comfortable rows" : "Compact rows",
    togDensity: () => setDense((current) => !current),

    soTitle: sorter("title"),
    soScore: sorter("score"),
    soDate: sorter("date"),

    selN: selected.length,
    hasSel: selected.length > 0,
    allCk: allSelected ? "✓" : "",
    allCkBg: allSelected ? "var(--sg,#E04E4E)" : "var(--cd,#FFFFFF)",
    selAll: () => setSelected(allSelected ? [] : filtered.map((row) => row.id)),
    clearSel: () => setSelected([]),
    clearHover: () => setHover(null),
    bulkAcc: () => decide.mutate({ ids: selected, outcome: "accepted" }),
    bulkWait: () => decide.mutate({ ids: selected, outcome: "waitlisted" }),
    bulkRej: () => decide.mutate({ ids: selected, outcome: "rejected" }),
    bulkAssign: () => toast("Reviewer assignment lives on the Review screen."),
    exportCsv,

    firstRun: false,
    showTable: !isPending,
    empty: !isPending && filtered.length === 0,

    // The banner is the decision/send separation: decisions are recorded here,
    // and nothing reaches a speaker until it is sent from Messages.
    banner: !hideBanner && stats.pendingSend > 0,
    bannerX: () => setHideBanner(true),
    bannerGo: () => toast("Composing and sending decisions lives in Messages."),

    open: open !== null,
    closeDrawer: () => setOpenId(null),
    o: {
      id: open?.code ?? "",
      t: open?.title ?? "",
      tr: open === null ? "" : trackName(open),
      trCol: open === null ? "#000" : trackColour(open),
      fmt: open === null ? "" : formatName(open),
      lvl: String(open?.answers["level"] ?? "—"),
      dt: open?.submitted_at == null ? "" : DAY.format(new Date(open.submitted_at)),
      st: openStatus.label,
      stFg: openStatus.fg,
      stBg: openStatus.bg,
      ab: String(open?.answers["abstract"] ?? ""),
      rev: `${open?.review_count ?? 0} REVIEWS`,
      spList: (open?.speakers ?? []).map((speaker) => ({
        ini: initials(speaker.name),
        n: speaker.name,
        c: speaker.organisation ?? "",
      })),
      crits:
        openScore === null
          ? [{ n: "Not scored yet", v: "–", w: "0%" }]
          : [{ n: "Average score", v: openScore.toFixed(1), w: `${(openScore / 5) * 100}%` }],
      revs: [],
      notes: openId === null ? [] : (notes[openId] ?? []),
      acts: [
        {
          x:
            open?.submitted_at == null
              ? "Not submitted yet"
              : `${DAY.format(new Date(open.submitted_at))} · submitted via the public form`,
        },
        {
          x:
            (open?.review_count ?? 0) > 0
              ? `${open?.review_count} review${open?.review_count === 1 ? "" : "s"} recorded`
              : "Awaiting first review",
        },
        {
          x:
            open !== null && DECIDABLE.includes(open.status as (typeof DECIDABLE)[number])
              ? `Decision recorded: ${openStatus.label.toLowerCase()}${open.decision_status === "pending_send" ? " · not sent yet" : ""}`
              : "No decision yet",
        },
      ],
      accBg: accepted.bg,
      accFg: accepted.fg,
      accBd: accepted.bd,
      waitBg: waitlisted.bg,
      waitFg: waitlisted.fg,
      waitBd: waitlisted.bd,
      rejBg: rejected.bg,
      rejFg: rejected.fg,
      rejBd: rejected.bd,
    },
    dAcc: () => openId !== null && decide.mutate({ ids: [openId], outcome: "accepted" }),
    dWait: () => openId !== null && decide.mutate({ ids: [openId], outcome: "waitlisted" }),
    dRej: () => openId !== null && decide.mutate({ ids: [openId], outcome: "rejected" }),

    noteDraft,
    onNoteDraft: (event: React.SyntheticEvent) =>
      setNoteDraft((event.target as HTMLTextAreaElement).value),
    addNote: () => {
      if (openId === null || noteDraft.trim() === "") return;
      const entry = { a: "You", t: noteDraft.trim(), x: "just now" };
      setNotes((current) => ({ ...current, [openId]: [...(current[openId] ?? []), entry] }));
      setNoteDraft("");
    },
    onCoord: () => toast("Coordinator notes stay internal; speakers never see them."),

    togTrack: () => setPopover((current) => (current === "track" ? null : "track")),
    togStatus: () => setPopover((current) => (current === "status" ? null : "status")),
    togSwitch: () => setPopover((current) => (current === "switch" ? null : "switch")),
    togHelp: () => setPopover((current) => (current === "help" ? null : "help")),
    closePop: () => setPopover(null),
    popTrack: popover === "track",
    popStatus: popover === "status",
    popSwitch: popover === "switch",
    popHelp: popover === "help",
    otherEvent: () => {
      setPopover(null);
      toast("This workspace has one event seeded. Switching works the same way.");
    },

    hsAll: () => setView("All"),
    hsUnrev: () => setView("Needs review"),
    hsDecided: () => setView("Accepted"),
    keys: [
      { k: "/", d: "Focus search" },
      { k: "J / K", d: "Move down and up" },
      { k: "A", d: "Accept" },
      { k: "R", d: "Reject" },
      { k: "Esc", d: "Close" },
    ],

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

  return <Submissions d={screen} />;
}
