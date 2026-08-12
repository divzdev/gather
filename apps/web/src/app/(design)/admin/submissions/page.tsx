"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";

import { openCommandPalette } from "@/components/console/CommandPalette";
import { useConsoleChrome } from "@/components/console/chrome";
import { stripData, useProgramStats } from "@/components/console/stats";
import { Submissions, type SubmissionsData } from "@/components/design/Submissions";
import type { Note, Outcome } from "@/components/console/SubmissionPanels";
import { Pager, StatusTabs } from "@/components/ui";
import { useHotkeys } from "@/lib/hotkeys";
import { authed, download } from "@/lib/session";

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
  submitted: {
    label: "Submitted",
    fg: "var(--if,#47599F)",
    bg: "var(--ifw,#E9ECF7)",
    dot: "#47599F",
  },
  in_review: {
    label: "In review",
    fg: "var(--pd,#B96A1F)",
    bg: "var(--pdw,#F9EDDF)",
    dot: "#B96A1F",
  },
  accepted: {
    label: "Accepted",
    fg: "var(--ok,#0E7A5F)",
    bg: "var(--okw,#E2F1EC)",
    dot: "#0E7A5F",
  },
  waitlisted: {
    label: "Waitlisted",
    fg: "var(--pd,#B96A1F)",
    bg: "var(--pdw,#F9EDDF)",
    dot: "#B96A1F",
  },
  rejected: { label: "Rejected", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)", dot: "#6B7B84" },
  withdrawn: {
    label: "Withdrawn",
    fg: "var(--i3,#6B7B84)",
    bg: "var(--sk,#EDF1F2)",
    dot: "#6B7B84",
  },
} as const;

type StatusKey = keyof typeof STATUS;
const DECIDABLE = ["accepted", "waitlisted", "rejected"] as const;

/** Track colours in the prototype's order; the API hands back a hue index. */
const TRACK_HUES = ["#3E8896", "#A85788", "#5A6BA8", "#7E5CB8", "#C4703A", "#34526B"];

type View = "All" | "Needs review" | "Ready to decide" | "Accepted";
type SortKey = "title" | "score" | "date";

/** What each saved view asks the server for. Three are a set of statuses;
 *  "Ready to decide" is the one that is not — in review *and* scored by
 *  somebody, which the API answers with `filter[reviewed]`. */
const VIEW: Record<View, { status: readonly StatusKey[]; reviewed?: true }> = {
  All: { status: [] },
  "Needs review": { status: ["submitted", "in_review"] },
  "Ready to decide": { status: ["in_review"], reviewed: true },
  Accepted: { status: ["accepted"] },
};

const SORT_FIELD: Record<SortKey, string> = {
  title: "title",
  score: "score_avg",
  date: "submitted_at",
};

