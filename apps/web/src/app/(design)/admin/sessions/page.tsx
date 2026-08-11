"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useConsoleChrome } from "@/components/console/chrome";
import { stripData, useProgramStats } from "@/components/console/stats";
import { Sessions, type SessionsData } from "@/components/design/Sessions";
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

const TRACK_HUES = ["#3E8896", "#A85788", "#5A6BA8", "#7E5CB8", "#C4703A", "#34526B"];

const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  unscheduled: { label: "Unscheduled", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)" },
  scheduled: { label: "Scheduled", fg: "var(--if,#47599F)", bg: "var(--ifw,#E9ECF7)" },
  confirmed: { label: "Confirmed", fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)" },
};

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

export default function SessionsPage() {
  const { toasts, toast, dismiss } = useConsoleChrome();
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
  const [optOpen, setOptOpen] = useState(false);
  const [imp, setImp] = useState(false);
  const [impRaw, setImpRaw] = useState("");
  const [impErr, setImpErr] = useState("");
  const [bulk, setBulk] = useState<BulkField | null>(null);
  /** The drawer's fields were all inert — every one of them raised "not built".
   *  Edits are held here until Save, so typing never round-trips and closing
   *  without saving throws them away, which is what a drawer implies. */
  const [edits, setEdits] = useState<Record<string, unknown>>({});

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

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      authed(`/events/${eventId}/sessions/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["agenda", eventId] });
      setEdits({});
      toast("Saved.");
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
  const impPreview = useMemo(() => previewRows(impRaw), [impRaw]);

  const dirty = Object.keys(edits).length > 0;

  /** What the field shows: the unsaved edit if there is one, else the record. */
  const field = (key: string, saved: string): string =>
    key in edits ? String(edits[key] ?? "") : saved;

  const edit =
    (key: string, parse: (value: string) => unknown) => (event: React.SyntheticEvent) => {
      const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
      setEdits((current) => ({ ...current, [key]: parse(value) }));
    };

  const tagText = "tags" in edits ? String(edits.tags ?? "") : (open?.tags ?? []).join(", ");

  /** The wire shape. Only `tags` differs from what the drawer holds. */
  const patchBody = (): Record<string, unknown> =>
    "tags" in edits
      ? {
          ...edits,
          tags: String(edits.tags ?? "")
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean),
        }
      : edits;

  const screen: SessionsData = {
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
        // Edits belong to the session that was open, not to the next one.
        setEdits({});
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
    // The filtered length, not the whole list: filtering to nothing used to
    // render a blank table with no explanation and no way back.
    empty: filtered.length === 0,

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
    // One primary action, two meanings: unsaved edits outrank approving, because
    // approving content you have half-rewritten publishes the old wording.
    save: () => {
      if (open === null) return;
      if (dirty) {
        patch.mutate({ id: open.id, body: patchBody() });
        return;
      }
      approve.mutate({
        id: open.id,
        status: open.content_status === "approved" ? "pending" : "approved",
      });
    },
    saveLabel: dirty
      ? patch.isPending
        ? "Saving…"
        : "Save changes"
      : open?.content_status === "approved"
        ? "Withdraw approval"
        : "Approve for the public site",

    f: {
      t: field("title", open?.title ?? ""),
      desc: field("abstract", open?.abstract ?? ""),
      tr: field("track_id", open?.track_id ?? ""),
      fmt: field("session_format_id", open?.session_format_id ?? ""),
      room: open?.room_id == null ? "Not placed" : (roomById.get(open.room_id)?.name ?? ""),
      starts: open?.starts_at == null ? "Not scheduled" : WHEN.format(new Date(open.starts_at)),
      cap: field("duration_minutes", String(open?.duration_minutes ?? "")),
      st: open === null ? "" : (STATUS[open.status] ?? STATUS.unscheduled!).label,
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
    // Placement is the agenda's, and saying where it lives beats a flat refusal.
    onRoom: notBuilt("Placing a session is the agenda's job — drag it there"),
    onStarts: notBuilt("Scheduling is the agenda's job — drag it there"),
    onSt: notBuilt("A session's status follows its placement"),

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
      toast(`Exported ${filtered.length} sessions.`);
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
    impGoFg: impPreview.length === 0 ? "var(--i3,#6B7B84)" : "#FFFFFF",
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
              color: count === 0 ? "var(--i3,#6B7B84)" : "#FFFFFF",
            }}
          >
            {pending ? "Applying…" : `Change ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
}
