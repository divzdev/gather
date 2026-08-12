"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { SideDrawer } from "@/components/console/SideDrawer";
import { useConsoleChrome } from "@/components/console/chrome";
import { stripData, useProgramStats } from "@/components/console/stats";
import { Speakers, type SpeakersData } from "@/components/design/Speakers";
import { API_BASE_URL } from "@/lib/api";
import { authed, blobUrl, download, getToken } from "@/lib/session";
import { Pager, pill, quietPill } from "@/components/ui";
import { useHotkeys } from "@/lib/hotkeys";

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
  headshot_file_id: string | null;
};

type Named = { id: string; name: string };

type SessionRow = {
  id: string;
  title: string;
  starts_at: string | null;
  room_id: string | null;
  event_day_id: string | null;
  duration_minutes: number;
  speakers: { id: string; name: string; role: string }[];
};

type TaskRow = {
  id: string;
  speaker_id: string;
  task_name: string;
  status: string;
  due_at: string | null;
  file_count: number;
};

type SpeakerFile = {
  id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  version: number;
  uploaded_at: string;
  label: string;
  is_headshot: boolean;
};

const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  prospective: { label: "Prospective", fg: "var(--if,#47599F)", bg: "var(--ifw,#E9ECF7)" },
  accepted: { label: "Accepted", fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)" },
  confirmed: { label: "Confirmed", fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)" },
  declined: { label: "Declined", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)" },
  withdrawn: { label: "Withdrawn", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)" },
};

/** The profile fields a speaker fills in themselves. Deliverables are added to
 *  these at render time from the event's task list — see `missingFor`. */
const MISSING_CHECKS = [
  { key: "bio", label: "Bio", of: (row: Roster) => (row.bio ?? "").trim() !== "" },
  { key: "company", label: "Company", of: (row: Roster) => (row.company ?? "").trim() !== "" },
  { key: "role", label: "Job title", of: (row: Roster) => (row.job_title ?? "").trim() !== "" },
];

type View = "All" | "Confirmed" | "Incomplete" | "Never signed in";
type SortKey = "name" | "company" | "sessions" | "missing";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** Session times are `timestamptz` and the browser's zone is not the event's,
 *  so these are read in UTC — the same reasoning as the event-day rows. */
const WHEN = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

/** The stripe down a task row. Overdue is the only one worth alarming about;
 *  the rest are progress, not problems. */