/** The API's ceiling, and the export endpoint's id cap. */
const MAX_PER_PAGE = 200;
const EXPORT_LIMIT = 1000;

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
  const { toasts, toast, dismiss } = useConsoleChrome();
  const queryClient = useQueryClient();
  const { stats, eventId } = useProgramStats();

  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("All");
  /** Track ids, not names: the server filters by id, and two tracks are allowed
   *  to read alike to a human where they can never share an id. */
  const [trackFilter, setTrackFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusKey[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [selected, setSelected] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [dense, setDense] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  // ?open=<id> so a proposal can be linked to — from the command palette, or
  // from one organiser to another in chat.
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(useSearchParams().get("open"));
  const [popover, setPopover] = useState<"track" | "status" | "switch" | "help" | null>(null);
  const [hideBanner, setHideBanner] = useState(false);

  // Search is the server's job now, so a keystroke is a request. Deferring it
  // keeps the field responsive and collapses a burst of typing into one fetch.
  const search = useDeferredValue(query.trim());

  /** The statuses the view and the status pills agree on. The pills refine the
   *  view rather than replace it, so "Accepted" inside "Needs review" is an
   *  empty answer — and an empty answer is not the same as no filter, which
   *  would ask the server for everything. */
  const wanted = useMemo(() => {
    const fromView = VIEW[view].status;
    if (fromView.length === 0)
      return { statuses: statusFilter as readonly StatusKey[], none: false };
    if (statusFilter.length === 0) return { statuses: fromView, none: false };
    const both = fromView.filter((key) => statusFilter.includes(key));
    return { statuses: both, none: both.length === 0 };
  }, [view, statusFilter]);

  /** Everything the list is filtered, sorted and paged by, in one string — so
   *  it is both the request and the cache key, and the two cannot drift. */
  const listQuery = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      sort: `${sortDir === -1 ? "-" : ""}${SORT_FIELD[sortKey]}`,
    });
    if (wanted.statuses.length > 0) params.set("filter[status]", wanted.statuses.join(","));
    if (VIEW[view].reviewed === true) params.set("filter[reviewed]", "true");
    if (trackFilter.length > 0) params.set("filter[track_id]", trackFilter.join(","));
    if (search !== "") params.set("q", search);
    return params.toString();
  }, [page, perPage, sortKey, sortDir, wanted, view, trackFilter, search]);

  const { data, isPending } = useQuery({
    queryKey: ["submissions", eventId, listQuery],
    enabled: eventId !== null && !wanted.none,
    // Hold the page already on screen while the next one loads. Blanking the
    // table on every page click is how a fast list comes to feel slow.
    placeholderData: (previous) => previous,
    queryFn: () =>
      authed<{ data: Submission[]; meta: { total: number; pages: number } }>(
        `/events/${eventId}/submissions?${listQuery}`,
      ),
  });

  /** Tracks and formats change on the Program screen, not on this one, so they
   *  are not re-fetched every time somebody turns a page. */
  const { data: taxonomy } = useQuery({
    queryKey: ["program-taxonomy", eventId],
    enabled: eventId !== null,
    staleTime: 300_000,
    queryFn: async () => {
      const [tracks, formats] = await Promise.all([
        authed<Named[]>(`/events/${eventId}/tracks?per_page=100`),
        authed<Named[]>(`/events/${eventId}/session-formats?per_page=100`),
      ]);
      return { tracks, formats };
    },
  });

  /** Internal notes were held in React state and never persisted — every note
   *  an organiser wrote was lost on reload while the endpoint sat unused. */
  const { data: openNotes } = useQuery({
    queryKey: ["submission-notes", eventId, openId],
    enabled: eventId !== null && openId !== null,
    queryFn: () => authed<Note[]>(`/events/${eventId}/submissions/${openId}/notes`),
  });

  const addNote = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      authed(`/events/${eventId}/submissions/${id}/notes`, { method: "POST", body: { body } }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["submission-notes", eventId, openId] }),
  });

  const decide = useMutation({
    mutationFn: async ({
      ids,
      outcome,
      reason,
    }: {
      ids: string[];
      outcome: string;
      reason?: string;
    }) => {
      if (ids.length === 1) {
        await authed(`/events/${eventId}/submissions/${ids[0]}/decision`, {
          method: "POST",
          body: { outcome, reason: reason ?? null },
        });
        return;
      }
      await authed(`/events/${eventId}/submissions/bulk-decision`, {
        method: "POST",
        body: { submission_ids: ids, outcome, reason: reason ?? null },
      });
    },
    onSuccess: (_result, { ids, outcome }) => {
      void queryClient.invalidateQueries({ queryKey: ["submissions", eventId] });
      // The strip, the rail badges and Overview all read program-stats.
      void queryClient.invalidateQueries({ queryKey: ["program-stats", eventId] });
      // The reason lands in the notes thread, so it has to refetch too.
      void queryClient.invalidateQueries({ queryKey: ["submission-notes", eventId, openId] });
      const label = STATUS[outcome as StatusKey]?.label.toLowerCase() ?? outcome;
      toast(
        `${ids.length} ${ids.length === 1 ? "proposal" : "proposals"} marked ${label}. Nothing is emailed until you send.`,
      );
      setSelected([]);
    },
    onError: (error: Error) => toast(error.message),
  });

  /** One page of matches, already filtered and sorted by the database. */
  const rows = wanted.none ? [] : (data?.data ?? []);
  const total = wanted.none ? 0 : (data?.meta.total ?? 0);
  const loading = isPending && !wanted.none;

  const trackById = useMemo(
    () => new Map((taxonomy?.tracks ?? []).map((track) => [track.id, track])),
    [taxonomy],
  );
  const formatById = useMemo(
    () => new Map((taxonomy?.formats ?? []).map((format) => [format.id, format])),
    [taxonomy],
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

  /** Counted by the database across the whole event, not by whatever page is on
   *  screen — these tiles used to read off a 200-row slice and quietly stop
   *  there on a 608-submission event. */
  const counts = {
    All: stats.total,
    "Needs review": stats.byStatus.submitted + stats.byStatus.in_review,
    "Ready to decide": stats.readyToDecide,
    Accepted: stats.byStatus.accepted,
  } satisfies Record<View, number>;

  /** A row can be linked to (`?open=<id>`) while sitting on a page nobody is
   *  looking at, so the drawer fetches it rather than searching the page. */
  const { data: linked } = useQuery({
    queryKey: ["submission", eventId, openId],
    enabled: eventId !== null && openId !== null && !rows.some((row) => row.id === openId),
    queryFn: () => authed<Submission>(`/events/${eventId}/submissions/${openId}`),
  });

  const open = openId === null ? null : (rows.find((row) => row.id === openId) ?? linked ?? null);
  const allSelected = rows.length > 0 && rows.every((row) => selected.includes(row.id));

  /** The same shortcuts the header advertises here — "j / k to move · x selects
   *  · Enter opens" — sharing `lib/hotkeys.ts` with the review queue and the
   *  roster. `hover` is the cursor, so the highlight the mouse draws and the one
   *  the keyboard draws are the same highlight.
   *
   *  Off while the drawer or any popover is open, so the list never moves behind
   *  something the reader is looking at.
   */
  const step = (delta: number) => {
    if (rows.length === 0) return;
    const at = rows.findIndex((row) => row.id === hover);
    const next = at < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, at + delta));
    setHover(rows[next]!.id);
  };

  useHotkeys(
    [
      { key: "j", run: () => step(1) },
      { key: "k", run: () => step(-1) },
      {
        key: "x",
        run: () => {
          if (hover === null) return;
          setSelected((current) =>
            current.includes(hover) ? current.filter((id) => id !== hover) : [...current, hover],
          );
        },
      },
      { key: "Enter", run: () => hover !== null && setOpenId(hover) },
    ],
    openId === null && popover === null,
  );

  /** Changing what is being looked at returns you to its first page — page 12
   *  of a filter that now has three matches is an empty screen. */
  const refilter = (change: () => void) => {
    change();
    setPage(1);
  };

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  /** What "export" means once the list is paged: the rows you ticked, or — if
   *  you ticked none — every row matching the filter, which is emphatically not
   *  the twenty-five in front of you. The endpoint takes ids, so the rest of
   *  the matches are fetched a full page at a time. */
  const idsForExport = async (): Promise<string[] | null> => {
    if (selected.length > 0) return selected;
    if (total > EXPORT_LIMIT) {
      toast(
        `${total} rows is more than one export can carry. Narrow the filter, or tick the rows you want.`,
      );
      return null;
    }
    const slices = await Promise.all(
      Array.from({ length: Math.ceil(total / MAX_PER_PAGE) }, (_, index) => {
        const params = new URLSearchParams(listQuery);
        params.set("per_page", String(MAX_PER_PAGE));
        params.set("page", String(index + 1));
        return authed<{ data: { id: string }[] }>(`/events/${eventId}/submissions?${params}`);
      }),
    );
    return slices.flatMap((slice) => slice.data.map((row) => row.id));
  };

  /** Both formats are built server-side from the same ids, so the CSV and the
   *  workbook can never disagree about what "export" contains. */
  const exportAs = (extension: "csv" | "xlsx") => async () => {
    try {
      const ids = await idsForExport();
      if (ids === null) return;
      if (ids.length === 0) {
        toast("Nothing to export — no rows match the current filter.");
        return;
      }
      await download(
        `/events/${eventId}/submissions/export.${extension}`,
        `submissions.${extension}`,
        ids,
      );
      toast(`Exported ${ids.length} ${ids.length === 1 ? "proposal" : "proposals"}.`);
    } catch (error) {
      toast((error as Error).message);
    }
  };
  const exportCsv = exportAs("csv");
  const exportXlsx = exportAs("xlsx");

  /** A number the console can vouch for, or a dash. Same reasoning as the
   *  programme strip: 0 is a claim, and "no submissions, nothing awaiting
   *  review, nothing accepted" is a false one to make while the counts are
   *  still in flight. */
  const known = (value: number) => (stats.ready ? value : "—");

  const tile = (name: View) => ({
    c: known(counts[name]),
    on: () => refilter(() => setView(name)),
    bd: view === name ? "var(--sg,#E04E4E)" : "var(--ln,#E1E7E9)",
    ring: view === name ? "0 0 0 3px var(--sw,#FFEAE6)" : "0 1px 2px rgba(13,16,32,.04)",
    numFg: view === name ? "var(--sg,#E04E4E)" : "var(--ik,#16232B)",
  });

  const sorter = (key: SortKey) => ({
    on: () =>
      refilter(() => {
        if (sortKey === key) setSortDir((dir) => (dir === 1 ? -1 : 1));
        else {
          setSortKey(key);
          setSortDir(1);
        }
      }),
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
    publicHref: stats.event === null ? "/admin" : `/e/${stats.event.slug}`,
    ...stripData(stats),
    pendingCount: known(stats.pendingSend),

    rows: rows.map((row) => {
      const status = statusOf(row);
      const isSelected = selected.includes(row.id);
      const value = score(row);
      const filled = value === null ? 0 : Math.round(value);
      const segment = (n: number) => (n <= filled ? "var(--i2,#3E4E58)" : "var(--ln,#E1E7E9)");
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

    /* Three tiles, not four. "In the pipeline 214" and "Accepted 61" were the
     * All and Accepted tabs restated forty pixels away in a second visual
     * language — the same number twice is not emphasis, it is indecision. What
     * is left are the three queues an organiser actually works, none of which a
     * status tab can express: waiting on a reviewer, scored and waiting on you,
     * and decided but still sitting in the outbox. */
    vNeed: tile("Needs review"),
    vReady: tile("Ready to decide"),
    vAcc: {
      c: known(stats.pendingSend),
      // Not a filter: the list cannot show this, because deciding and sending
      // are different columns and only Messages can release them.
      on: () => router.push("/admin/messages"),
      bd: stats.pendingSend > 0 ? "var(--pdl,#EBCDA9)" : "var(--ln,#E1E7E9)",
      ring: "0 1px 2px rgba(13,16,32,.04)",
      numFg: stats.pendingSend > 0 ? "var(--pd,#B96A1F)" : "var(--ik,#16232B)",
    },

    trackOpts: (taxonomy?.tracks ?? []).map((track) => ({
      n: track.name,
      col: TRACK_HUES[((track.hue_index ?? 1) - 1) % TRACK_HUES.length] ?? TRACK_HUES[0]!,
      ...check(trackFilter.includes(track.id)),
      on: () =>
        refilter(() =>
          setTrackFilter((current) =>
            current.includes(track.id)
              ? current.filter((x) => x !== track.id)
              : [...current, track.id],
          ),
        ),
    })),
    statusOpts: (Object.keys(STATUS) as StatusKey[]).map((key) => ({
      n: STATUS[key].label,
      dot: STATUS[key].dot,
      ...check(statusFilter.includes(key)),
      on: () =>
        refilter(() =>
          setStatusFilter((current) =>
            current.includes(key) ? current.filter((x) => x !== key) : [...current, key],
          ),
        ),
    })),
    chips: [
      ...trackFilter.map((id) => ({
        t: `Track: ${trackById.get(id)?.name ?? "unknown"}`,
        on: () => refilter(() => setTrackFilter((current) => current.filter((x) => x !== id))),
      })),
      ...statusFilter.map((key) => ({
        t: `Status: ${STATUS[key].label}`,
        on: () => refilter(() => setStatusFilter((current) => current.filter((x) => x !== key))),
      })),
    ],
    hasChips: trackFilter.length + statusFilter.length > 0,
    clearFilters: () =>
      refilter(() => {
        setTrackFilter([]);
        setStatusFilter([]);
        setQuery("");
        setView("All");
      }),
    trackCountLabel: trackFilter.length > 0 ? `(${trackFilter.length})` : "",
    statusCountLabel: statusFilter.length > 0 ? `(${statusFilter.length})` : "",

    q: query,
    onQ: (event: React.SyntheticEvent) =>
      refilter(() => setQuery((event.target as HTMLInputElement).value)),
    focusSearch: openCommandPalette,
    // The pager beneath already says "1 — 25 of 41". What it cannot say is what
    // the filter cut away, which is the number somebody is checking for.
    countLine: total === stats.total ? "" : `filtered from ${stats.total}`,
    // A tab per status, always visible, always counted. The four tiles above
    // are cross-status views of the same list; these are the list's own states,
    // and picking one replaces whatever the popover had set rather than
    // intersecting with it — a tab that can return nothing is not a tab.
    statusTabs: (
      <StatusTabs
        allCount={known(stats.total)}
        active={statusFilter.length === 1 ? (statusFilter[0] ?? null) : null}
        tabs={(Object.keys(STATUS) as StatusKey[]).map((key) => ({
          key,
          label: STATUS[key].label,
          count: known(stats.byStatus[key]),
        }))}
        onSelect={(key) =>
          refilter(() => {
            setStatusFilter(key === null ? [] : [key as StatusKey]);
            setView("All");
          })
        }
      />
    ),
    pager: (
      <Pager
        page={page}
        perPage={perPage}
        total={total}
        noun="proposals"
        onPage={setPage}
        onPerPage={(next) => refilter(() => setPerPage(next))}
      />
    ),
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
    // The page you can see, not every match: ticking 25 rows and silently
    // deciding 608 is the accident this product is built to prevent.
    selAll: () => setSelected(allSelected ? [] : rows.map((row) => row.id)),
    clearSel: () => setSelected([]),
    clearHover: () => setHover(null),
    bulkAcc: () => decide.mutate({ ids: selected, outcome: "accepted" }),
    bulkWait: () => decide.mutate({ ids: selected, outcome: "waitlisted" }),
    bulkRej: () => decide.mutate({ ids: selected, outcome: "rejected" }),
    bulkAssign: () => toast("Reviewer assignment lives on the Review screen."),
    exportCsv,
    exportXlsx,

    firstRun: false,
    // An impossible combination — "Accepted" ticked inside "Needs review" —
    // never fires a request, so the query stays pending forever. That is an
    // answer, not a wait: show the empty state rather than a blank screen.
    showTable: !loading,
    empty: !loading && rows.length === 0,

    // The banner is the decision/send separation: decisions are recorded here,
    // and nothing reaches a speaker until it is sent from Messages.
    banner: !hideBanner && stats.pendingSend > 0,
    bannerX: () => setHideBanner(true),
    // Was a toast naming the screen it would not take you to.
    bannerGo: () => router.push("/admin/messages"),

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
      notes: openNotes ?? [],
      decision: DECIDABLE.includes(open?.status as (typeof DECIDABLE)[number])
        ? (open?.status as Outcome)
        : null,
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
    onDecide: (outcome: Outcome, reason: string) =>
      openId === null
        ? Promise.resolve()
        : decide.mutateAsync({ ids: [openId], outcome, reason }),
    decisionBusy: decide.isPending,
    onAddNote: (body: string) =>
      openId === null ? Promise.resolve() : addNote.mutateAsync({ id: openId, body }),
    notesBusy: addNote.isPending,

    onCoord: () => toast("Coordinator notes stay internal; speakers never see them."),

    togTrack: () => setPopover((current) => (current === "track" ? null : "track")),
    togStatus: () => setPopover((current) => (current === "status" ? null : "status")),
    togHelp: () => setPopover((current) => (current === "help" ? null : "help")),
    closePop: () => setPopover(null),
    popTrack: popover === "track",
    popStatus: popover === "status",
    popHelp: popover === "help",

    hsAll: () => refilter(() => setView("All")),
    hsUnrev: () => refilter(() => setView("Needs review")),
    hsDecided: () => refilter(() => setView("Accepted")),
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
