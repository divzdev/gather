"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { useConsoleChrome } from "@/components/console/chrome";
import { stripData, useProgramStats } from "@/components/console/stats";
import { Speakers, type SpeakersData } from "@/components/design/Speakers";
import { API_BASE_URL } from "@/lib/api";
import { authed, download, getToken } from "@/lib/session";

type Roster = {
  id: string;
  speaker_id: string;
  name: string;
  email: string;
  company: string | null;
  job_title: string | null;
  pronouns: string | null;
  bio: string | null;
  status: string;
  submission_count: number;
  portal_last_seen_at: string | null;
};

const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  prospective: { label: "Prospective", fg: "var(--if,#47599F)", bg: "var(--ifw,#E9ECF7)" },
  accepted: { label: "Accepted", fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)" },
  confirmed: { label: "Confirmed", fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)" },
  declined: { label: "Declined", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)" },
  withdrawn: { label: "Withdrawn", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)" },
};

/** What the roster can tell you is missing today. Headshots and slides need the
 *  files endpoint, so they are deliberately absent rather than always empty. */
const MISSING_CHECKS = [
  { key: "bio", label: "Bio", of: (row: Roster) => (row.bio ?? "").trim() !== "" },
  { key: "company", label: "Company", of: (row: Roster) => (row.company ?? "").trim() !== "" },
  { key: "role", label: "Job title", of: (row: Roster) => (row.job_title ?? "").trim() !== "" },
];

