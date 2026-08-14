"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useConsoleChrome } from "@/components/console/chrome";
import { stripData, useProgramStats } from "@/components/console/stats";
import { SideDrawer } from "@/components/console/SideDrawer";
import { Sessions, type SessionsData } from "@/components/design/Sessions";
import { Pager, pill, quietPill } from "@/components/ui";
import { authed, download } from "@/lib/session";

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
  tags: string[];
  expertise_level: string | null;
  language: string | null;
  speakers: { id: string; name: string; role: string }[];
};
type Named = { id: string; name: string; hue_index?: number };
type EventDayRow = { id: string; day_date: string };

const TRACK_HUES = ["#3E8896", "#A85788", "#5A6BA8", "#7E5CB8", "#C4703A", "#34526B"];

const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  unscheduled: { label: "Unscheduled", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)" },
  scheduled: { label: "Scheduled", fg: "var(--if,#47599F)", bg: "var(--ifw,#E9ECF7)" },
  confirmed: { label: "Confirmed", fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)" },
};

/** `datetime-local` inputs read and write "YYYY-MM-DDTHH:mm" in whatever
 *  timezone the browser is in — no `Z`, no offset. Round-tripping through
 *  `Date` keeps that local reading intact instead of drifting through UTC. */
function toLocalInputValue(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** "2027-05-12" -> "Wed 12 May". Built from the parts rather than parsed:
 *  `new Date("2027-05-12")` is UTC midnight, which renders as the 11th in every
 *  timezone west of Greenwich — the same class of bug that had the demo opening
 *  at 2am. */
function dayLabel(dayDate: string): string {
  const [year, month, day] = dayDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return dayDate;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Room and starts save through a different endpoint than everything else in
 *  the drawer (see the `place`/`unschedule` mutations below), so a Save that
 *  touches both kinds of field fires two requests — and each one must clear
 *  only the edits it actually persisted, or a mixed save silently drops
 *  whichever half didn't get a helper of its own. */
const PLACEMENT_KEYS = new Set(["room_id", "starts_at"]);
const withoutPlacementKeys = (edits: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(edits).filter(([key]) => !PLACEMENT_KEYS.has(key)));
const onlyPlacementKeys = (edits: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(edits).filter(([key]) => PLACEMENT_KEYS.has(key)));

type View = "All" | "Unscheduled" | "Scheduled" | "Needs approval";
type SortKey = "title" | "code" | "track" | "sched";
/** The fields worth setting across a selection. Title and abstract are not on
 *  this list on purpose — they are never the same across five talks. */
type BulkField = "track" | "format" | "approval";
type ImportedRow = { row: number; title: string; outcome: string; detail: string | null };

const IMPORT_EXAMPLE = `title,track,format,duration_minutes,speakers,abstract
Shipping on Fridays,Platform,Talk,30,Ada Lovelace <ada@example.com>,Why we stopped being scared of it
Type systems at scale,Platform,Workshop,90,Grace Hopper <grace@example.com>; Alan Kay <alan@example.com>,A hands-on session
`;

/** What the preview shows: the columns as read, with no interpretation. The
 *  server parses the file again and is the authority on what imports. */
function previewRows(raw: string): { t: string; tr: string; fmt: string; sp: string }[] {
  const [head, ...rest] = raw.trim().split(/\r?\n/);
  if (head === undefined) return [];
  const columns = head.split(",").map((name) => name.trim().toLowerCase());
  const at = (cells: string[], name: string) => cells[columns.indexOf(name)]?.trim() ?? "";

  return rest
    .filter((line) => line.trim() !== "")
    .slice(0, 50)
    .map((line) => {
      const cells = line.split(",");
      return {
        t: at(cells, "title"),
        tr: at(cells, "track"),
        fmt: at(cells, "format"),
        sp: at(cells, "speakers"),
      };
    });
}

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const fieldLabel = { font: "600 12.5px var(--font-plex-sans)", color: "var(--ik)" } as const;

const fieldInput = {
  height: 38,
  padding: "0 12px",
  borderRadius: 9,
  border: "1px solid var(--ls)",
  background: "var(--cd)",
  color: "var(--ik)",
  font: "400 13.5px var(--font-plex-sans)",
} as const;

export default function SessionsPage() {
  const { toasts, toast, dismiss } = useConsoleChrome();
  const { stats, eventId } = useProgramStats();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("All");
  const [trackFilter, setTrackFilter] = useState<string[]>([]);
  const [formatFilter, setFormatFilter] = useState<string[]>([]);
  const [filterPop, setFilterPop] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<"detail" | "participants">("detail");
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [partDraft, setPartDraft] = useState("");
  const [optOpen, setOptOpen] = useState(false);
  const [imp, setImp] = useState(false);
  const [impRaw, setImpRaw] = useState("");
  const [impErr, setImpErr] = useState("");
  const [bulk, setBulk] = useState<BulkField | null>(null);
  /** The drawer's fields were all inert — every one of them raised "not built".
   *  Edits are held here until Save, so typing never round-trips and closing
   *  without saving throws them away, which is what a drawer implies. */
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [adding, setAdding] = useState(false);
  const [newSession, setNewSession] = useState({
    title: "",
    track_id: "",
    session_format_id: "",
    duration_minutes: "30",
  });
  const [addError, setAddError] = useState<string | null>(null);

  const [placementError, setPlacementError] = useState<string | null>(null);

  const {
    data,
    isPending: sessionsLoading,
    isError: sessionsErrored,
    error: sessionsError,
    refetch: refetchSessions,
  } = useQuery({
    queryKey: ["sessions", eventId],
    enabled: eventId !== null,
    queryFn: async () => {
      const [sessions, tracks, formats, rooms, days] = await Promise.all([
        authed<SessionRow[]>(`/events/${eventId}/sessions`),
        authed<Named[]>(`/events/${eventId}/tracks?per_page=100`),
        authed<Named[]>(`/events/${eventId}/session-formats?per_page=100`),
        authed<Named[]>(`/events/${eventId}/rooms?per_page=100`),
        authed<EventDayRow[]>(`/events/${eventId}/days?per_page=100`),
      ]);
      return { sessions, tracks, formats, rooms, days };
    },
  });

  /** A session with no proposal behind it. Keynotes and invited talks never go
   *  through the CFP, so promotion cannot be the only way one comes into being —
   *  and this library is the first place somebody looks for it. Creating is not
   *  placing: it lands in the unscheduled tray for the agenda to position. */
  const createSession = useMutation({
    mutationFn: () =>
      authed(`/events/${eventId}/sessions`, {
        method: "POST",
        body: {
          title: newSession.title.trim(),
          duration_minutes: Number(newSession.duration_minutes),
          ...(newSession.track_id === "" ? {} : { track_id: newSession.track_id }),
          ...(newSession.session_format_id === ""
            ? {}
            : { session_format_id: newSession.session_format_id }),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["program-stats", eventId] });
      toast(`“${newSession.title.trim()}” is in the library, waiting for a slot on the agenda.`);
      setNewSession({ title: "", track_id: "", session_format_id: "", duration_minutes: "30" });
      setAddError(null);
      setAdding(false);
    },
    onError: (error: Error) => setAddError(error.message),
  });

  const submitSession = () => {
    if (newSession.title.trim() === "") return setAddError("A session needs a title.");
    const minutes = Number(newSession.duration_minutes);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 600) {
      return setAddError("Duration must be between 5 and 600 minutes.");
    }
    setAddError(null);
    return createSession.mutate();
  };

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

  // The event roster, fetched once and filtered as the organiser types in the
  // Participants tab. Demo scale (≤80 people) makes client-side filtering the
  // honest choice over a search endpoint.
  const { data: roster } = useQuery({
    queryKey: ["speakers", eventId],
    queryFn: () => authed<{ speaker_id: string; name: string; email: string; company: string | null }[]>(`/events/${eventId}/speakers`),
    enabled: eventId !== null,
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      authed(`/events/${eventId}/sessions/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["agenda", eventId] });
      setEdits((current) => onlyPlacementKeys(current));
      toast("Saved.");
    },
    onError: (error: Error) => toast(error.message),
  });

  /** Room and start time are not columns on the generic PATCH — `SessionPatch`
   *  forbids them on purpose, because placing a session is more than setting two
   *  fields: it has to land on a real event day and it flips `status`. That is
   *  exactly what `/placement` and `/unschedule` do, so this drawer calls the
   *  same two endpoints the agenda's drag-drop calls, rather than teaching the
   *  generic PATCH a special case. */
  const place = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { event_day_id: string; room_id: string; starts_at: string };
    }) => authed(`/events/${eventId}/sessions/${id}/placement`, { method: "PATCH", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["agenda", eventId] });
      setEdits((current) => withoutPlacementKeys(current));
      setPlacementError(null);
      toast("Placed. Saved.");
    },
    onError: (error: Error) => toast(error.message),
  });

  const unschedule = useMutation({
    mutationFn: (id: string) =>
      authed(`/events/${eventId}/sessions/${id}/unschedule`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["agenda", eventId] });
      setEdits((current) => withoutPlacementKeys(current));
      setPlacementError(null);
      toast("Cleared. Back in the unscheduled tray.");
    },
    onError: (error: Error) => toast(error.message),
  });

  const runImport = useMutation({
    mutationFn: () =>
      authed<{ created: number; updated: number; skipped: number; rows: ImportedRow[] }>(
        `/events/${eventId}/sessions/import`,
        { method: "POST", body: { csv_text: impRaw } },
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["sessions", eventId] });
      const bad = result.rows.filter((row) => row.outcome === "skipped");
      // A partial import is the normal outcome, so the count of what failed is
      // as prominent as the count of what worked — and the reasons stay on
      // screen rather than vanishing with a toast.
      setImpErr(
        bad.length === 0
          ? ""
          : bad.map((row) => `Row ${row.row}: ${row.detail ?? "skipped"}`).join("\n"),
      );
      if (bad.length === 0) {
        setImp(false);
        setImpRaw("");
      }
      toast(
        `${result.created} created, ${result.updated} updated` +
          (result.skipped > 0 ? `, ${result.skipped} skipped.` : "."),
      );
    },
    onError: (error: Error) => setImpErr(error.message),
  });

  const bulkEdit = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      authed<{ updated: number; skipped_locked: number }>(`/events/${eventId}/sessions/bulk`, {
        method: "POST",
        body,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["sessions", eventId] });
      setBulk(null);
      toast(
        `Updated ${result.updated} session${result.updated === 1 ? "" : "s"}.` +
          (result.skipped_locked > 0 ? ` ${result.skipped_locked} locked, left alone.` : ""),
      );
    },
    onError: (error: Error) => toast(error.message),
  });

  const all = useMemo(() => data?.sessions ?? [], [data]);
  const trackById = useMemo(() => new Map((data?.tracks ?? []).map((t) => [t.id, t])), [data]);
  const formatById = useMemo(() => new Map((data?.formats ?? []).map((f) => [f.id, f])), [data]);
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
  /** The endpoint returns the whole programme, so this pages what is already
   *  in hand. A hundred and twenty-one rows is not a list anybody scrolls. */
  const pageRows = filtered.slice((page - 1) * perPage, page * perPage);

  /** Changing what is being looked at returns you to its first page. */
  const refilter = (change: () => void) => {
    change();
    setPage(1);
  };

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
  const notBuilt = (what: string) => () => toast(`${what} is not built yet.`);
  const impPreview = useMemo(() => previewRows(impRaw), [impRaw]);

  const placementDirty = "room_id" in edits || "starts_at" in edits;
  const fieldsDirty = Object.keys(edits).some((key) => !PLACEMENT_KEYS.has(key));
  const dirty = placementDirty || fieldsDirty;

  /** What the field shows: the unsaved edit if there is one, else the record. */
  const field = (key: string, saved: string): string =>
    key in edits ? String(edits[key] ?? "") : saved;

  const edit =
    (key: string, parse: (value: string) => unknown) => (event: React.SyntheticEvent) => {
      const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
      setEdits((current) => ({ ...current, [key]: parse(value) }));
    };

  const tagText = "tags" in edits ? String(edits.tags ?? "") : (open?.tags ?? []).join(", ");

  /** The wire shape for the generic PATCH. Room and starts never go in this
   *  body — they are not `SessionPatch` fields, see the `place` mutation. */
  const patchBody = (): Record<string, unknown> => {
    const generic = withoutPlacementKeys(edits);
    return "tags" in generic
      ? {
          ...generic,
          tags: String(generic.tags ?? "")
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean),
        }
      : generic;
  };

  /** Placement requires a real event day, and `starts_at` has to fall on it —
   *  the same rule `scheduling/router.py` enforces server-side. Matching it
   *  here means a bad date is a same-screen validation message, not a 422
   *  the user has to decode. */
  const dayForLocalDate = (localDateTime: string): string | null =>
    (data?.days ?? []).find((day) => day.day_date === localDateTime.slice(0, 10))?.id ?? null;

  /** "YYYY-MM-DDTHH:mm", split so the day can be a list and the time an input.
   *  Held as one edit key because that is what the placement endpoint takes. */
  const startsLocal = field(
    "starts_at",
    open?.starts_at == null ? "" : toLocalInputValue(open.starts_at),
  );
  const startDay = startsLocal.slice(0, 10);
  const startTime = startsLocal.slice(11, 16);

  /** Neither half is useful alone, so each supplies a default for the other:
   *  picking a day with no time assumes the hour most conferences open, and
   *  setting a time on an unplaced session assumes the first day. Without this,
   *  choosing one control silently produced an unparseable half-value. */
  const setStart = (day: string, time: string) =>
    setEdits((current) => ({
      ...current,
      starts_at: day === "" ? "" : `${day}T${time === "" ? "09:00" : time}`,
    }));

  const firstDay = (data?.days ?? [])[0]?.day_date ?? "";

  const saving = patch.isPending || place.isPending || unschedule.isPending;

  const screen: SessionsData = {
    ...stripData(stats),
    total: all.length,

    rows: pageRows.map((row) => ({
      id: row.slug.slice(-6).toUpperCase(),
      t: row.title,
      sp: row.speakers.map((speaker) => speaker.name).join(", ") || "No speaker yet",
      pub: row.content_status === "approved" ? null : "not public",
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
        // Edits belong to the session that was open, not to the next one.
        setEdits({});
      },
    })),

    tAll: tile("All"),
    tQu: tile("Unscheduled"),
    tAcc: tile("Scheduled"),
    tPe: tile("Needs approval"),

    q: query,
    onQ: (event: React.SyntheticEvent) =>
      refilter(() => setQuery((event.target as HTMLInputElement).value)),
    // The pager already says "1 — 25 of 121". What it cannot say is what the
    // filter removed, which is the number somebody is checking for. Neither
    // claim means anything while the table is loading or failed to load.
    countLine:
      sessionsLoading || sessionsErrored || filtered.length === all.length
        ? ""
        : `filtered from ${all.length}`,
    pager:
      sessionsLoading || sessionsErrored ? null : (
        <Pager
          page={page}
          perPage={perPage}
          total={filtered.length}
          noun="sessions"
          onPage={setPage}
          onPerPage={(next) => refilter(() => setPerPage(next))}
        />
      ),
    sumLine: `${counts.Scheduled} placed · ${counts.Unscheduled} still to schedule · ${counts["Needs approval"]} awaiting approval`,
    schedN: counts.Scheduled,
    // Loading, failed and genuinely-empty used to all render "Nothing in this
    // queue" — indistinguishable from each other on an event with 61 sessions.
    loading: sessionsLoading,
    loadError: sessionsErrored
      ? sessionsError instanceof Error
        ? sessionsError.message
        : "Something went wrong."
      : null,
    onRetry: () => void refetchSessions(),
    // The filtered length, not the whole list: filtering to nothing used to
    // render a blank table with no explanation and no way back.
    empty: !sessionsLoading && !sessionsErrored && pageRows.length === 0,

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
    closeDrawer: () => {
      setOpenId(null);
      setEdits({});
    },
    isEdit: false,
    // Was a toast saying this was not built, on a button that has been on
    // screen the whole time. `POST /events/:id/sessions` exists; the screen
    // simply never called it.
    openNew: () => setAdding(true),
    dTitle: open?.title ?? "",
    dStamp:
      open === null
        ? ""
        : open.submission_id === null
          ? "invited · no proposal"
          : "promoted from a proposal",
    titleCount: `${(open?.title ?? "").length}/300`,
    titleBd: "var(--ls,#C8D2D5)",
    // Room/starts save through a different endpoint (see `place`/`unschedule`
    // above) than title, track, format and the rest — a save with both kinds of
    // edit pending fires both requests.
    save: () => {
      if (open === null || !dirty) return;
      setPlacementError(null);
      if (fieldsDirty) patch.mutate({ id: open.id, body: patchBody() });
      if (!placementDirty) return;

      const roomId = "room_id" in edits ? (edits.room_id as string | null) : open.room_id;
      if (roomId === null) {
        unschedule.mutate(open.id);
        return;
      }
      const startsRaw =
        "starts_at" in edits
          ? (edits.starts_at as string)
          : open.starts_at === null
            ? ""
            : toLocalInputValue(open.starts_at);
      if (startsRaw === "") {
        setPlacementError("Pick a start time to place it in this room.");
        return;
      }
      const eventDayId = dayForLocalDate(startsRaw);
      if (eventDayId === null) {
        setPlacementError(`${startsRaw.slice(0, 10)} isn't one of the event's days.`);
        return;
      }
      place.mutate({
        id: open.id,
        body: {
          event_day_id: eventDayId,
          room_id: roomId,
          starts_at: new Date(startsRaw).toISOString(),
        },
      });
    },
    saveLabel: saving ? "Saving…" : "Save changes",
    saveDisabled: saving || !dirty,
    // Approval is its own button, always visible, never conflated with saving.
    // Approving with edits still pending would publish the old wording, so the
    // handler saves the fields first and then flips approval.
    approveLabel:
      open === null
        ? null
        : open.content_status === "approved"
          ? "Withdraw from public site"
          : "Approve for the public site",
    onApprove: () => {
      if (open === null) return;
      if (fieldsDirty) patch.mutate({ id: open.id, body: patchBody() });
      approve.mutate({
        id: open.id,
        status: open.content_status === "approved" ? "pending" : "approved",
      });
    },
    placementErr: placementError,

    f: {
      t: field("title", open?.title ?? ""),
      desc: field("abstract", open?.abstract ?? ""),
      tr: field("track_id", open?.track_id ?? ""),
      fmt: field("session_format_id", open?.session_format_id ?? ""),
      room: field("room_id", open?.room_id ?? ""),
      startDay,
      startTime,
      cap: field("duration_minutes", String(open?.duration_minutes ?? "")),
      st: open === null ? "" : (STATUS[open.status] ?? STATUS.unscheduled!).label,
      stFg: (STATUS[open?.status ?? "unscheduled"] ?? STATUS.unscheduled!).fg,
      stBg: (STATUS[open?.status ?? "unscheduled"] ?? STATUS.unscheduled!).bg,
      level: field("expertise_level", open?.expertise_level ?? ""),
      language: field("language", open?.language ?? ""),
      tags: tagText,
    },
    trackOpts: [
      { v: "", l: "No track" },
      ...(data?.tracks ?? []).map((entry) => ({ v: entry.id, l: entry.name })),
    ],
    formatOpts: [
      { v: "", l: "No format" },
      ...(data?.formats ?? []).map((entry) => ({ v: entry.id, l: entry.name })),
    ],
    // This used to be four names baked into the JSX — Main stage, Room 2, Room
    // 3, Workshop lab — regardless of which rooms the event actually has.
    roomOpts: [
      { v: "", l: "Not placed" },
      ...(data?.rooms ?? []).map((entry) => ({ v: entry.id, l: entry.name })),
    ],
    // The event's real days, so the date cannot be wrong. This was a bare
    // `datetime-local`: it accepted 2023-04-20 on a 2027 conference and only
    // objected after the fact, which is a validation message standing in for a
    // control that should never have offered the value.
    dayOpts: [
      { v: "", l: "No day" },
      ...(data?.days ?? []).map((entry) => ({ v: entry.day_date, l: dayLabel(entry.day_date) })),
    ],
    onT: edit("title", (value) => value),
    onDesc: edit("abstract", (value) => value),
    onTr: edit("track_id", (value) => (value === "" ? null : value)),
    onFmt: edit("session_format_id", (value) => (value === "" ? null : value)),
    onCap: edit("duration_minutes", (value) => Number(value)),
    onLevel: edit("expertise_level", (value) => (value === "" ? null : value)),
    onLanguage: edit("language", (value) => (value.trim() === "" ? null : value)),
    // Held as raw text and split only on save: parsing every keystroke ate the
    // comma the moment it was typed, so a separator could never be entered.
    onTags: edit("tags", (value) => value),
    onRoom: edit("room_id", (value) => (value === "" ? null : value)),
    onStartDay: (event: React.SyntheticEvent) =>
      setStart((event.target as HTMLSelectElement).value, startTime),
    onStartTime: (event: React.SyntheticEvent) =>
      setStart(startDay === "" ? firstDay : startDay, (event.target as HTMLInputElement).value),

    // The drawer owns its tabs; the toolbar copies of them are gone.
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
      onX: () => {
        if (open === null) return;
        patch.mutate({
          id: open.id,
          body: {
            speaker_ids: open.speakers
              .filter((sp) => sp.id !== speaker.id)
              .map((sp) => sp.id),
          },
        });
      },
    })),
    partN: open?.speakers.length ?? 0,
    partDraft,
    onPartDraft: (event: React.SyntheticEvent) =>
      setPartDraft((event.target as HTMLInputElement).value),
    // Typeahead over the roster: the tab was a dead input before — typing
    // searched nothing and Add fired a not-built notice.
    partHits:
      open === null || partDraft.trim() === ""
        ? []
        : (roster ?? [])
            .filter((person) => !open.speakers.some((sp) => sp.id === person.speaker_id))
            .filter((person) => {
              const q = partDraft.trim().toLowerCase();
              return (
                person.name.toLowerCase().includes(q) ||
                person.email.toLowerCase().includes(q) ||
                (person.company ?? "").toLowerCase().includes(q)
              );
            })
            .slice(0, 6)
            .map((person) => ({
              n: person.name,
              sub: [person.company, person.email].filter(Boolean).join(" · "),
              onPick: () => {
                if (open === null) return;
                setPartDraft("");
                patch.mutate({
                  id: open.id,
                  body: {
                    speaker_ids: [...open.speakers.map((sp) => sp.id), person.speaker_id],
                  },
                });
              },
            })),
    partEmpty:
      partDraft.trim() !== "" ? "No one on the roster matches. People join the roster from the Speakers screen." : null,
    addPart: () => {
      // Add = take the top match; picking from the list does the same thing.
      if (open === null) return;
      const q = partDraft.trim().toLowerCase();
      const hit = (roster ?? []).find(
        (person) =>
          !open.speakers.some((sp) => sp.id === person.speaker_id) &&
          (person.name.toLowerCase().includes(q) || person.email.toLowerCase().includes(q)),
      );
      if (q === "" || hit === undefined) {
        toast("No one on the roster matches. Add them on the Speakers screen first.");
        return;
      }
      setPartDraft("");
      patch.mutate({
        id: open.id,
        body: { speaker_ids: [...open.speakers.map((sp) => sp.id), hit.speaker_id] },
      });
    },

    optOpen,
    togOpt: () => setOptOpen((current) => !current),
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
      toast(`Exported ${filtered.length} ${filtered.length === 1 ? "session" : "sessions"}.`);
    },
    doXlsx: () => {
      // Server-built, so the file matches the review export byte for byte in
      // shape rather than being a second implementation in the browser.
      void download(`/events/${eventId}/sessions/export.xlsx`, "sessions.xlsx").catch(
        (error: Error) => toast(error.message),
      );
      toast("Building the spreadsheet.");
    },
    doFiles: () => {
      setOptOpen(false);
      void download(`/events/${eventId}/tasks/download.zip`, "deliverables.zip").catch(
        (error: Error) => toast(error.message),
      );
      toast("Building the deliverables archive.");
    },
    doImport: () => {
      setOptOpen(false);
      setImpErr("");
      setImp(true);
    },
    bulkTrack: () => {
      setOptOpen(false);
      setBulk("track");
    },
    bulkFormat: () => {
      setOptOpen(false);
      setBulk("format");
    },
    bulkApproval: () => {
      setOptOpen(false);
      setBulk("approval");
    },

    imp,
    impClose: () => setImp(false),
    impRaw,
    onImpRaw: (event: React.SyntheticEvent) => {
      setImpRaw((event.target as HTMLTextAreaElement).value);
      setImpErr("");
    },
    impRows: impPreview.map((row) => ({
      ...row,
      trCol: TRACK_HUES[0]!,
    })),
    impCount: impPreview.length,
    impErr,
    impErrShow: impErr !== "",
    impExample: () => {
      setImpRaw(IMPORT_EXAMPLE);
      setImpErr("");
    },
    impFile: (event: React.SyntheticEvent) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file === undefined) return;
      void file.text().then((text) => {
        setImpRaw(text);
        setImpErr("");
      });
    },
    impGo: () => {
      if (impPreview.length === 0 || runImport.isPending) return;
      runImport.mutate();
    },
    impGoBg: impPreview.length === 0 ? "var(--ls,#C8D2D5)" : "var(--sg,#E04E4E)",
    impGoFg: impPreview.length === 0 ? "var(--i3,#6B7B84)" : "var(--bf,#FFFFFF)",
    impLabel: runImport.isPending
      ? "Importing…"
      : impPreview.length === 0
        ? "Import"
        : `Import ${impPreview.length}`,
    impReady: impPreview.length > 0 && !runImport.isPending,

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
      <Sessions d={screen} />
      <SideDrawer
        open={adding}
        title="Add a session"
        subtitle="For a talk with no proposal behind it — a keynote, an invited speaker, a sponsor slot. It joins the library unscheduled; the agenda is where it gets a room and a time."
        onClose={() => setAdding(false)}
        footer={
          <>
            <button type="button" style={quietPill} onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button
              type="button"
              style={{ ...pill, opacity: createSession.isPending ? 0.6 : 1 }}
              disabled={createSession.isPending}
              onClick={submitSession}
            >
              {createSession.isPending ? "Adding…" : "Add session"}
            </button>
          </>
        }
      >
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="session-title" style={fieldLabel}>
              Title
            </label>
            <input
              id="session-title"
              value={newSession.title}
              onChange={(event) =>
                setNewSession((current) => ({ ...current, title: event.target.value }))
              }
              style={fieldInput}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="session-track" style={fieldLabel}>
              Track
            </label>
            <select
              id="session-track"
              value={newSession.track_id}
              onChange={(event) =>
                setNewSession((current) => ({ ...current, track_id: event.target.value }))
              }
              style={fieldInput}
            >
              <option value="">No track</option>
              {(data?.tracks ?? []).map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="session-format" style={fieldLabel}>
              Format
            </label>
            <select
              id="session-format"
              value={newSession.session_format_id}
              onChange={(event) =>
                setNewSession((current) => ({
                  ...current,
                  session_format_id: event.target.value,
                }))
              }
              style={fieldInput}
            >
              <option value="">No format</option>
              {(data?.formats ?? []).map((format) => (
                <option key={format.id} value={format.id}>
                  {format.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="session-duration" style={fieldLabel}>
              Duration in minutes
            </label>
            <input
              id="session-duration"
              type="number"
              min={5}
              max={600}
              value={newSession.duration_minutes}
              onChange={(event) =>
                setNewSession((current) => ({
                  ...current,
                  duration_minutes: event.target.value,
                }))
              }
              style={fieldInput}
            />
            <span style={{ font: "400 11.5px var(--font-plex-sans)", color: "var(--i4)" }}>
              How much of the grid it takes up. The format&rsquo;s default is a starting point, not
              a rule.
            </span>
          </div>

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
      {bulk === null ? null : (
        <BulkDialog
          field={bulk}
          count={filtered.length}
          tracks={data?.tracks ?? []}
          formats={data?.formats ?? []}
          pending={bulkEdit.isPending}
          onCancel={() => setBulk(null)}
          onApply={(value) =>
            bulkEdit.mutate({
              session_ids: filtered.map((row) => row.id),
              ...(bulk === "track"
                ? value === ""
                  ? { clear_track: true }
                  : { track_id: value }
                : bulk === "format"
                  ? { session_format_id: value }
                  : { content_status: value }),
            })
          }
        />
      )}
    </>
  );
}

const BULK_LABEL: Record<BulkField, string> = {
  track: "Set track",
  format: "Set format",
  approval: "Set approval",
};

/** Applies to everything currently filtered, so it names the count and makes you
 *  confirm — the same reason sending decisions asks for a recipient count. The
 *  screen has no checkbox column; filtering to the five you mean is the
 *  selection, and that is only safe if the number is in front of you. */
function BulkDialog({
  field,
  count,
  tracks,
  formats,
  pending,
  onCancel,
  onApply,
}: {
  field: BulkField;
  count: number;
  tracks: Named[];
  formats: Named[];
  pending: boolean;
  onCancel: () => void;
  onApply: (value: string) => void;
}) {
  const options =
    field === "track"
      ? [{ id: "", name: "No track" }, ...tracks]
      : field === "format"
        ? formats
        : [
            { id: "pending", name: "Pending" },
            { id: "approved", name: "Approved" },
            { id: "changes_requested", name: "Changes requested" },
          ];
  const [value, setValue] = useState(options[0]?.id ?? "");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(13,16,32,.36)",
        display: "grid",
        placeItems: "center",
        zIndex: 130,
      }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-label={BULK_LABEL[field]}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 420,
          maxWidth: "92vw",
          background: "var(--cd,#FFFFFF)",
          border: "1px solid var(--ln,#E1E7E9)",
          borderRadius: 14,
          padding: 20,
          boxShadow: "0 24px 60px rgba(13,16,32,.28)",
          display: "grid",
          gap: 14,
        }}
      >
        <div style={{ font: "600 15px var(--font-plex-sans), sans-serif" }}>
          {BULK_LABEL[field]} on {count} session{count === 1 ? "" : "s"}
        </div>
        <div
          style={{
            font: "400 13px var(--font-plex-sans), sans-serif",
            color: "var(--i3,#6B7B84)",
          }}
        >
          Everything in the current view changes. Locked sessions are left alone.
        </div>
        <label
          style={{ display: "grid", gap: 6, font: "500 12px var(--font-plex-sans), sans-serif" }}
        >
          New value
          <select
            value={value}
            onChange={(event) => setValue(event.target.value)}
            style={{
              height: 36,
              borderRadius: 8,
              border: "1px solid var(--ls,#C8D2D5)",
              padding: "0 10px",
              font: "400 13px var(--font-plex-sans), sans-serif",
              background: "var(--cd,#FFFFFF)",
              color: "var(--ik,#16232B)",
            }}
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              height: 34,
              padding: "0 14px",
              borderRadius: 999,
              border: "1px solid var(--ls,#C8D2D5)",
              background: "var(--cd,#FFFFFF)",
              font: "500 12.5px var(--font-plex-sans), sans-serif",
              color: "var(--ik,#16232B)",
            }}
          >
            Cancel
          </button>
          <button
            disabled={pending || count === 0}
            onClick={() => onApply(value)}
            style={{
              height: 34,
              padding: "0 14px",
              borderRadius: 999,
              border: "none",
              background: count === 0 ? "var(--ls,#C8D2D5)" : "var(--sg,#E04E4E)",
              font: "600 12.5px var(--font-plex-sans), sans-serif",
              color: count === 0 ? "var(--i3,#6B7B84)" : "var(--bf,#FFFFFF)",
            }}
          >
            {pending ? "Applying…" : `Change ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
}