const TASK_TONE: Record<string, string> = {
  overdue: "var(--cn,#D8432B)",
  complete: "var(--ok,#0E7A5F)",
  submitted: "var(--if,#47599F)",
  pending: "var(--ln,#E1E7E9)",
};

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function SpeakersPage() {
  const { toasts, toast, dismiss } = useConsoleChrome();
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
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", email: "", company: "", job_title: "" });
  const [addError, setAddError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [notes, setNotes] = useState<Record<string, { a: string; t: string; x: string }[]>>({});

  const { data: roster } = useQuery({
    queryKey: ["roster", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Roster[]>(`/events/${eventId}/speakers`),
  });

  // Only for the speaker whose drawer is open: fetching a file list per row
  // would be eighty requests to render a table.
  const { data: files } = useQuery({
    queryKey: ["speaker-files", eventId, openId],
    enabled: eventId !== null && openId !== null,
    queryFn: () => authed<SpeakerFile[]>(`/events/${eventId}/speakers/${openId}/files`),
  });

  /** What this person is actually doing at the conference, and what is still
   *  owed. Both were rendered as empty lists with a comment claiming the
   *  feature was unbuilt — the endpoints have been there all along. Shared
   *  query keys, so opening a drawer costs nothing the console has not already
   *  paid for. */
  const { data: programme } = useQuery({
    queryKey: ["event-sessions", eventId],
    enabled: eventId !== null && openId !== null,
    staleTime: 60_000,
    queryFn: async () => {
      const [sessions, rooms] = await Promise.all([
        authed<SessionRow[]>(`/events/${eventId}/sessions`),
        authed<Named[]>(`/events/${eventId}/rooms?per_page=100`),
      ]);
      return { sessions, rooms };
    },
  });

  /** Every speaker's outstanding deliverables, in one request rather than one
   *  per row — which is what made this column lie in the first place. */
  const { data: taskRows } = useQuery({
    queryKey: ["task-summary", eventId],
    enabled: eventId !== null,
    staleTime: 60_000,
    queryFn: () => authed<TaskRow[]>(`/events/${eventId}/tasks/summary`),
  });

  /** The headshot itself, not a placeholder for one.
   *
   *  The download route wants an Authorization header and an `<img src>` cannot
   *  send one, so the bytes are fetched and handed to the tag as an object URL.
   *  Only for the open drawer — eighty of these to draw a table would be worse
   *  than the initials it falls back to. */
  const headshotId =
    openId === null
      ? null
      : ((roster ?? []).find((row) => row.id === openId)?.headshot_file_id ?? null);
  const { data: headshot } = useQuery({
    queryKey: ["headshot", eventId, headshotId],
    enabled: eventId !== null && headshotId !== null,
    staleTime: Infinity,
    queryFn: () => blobUrl(`/events/${eventId}/files/${headshotId}/download`),
  });

  /** Chase the speakers who still owe something.
   *
   *  `POST /tasks/nudge` takes speaker ids and returns what it sent and what it
   *  skipped — a nudge has a 24-hour floor per speaker per task, so asking twice
   *  in an afternoon quietly sends nothing. Reporting the skipped count is the
   *  difference between "nothing happened" and "nothing needed to happen".
   */
  const nudge = useMutation({
    mutationFn: (speakerIds: string[]) =>
      authed<{ sent: number; skipped: number }>(`/events/${eventId}/tasks/nudge`, {
        method: "POST",
        body: { speaker_ids: speakerIds },
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["task-summary", eventId] });
      toast(
        result.sent === 0
          ? `Nothing sent — all ${result.skipped} were nudged in the last 24 hours.`
          : `${result.sent} reminder${result.sent === 1 ? "" : "s"} sent.` +
              (result.skipped > 0 ? ` ${result.skipped} skipped, nudged within 24 hours.` : ""),
      );
    },
    onError: (error: Error) => toast(error.message),
  });

  // A speaker's status (prospective → confirmed → declined) is a real organiser
  // action and `PATCH /events/:id/speakers/:id` supports it, but no control on
  // this screen offers it — the mutation's only caller was the nudge button
  // that was firing it by mistake. Left out rather than invented here, so the
  // control gets designed in the UI pass rather than bolted on.

  /** The roster had no way to add anybody. `POST /events/:id/speakers` has
   *  existed since the first migration, but the only routes onto the roster
   *  from the console were a CSV import and accepting a submission — so an
   *  invited keynote, the one speaker who never submits anything, could not be
   *  put on the list at all. */
  const addSpeaker = useMutation({
    mutationFn: () =>
      authed(`/events/${eventId}/speakers`, {
        method: "POST",
        body: {
          name: draft.name.trim(),
          email: draft.email.trim(),
          // The API forbids unknown fields and rejects an empty string where it
          // wants null, so blanks are dropped rather than sent.
          company: draft.company.trim() === "" ? null : draft.company.trim(),
          job_title: draft.job_title.trim() === "" ? null : draft.job_title.trim(),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["roster", eventId] });
      toast(`${draft.name.trim()} is on the roster.`);
      setDraft({ name: "", email: "", company: "", job_title: "" });
      setAddError(null);
      setAdding(false);
    },
    onError: (error: Error) => setAddError(error.message),
  });

  const submitSpeaker = () => {
    if (draft.name.trim() === "") return setAddError("A speaker needs a name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email.trim())) {
      return setAddError("That does not look like an email address.");
    }
    setAddError(null);
    return addSpeaker.mutate();
  };

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
  /** Required deliverables nobody has sent yet, per speaker. */
  const owedBySpeaker = useMemo(() => {
    const owed = new Map<string, string[]>();
    for (const task of taskRows ?? []) {
      if (task.status === "complete" || task.file_count > 0) continue;
      owed.set(task.speaker_id, [...(owed.get(task.speaker_id) ?? []), task.task_name]);
    }
    return owed;
  }, [taskRows]);

  /** What this speaker still owes.
   *
   *  The profile fields plus the deliverables. This column used to check bio,
   *  company and job title only, and report "complete" for a speaker whose
   *  headshot task was weeks overdue — the exact opposite of what the column
   *  exists to say. Deliverables were left out because reading them looked like
   *  one request per row; `tasks/summary` returns the whole event at once.
   */
  const missingFor = useCallback(
    (row: Roster) => [
      ...MISSING_CHECKS.filter((check) => !check.of(row)),
      ...(owedBySpeaker.get(row.speaker_id) ?? []).map((name) => ({
        key: `task:${name}`,
        label: name,
      })),
    ],
    [owedBySpeaker],
  );

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
    // `missingFor` reads the task summary, so the list has to recompute when
    // that lands — without it the Incomplete view stays empty for a beat and
    // then never corrects itself.
  }, [all, query, view, statusFilter, missingFilter, sortKey, sortDir, missingFor]);

  /** The endpoint hands back the whole roster, so this pages what is already
   *  in hand — nothing is unreachable, but 595 rows in one scroll is not a
   *  list anybody can work. */
  const pageRows = filtered.slice((page - 1) * perPage, page * perPage);

  const open = openId === null ? null : (all.find((row) => row.id === openId) ?? null);

  /** This speaker's own sessions and tasks. Matched on `speaker_id` — the
   *  roster row's `id` is the participation in *this* event, not the person, and
   *  both of these endpoints key on the person. */
  const mySessions = useMemo(
    () =>
      open === null
        ? []
        : (programme?.sessions ?? []).filter((row) =>
            row.speakers.some((person) => person.id === open.speaker_id),
          ),
    [programme, open],
  );
  const myTasks = useMemo(
    () =>
      open === null ? [] : (taskRows ?? []).filter((row) => row.speaker_id === open.speaker_id),
    [taskRows, open],
  );
  const roomName = (id: string | null) =>
    id === null ? null : ((programme?.rooms ?? []).find((room) => room.id === id)?.name ?? null);
  /** When and where a session is, or that it is neither yet. */
  const whenAndWhere = (row: SessionRow) => {
    if (row.starts_at === null) return `${row.title} — unscheduled`;
    const room = roomName(row.room_id);
    return `${WHEN.format(new Date(row.starts_at))}${room === null ? "" : ` · ${room}`}`;
  };

  const allSelected = pageRows.length > 0 && pageRows.every((row) => selected.includes(row.id));

  /** The shortcuts the header has always advertised — "j / k to move · x
   *  selects · Enter opens" — which nothing implemented until now.
   *
   *  `hover` doubles as the keyboard cursor rather than a second piece of state:
   *  it already draws the row highlight, so the caret is visible for free and
   *  mouse and keyboard cannot disagree about which row is current.
   *
   *  Off while a drawer or the add sheet is open. Moving the list behind a modal
   *  is the kind of thing that looks like a bug even when it is deliberate.
   */
  const step = (delta: number) => {
    if (pageRows.length === 0) return;
    const at = pageRows.findIndex((row) => row.id === hover);
    const next = at < 0 ? 0 : Math.min(pageRows.length - 1, Math.max(0, at + delta));
    setHover(pageRows[next]!.id);
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
    openId === null && !adding,
  );

  /** Changing what is being looked at returns you to its first page. */
  const refilter = (change: () => void) => {
    change();
    setPage(1);
  };

  const check = (on: boolean) => ({
    ck: on ? "✓" : "",
    ckBg: on ? "var(--sg,#E04E4E)" : "var(--cd,#FFFFFF)",
  });
  const tile = (name: View) => ({
    c: counts[name],
    on: () => refilter(() => setView(name)),
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
    void download(`/events/${eventId}/speakers/export.csv`, "speakers.csv").catch((error: Error) =>
      toast(error.message),
    );
  };

  const screen: SpeakersData = {
    ...stripData(stats),

    rows: pageRows.map((row) => {
      const gaps = missingFor(row);
      const isSelected = selected.includes(row.id);
      const status = STATUS[row.status] ?? STATUS.prospective!;
      const bar = (index: number) =>
        index < MISSING_CHECKS.length - gaps.length ? "var(--ok,#0E7A5F)" : "var(--ln,#E1E7E9)";
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
        seenFg: row.portal_last_seen_at === null ? "var(--cn,#D8432B)" : "var(--i3,#6B7B84)",
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
      on: () => refilter(() => setView(name)),
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
    onQ: (event: React.SyntheticEvent) =>
      refilter(() => setQuery((event.target as HTMLInputElement).value)),
    // The pager already says "1 — 25 of 595". What it cannot say is how much
    // the filter removed, which is the number somebody is checking for.
    countLine: filtered.length === all.length ? "" : `filtered from ${all.length}`,
    headerNote: `${counts.Confirmed} confirmed · ${counts.Incomplete} need chasing`,
    headerAction: (
      <button type="button" style={pill} onClick={() => setAdding(true)}>
        + Add speaker
      </button>
    ),
    pager: (
      <Pager
        page={page}
        perPage={perPage}
        total={filtered.length}
        noun="people"
        onPage={setPage}
        onPerPage={(next) => refilter(() => setPerPage(next))}
      />
    ),
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
    // The profile fields, plus every deliverable this event actually asks for —
    // so "show me who still owes a headshot" is a filter rather than a scroll.
    fMissOpts: [
      ...MISSING_CHECKS.map((entry) => ({ key: entry.key, label: entry.label })),
      ...[...new Set((taskRows ?? []).map((task) => task.task_name))]
        .sort()
        .map((name) => ({ key: `task:${name}`, label: name })),
    ].map((entry) => ({
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
    selAll: () => setSelected(allSelected ? [] : pageRows.map((row) => row.id)),
    clearSel: () => setSelected([]),
    clearHover: () => setHover(null),
    // Claimed the tasks feature was unbuilt. It is built, and this drawer has
    // been rendering its rows since the same afternoon this toast survived.
    bulkNudge: () => {
      const ids = pageRows.filter((row) => selected.includes(row.id)).map((row) => row.speaker_id);
      if (ids.length === 0) return toast("Select the speakers you want to chase first.");
      return nudge.mutate(ids);
    },
    bulkTask: () => toast("Task assignment is not built yet."),
    bulkLink: () => toast(`${selected.length} magic links would go out. Sending is not wired yet.`),
    exportCsv,

    // See the same note on the sessions screen.
    empty: pageRows.length === 0,

    open: open !== null,
    closeDrawer: () => setOpenId(null),
    o: {
      n: open?.name ?? "",
      // The photograph when there is one, initials when there is not — the
      // fallback rather than the only state.
      ini:
        headshot === undefined ? (
          open === null ? (
            ""
          ) : (
            initials(open.name)
          )
        ) : (
          // next/image cannot take a blob: URL, and the bytes are already in
          // memory — the optimiser has nothing to do and no origin to fetch.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={headshot}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
          />
        ),
      // Who they are, not just where they work. Job title and pronouns were on
      // every roster row and shown on none of them.
      c: [open?.job_title, open?.company, open?.pronouns].filter(Boolean).join(" · ") || "—",
      email: open?.email ?? "",
      missN: open === null ? 0 : missingFor(open).length,
      sessT: mySessions.length === 0 ? "Not on the schedule yet" : mySessions[0]!.title,
      sessMeta:
        mySessions.length === 0
          ? `${open?.submission_count ?? 0} proposal${open?.submission_count === 1 ? "" : "s"} · nothing placed on the agenda`
          : mySessions.map(whenAndWhere).join("  ·  "),
      tasks: myTasks.map((task) => ({
        n: task.task_name,
        sub:
          task.file_count > 0
            ? `${task.file_count} file${task.file_count === 1 ? "" : "s"} received`
            : "Nothing received yet",
        bar: TASK_TONE[task.status] ?? "var(--ln,#E1E7E9)",
        due:
          task.due_at === null
            ? "no due date"
            : `${task.status === "overdue" ? "overdue · " : "due "}${DAY.format(new Date(task.due_at))}`,
        dueFg: task.status === "overdue" ? "var(--cn,#D8432B)" : "var(--i4,#99A6AD)",
        canDo: task.status !== "complete",
        onDone: () =>
          toast("Accepting a deliverable is done from the Tasks screen, where the file is."),
      })),
      files: (files ?? []).map((entry) => ({
        ext: entry.filename.split(".").pop()?.slice(0, 4).toUpperCase() ?? "FILE",
        // The design's row has no action slot, and the prototype cannot be
        // regenerated safely right now (the re-export drops five props), so the
        // name itself is the control. `n` is a ReactNode, so this is within the
        // contract rather than around it.
        n: (
          <button
            onClick={() => {
              void download(`/events/${eventId}/files/${entry.id}/download`, entry.filename).catch(
                (error: Error) => toast(error.message),
              );
            }}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              font: "500 12.5px var(--font-plex-sans), sans-serif",
              color: "var(--sg,#E04E4E)",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            {entry.label}
          </button>
        ),
        meta: `${entry.filename} · ${Math.max(1, Math.round(entry.byte_size / 1024))} KB · ${DAY.format(new Date(entry.uploaded_at))}`,
        v: `v${entry.version}`,
      })),
      // Was hardcoded true, so the Files tab reported an empty list while
      // holding a headshot and every deliverable the speaker had sent.
      noFiles: (files ?? []).length === 0,
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
    // Was `setStatus → "confirmed"`. A button labelled "Nudge about N missing
    // items" silently marked the speaker confirmed — a different verb, a
    // different noun, and no way to tell it had happened.
    dNudge: () => {
      if (open === null) return;
      nudge.mutate([open.speaker_id]);
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
      <SideDrawer
        open={adding}
        title="Add a speaker"
        subtitle="For the people who never submit anything — an invited keynote, a panellist, a late replacement. They join the roster as prospective and can be sent a portal link from there."
        onClose={() => setAdding(false)}
        footer={
          <>
            <button type="button" style={quietPill} onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button
              type="button"
              style={{ ...pill, opacity: addSpeaker.isPending ? 0.6 : 1 }}
              disabled={addSpeaker.isPending}
              onClick={submitSpeaker}
            >
              {addSpeaker.isPending ? "Adding…" : "Add speaker"}
            </button>
          </>
        }
      >
        <div style={{ display: "grid", gap: 16 }}>
          {(
            [
              { key: "name", label: "Full name", hint: "As it should appear in the programme." },
              {
                key: "email",
                label: "Email",
                hint: "Their identity here — this is where the portal link goes.",
              },
              { key: "company", label: "Company", hint: "Optional." },
              { key: "job_title", label: "Job title", hint: "Optional." },
            ] as const
          ).map((field) => (
            <div key={field.key} style={{ display: "grid", gap: 6 }}>
              {/* The hint sits outside the label and is tied on by
                  aria-describedby. Inside it, the field's accessible name
                  becomes "Email Their identity here — this is where the portal
                  link goes", which is what a screen reader would announce and
                  what a test would have to match. */}
              <label
                htmlFor={`speaker-${field.key}`}
                style={{ font: "600 12.5px var(--font-plex-sans)", color: "var(--ik)" }}
              >
                {field.label}
              </label>
              <input
                id={`speaker-${field.key}`}
                aria-describedby={`speaker-${field.key}-hint`}
                value={draft[field.key]}
                type={field.key === "email" ? "email" : "text"}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                }
                style={{
                  height: 38,
                  padding: "0 12px",
                  borderRadius: 9,
                  border: "1px solid var(--ls)",
                  background: "var(--cd)",
                  color: "var(--ik)",
                  font: "400 13.5px var(--font-plex-sans)",
                }}
              />
              <span
                id={`speaker-${field.key}-hint`}
                style={{ font: "400 11.5px var(--font-plex-sans)", color: "var(--i4)" }}
              >
                {field.hint}
              </span>
            </div>
          ))}
          {addError === null ? null : (
            <p
              role="alert"
              style={{ font: "500 12.5px var(--font-plex-sans)", color: "var(--cn)", margin: 0 }}
            >
              {addError}
            </p>
          )}
        </div>
      </SideDrawer>
    </>
  );
}