type View = "All" | "Confirmed" | "Incomplete" | "Never signed in";
type SortKey = "name" | "company" | "sessions" | "missing";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function SpeakersPage() {
  const { chrome, toasts, toast, dismiss } = useConsoleChrome();
  const { stats, eventId } = useProgramStats();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("All");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [missingFilter, setMissingFilter] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [hover, setHover] = useState<string | null>(null);
  // ?open=<id> so a speaker can be linked to — see the same note on submissions.
  const [openId, setOpenId] = useState<string | null>(useSearchParams().get("open"));
  const [tab, setTab] = useState<"sessions" | "tasks" | "files" | "notes">("sessions");
  const [filterPop, setFilterPop] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [notes, setNotes] = useState<Record<string, { a: string; t: string; x: string }[]>>({});

  const { data: roster } = useQuery({
    queryKey: ["roster", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Roster[]>(`/events/${eventId}/speakers`),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      authed(`/events/${eventId}/speakers/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["roster", eventId] });
      toast("Status updated.");
    },
    onError: (error: Error) => toast(error.message),
  });

  const importCsv = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`${API_BASE_URL}/events/${eventId}/speakers/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body,
      });
      if (!response.ok) throw new Error("That file could not be imported.");
      return (await response.json()) as {
        created: number;
        matched: number;
        skipped: number;
        errors: string[];
      };
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["roster", eventId] });
      toast(
        `${result.created} added, ${result.matched} matched to existing people, ${result.skipped} skipped.` +
          (result.errors.length > 0 ? ` First problem: ${result.errors[0]}` : ""),
      );
    },
    onError: (error: Error) => toast(error.message),
  });

  const all = useMemo(() => roster ?? [], [roster]);
  const missingFor = (row: Roster) => MISSING_CHECKS.filter((check) => !check.of(row));

  const counts = {
    All: all.length,
    Confirmed: all.filter((row) => row.status === "confirmed").length,
    Incomplete: all.filter((row) => missingFor(row).length > 0).length,
    "Never signed in": all.filter((row) => row.portal_last_seen_at === null).length,
  } satisfies Record<View, number>;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = all.filter((row) => {
      if (view === "Confirmed" && row.status !== "confirmed") return false;
      if (view === "Incomplete" && missingFor(row).length === 0) return false;
      if (view === "Never signed in" && row.portal_last_seen_at !== null) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(row.status)) return false;
      if (missingFilter.length > 0) {
        const gaps = missingFor(row).map((check) => check.key);
        if (!missingFilter.some((key) => gaps.includes(key))) return false;
      }
      if (needle === "") return true;
      return `${row.name} ${row.email} ${row.company ?? ""}`.toLowerCase().includes(needle);
    });
    return [...rows].sort((a, b) => {
      const by =
        sortKey === "company"
          ? (a.company ?? "").localeCompare(b.company ?? "")
          : sortKey === "sessions"
            ? a.submission_count - b.submission_count
            : sortKey === "missing"
              ? missingFor(a).length - missingFor(b).length
              : a.name.localeCompare(b.name);
      return by * sortDir;
    });
  }, [all, query, view, statusFilter, missingFilter, sortKey, sortDir]);

  const open = openId === null ? null : (all.find((row) => row.id === openId) ?? null);
  const allSelected = filtered.length > 0 && filtered.every((row) => selected.includes(row.id));

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

  const exportCsv = () => {
    void download(`/events/${eventId}/speakers/export.csv`, "speakers.csv").catch(
      (error: Error) => toast(error.message),
    );
  };


  const screen: SpeakersData = {
    ...chrome,
    ...stripData(stats),

    rows: filtered.map((row) => {
      const gaps = missingFor(row);
      const isSelected = selected.includes(row.id);
      const status = STATUS[row.status] ?? STATUS.prospective!;
      const bar = (index: number) =>
        index < MISSING_CHECKS.length - gaps.length
          ? "var(--ok,#0E7A5F)"
          : "var(--ln,#E1E7E9)";
      return {
        n: row.name,
        c: row.company ?? "—",
        ini: initials(row.name),
        st: status.label,
        stFg: status.fg,
        stBg: status.bg,
        sess: row.submission_count,
        frac: `${MISSING_CHECKS.length - gaps.length}/${MISSING_CHECKS.length}`,
        miss: gaps.map((gap) => ({ t: gap.label })),
        clean: gaps.length === 0,
        b1: bar(0),
        b2: bar(1),
        b3: bar(2),
        b4: "var(--ln,#E1E7E9)",
        b5: "var(--ln,#E1E7E9)",
        b6: "var(--ln,#E1E7E9)",
        seen:
          row.portal_last_seen_at === null
            ? "never"
            : DAY.format(new Date(row.portal_last_seen_at)),
        seenFg:
          row.portal_last_seen_at === null ? "var(--cn,#D8432B)" : "var(--i3,#6B7B84)",
        bg: isSelected
          ? "var(--sw,#FFEAE6)"
          : hover === row.id
            ? "var(--sk,#EDF1F2)"
            : "transparent",
        ring: openId === row.id ? "inset 2px 0 0 var(--sg,#E04E4E)" : "none",
        ...check(isSelected),
        ckBd: isSelected ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)",
        onChk: (event: React.SyntheticEvent) => {
          event.stopPropagation();
          setSelected((current) =>
            current.includes(row.id)
              ? current.filter((entry) => entry !== row.id)
              : [...current, row.id],
          );
        },
        onEnter: () => setHover(row.id),
        onOpen: () => setOpenId(row.id),
      };
    }),

    views: (Object.keys(counts) as View[]).map((name) => ({
      n: name,
      c: counts[name],
      on: () => setView(name),
      bg: view === name ? "var(--sw,#FFEAE6)" : "transparent",
      bd: view === name ? "var(--sl,#FFC9C0)" : "transparent",
      fg: view === name ? "var(--sg,#E04E4E)" : "var(--i3,#6B7B84)",
    })),
    tAllS: tile("All"),
    // The tile is labelled "Complete", so it counts people with nothing missing
    // rather than a participation status.
    tDoneS: {
      ...tile("Confirmed"),
      c: all.length - counts.Incomplete,
    },
    tMiss: tile("Incomplete"),
    tOdS: tile("Never signed in"),
    tOdLabel: "Never signed in",

    q: query,
    onQ: (event: React.SyntheticEvent) => setQuery((event.target as HTMLInputElement).value),
    countLine: `${filtered.length} of ${all.length} people`,
    headerNote: `${counts.Confirmed} confirmed · ${counts.Incomplete} need chasing`,
    sumLine: `${all.length} on the roster · ${counts.Incomplete} with something missing · ${counts["Never signed in"]} have never signed in`,
    rowH: "44px",

    soName: sorter("name"),
    soCompany: sorter("company"),
    soSess: sorter("sessions"),
    soMissing: sorter("missing"),

    togFPop: () => setFilterPop((on) => !on),
    closeFPop: () => setFilterPop(false),
    fPopOn: filterPop,
    fStatusOpts: Object.keys(STATUS).map((key) => ({
      n: STATUS[key]!.label,
      ...check(statusFilter.includes(key)),
      on: () =>
        setStatusFilter((current) =>
          current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
        ),
    })),
    fMissOpts: MISSING_CHECKS.map((entry) => ({
      n: entry.label,
      ...check(missingFilter.includes(entry.key)),
      on: () =>
        setMissingFilter((current) =>
          current.includes(entry.key)
            ? current.filter((key) => key !== entry.key)
            : [...current, entry.key],
        ),
    })),
    missChips: [...statusFilter, ...missingFilter].map((key) => ({
      t: STATUS[key]?.label ?? MISSING_CHECKS.find((entry) => entry.key === key)?.label ?? key,
      on: () => {
        setStatusFilter((current) => current.filter((entry) => entry !== key));
        setMissingFilter((current) => current.filter((entry) => entry !== key));
      },
      bg: "var(--sk,#EDF1F2)",
      bd: "var(--ln,#E1E7E9)",
    })),
    fCount: statusFilter.length + missingFilter.length,
    fBg: filterPop ? "var(--sw,#FFEAE6)" : "var(--cd,#FFFFFF)",
    fFg: filterPop ? "var(--sg,#E04E4E)" : "var(--i2,#3E4E58)",
    fBd: filterPop ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)",
    clearF: () => {
      setStatusFilter([]);
      setMissingFilter([]);
    },
    clearFilters: () => {
      setStatusFilter([]);
      setMissingFilter([]);
      setQuery("");
      setView("All");
    },

    selN: selected.length,
    hasSel: selected.length > 0,
    allCk: allSelected ? "✓" : "",
    allCkBg: allSelected ? "var(--sg,#E04E4E)" : "var(--cd,#FFFFFF)",
    selAll: () => setSelected(allSelected ? [] : filtered.map((row) => row.id)),
    clearSel: () => setSelected([]),
    clearHover: () => setHover(null),
    bulkNudge: () =>
      toast("Speaker reminders need the tasks feature, which is not built yet."),
    bulkTask: () => toast("Task assignment is not built yet."),
    bulkLink: () =>
      toast(`${selected.length} magic links would go out. Sending is not wired yet.`),
    exportCsv,

    empty: all.length === 0,

    open: open !== null,
    closeDrawer: () => setOpenId(null),
    o: {
      n: open?.name ?? "",
      ini: open === null ? "" : initials(open.name),
      c: open?.company ?? "—",
      email: open?.email ?? "",
      missN: open === null ? 0 : missingFor(open).length,
      sessT: `${open?.submission_count ?? 0} proposal${open?.submission_count === 1 ? "" : "s"}`,
      sessMeta: open?.bio ?? "No bio yet.",
      // Tasks and files need the deliverables feature, which is not built.
      tasks: [],
      files: [],
      noFiles: true,
      notes: openId === null ? [] : (notes[openId] ?? []),
    },
    tabs: (["sessions", "tasks", "files", "notes"] as const).map((key) => ({
      n: key[0]!.toUpperCase() + key.slice(1),
      on: () => setTab(key),
      fg: tab === key ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
      ul: tab === key ? "2px solid var(--sg,#E04E4E)" : "2px solid transparent",
      wt: tab === key ? "600" : "500",
    })),
    tabSessions: tab === "sessions",
    tabTasks: tab === "tasks",
    tabFiles: tab === "files",
    tabNotes: tab === "notes",
    noteDraft,
    onNoteDraft: (event: React.SyntheticEvent) =>
      setNoteDraft((event.target as HTMLTextAreaElement).value),
    addNote: () => {
      if (openId === null || noteDraft.trim() === "") return;
      setNotes((current) => ({
        ...current,
        [openId]: [...(current[openId] ?? []), { a: "You", t: noteDraft.trim(), x: "just now" }],
      }));
      setNoteDraft("");
    },
    dNudge: () => {
      if (open === null) return;
      setStatus.mutate({ id: open.id, status: "confirmed" });
    },

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

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) importCsv.mutate(file);
          event.target.value = "";
        }}
      />
      <Speakers d={screen} />
    </>
  );
}
