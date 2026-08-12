"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useConsoleChrome } from "@/components/console/chrome";
import { stripData, useProgramStats } from "@/components/console/stats";
import { Tasks, type TasksData } from "@/components/design/Tasks";
import { FileThreads, type FileThread } from "@/components/FileThreads";
import { API_BASE_URL } from "@/lib/api";
import { authed, download, getToken } from "@/lib/session";

type Row = {
  id: string;
  speaker_id: string;
  speaker_name: string;
  speaker_email: string;
  task_template_id: string;
  task_name: string;
  kind: string;
  is_required: boolean;
  due_at: string | null;
  status: string;
  completed_at: string | null;
  last_nudged_at: string | null;
  file_count: number;
};

const OPEN = new Set(["not_started", "in_progress", "overdue"]);
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const WEEK_MS = 7 * 86_400_000;

const KIND_WORD: Record<string, string> = {
  upload: "Upload",
  form: "Form",
  acknowledge: "Acknowledge",
  external_link: "External link",
};

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** How the due date reads, and in which colour. Overdue is already derived by
 *  the API; this only renders the distance. */
function dueLabel(row: Row, now: number): { text: string; fg: string } {
  if (row.status === "complete") {
    return { text: "Done", fg: "var(--ok,#0E7A5F)" };
  }
  if (row.due_at === null) {
    return { text: "No due date", fg: "var(--i4,#99A6AD)" };
  }
  const days = Math.round((new Date(row.due_at).getTime() - now) / 86_400_000);
  if (row.status === "overdue") {
    return { text: `${Math.abs(days)}d overdue`, fg: "var(--cn,#D8432B)" };
  }
  if (days <= 3) {
    return { text: `due in ${days}d`, fg: "var(--pd,#B96A1F)" };
  }
  return { text: `due ${DAY.format(new Date(row.due_at))}`, fg: "var(--i4,#99A6AD)" };
}

function bar(row: Row): string {
  if (row.status === "complete") return "var(--ok,#0E7A5F)";
  if (row.status === "overdue") return "var(--cn,#D8432B)";
  if (row.status === "submitted") return "var(--if,#47599F)";
  return "var(--ln,#E1E7E9)";
}

export default function TasksPage() {
  const { toasts, toast, dismiss } = useConsoleChrome();
  const { stats, eventId } = useProgramStats();
  const queryClient = useQueryClient();

  const [groupBy, setGroupBy] = useState<"task" | "speaker">("task");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [only, setOnly] = useState<"open" | "overdue" | "all">("open");
  const [showComments, setShowComments] = useState(false);

  // The clock is read once, when the rows arrive. Reading it during render makes
  // "3d overdue" depend on which re-render you happened to catch.
  const { data, isPending } = useQuery({
    queryKey: ["tasks", eventId],
    enabled: eventId !== null,
    queryFn: async () => ({
      rows: await authed<Row[]>(`/events/${eventId}/tasks/summary`),
      now: Date.now(),
    }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tasks", eventId] });
  };

  const { data: threads } = useQuery({
    queryKey: ["file-comments", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<FileThread[]>(`/events/${eventId}/file-comments`),
  });
  const fileCount = (threads ?? []).length;

  const comment = useMutation({
    mutationFn: ({ fileId, body }: { fileId: string; body: string }) =>
      authed(`/events/${eventId}/files/${fileId}/comments`, {
        method: "POST",
        body: { body },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["file-comments", eventId] });
      toast("Comment posted. The speaker can see it in their portal.");
    },
  });

  const nudge = useMutation({
    mutationFn: (speakerIds: string[] | null) =>
      authed<{ sent: number; skipped: number }>(`/events/${eventId}/tasks/nudge`, {
        method: "POST",
        body: speakerIds === null ? {} : { speaker_ids: speakerIds },
      }),
    onSuccess: (result) => {
      invalidate();
      toast(
        result.sent === 0
          ? `Nobody emailed. ${result.skipped} were already nudged in the last 24 hours.`
          : `Reminded ${result.sent} speaker${result.sent === 1 ? "" : "s"}.` +
              (result.skipped > 0 ? ` ${result.skipped} skipped, nudged today already.` : ""),
      );
    },
    onError: (error: Error) => toast(error.message),
  });

  const complete = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      authed(`/events/${eventId}/speaker-tasks/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: () => {
      invalidate();
      toast("Marked complete.");
    },
    onError: (error: Error) => toast(error.message),
  });

  const all = useMemo(() => data?.rows ?? [], [data]);
  const now = data?.now ?? 0;

  const openRows = all.filter((row) => OPEN.has(row.status) || row.status === "submitted");
  const overdue = all.filter((row) => row.status === "overdue");
  const waiting = new Set(openRows.map((row) => row.speaker_id));
  const doneThisWeek = all.filter(
    (row) => row.completed_at !== null && now - new Date(row.completed_at).getTime() < WEEK_MS,
  );

  const visible = useMemo(() => {
    if (only === "overdue") return overdue;
    if (only === "open") return openRows;
    return all;
  }, [all, only, openRows, overdue]);

  const groups = useMemo(() => {
    const buckets = new Map<string, { name: string; rows: Row[] }>();
    for (const row of visible) {
      const key = groupBy === "task" ? row.task_template_id : row.speaker_id;
      const name = groupBy === "task" ? row.task_name : row.speaker_name;
      const bucket = buckets.get(key) ?? { name, rows: [] };
      bucket.rows.push(row);
      buckets.set(key, bucket);
    }
    return [...buckets.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [visible, groupBy]);

  /** Per-template completion, which is the number an organiser actually reports
   *  upward: "headshots are 62 of 80". */
  const perTemplate = useMemo(() => {
    const buckets = new Map<string, { name: string; done: number; total: number }>();
    for (const row of all) {
      const bucket = buckets.get(row.task_template_id) ?? {
        name: row.task_name,
        done: 0,
        total: 0,
      };
      bucket.total += 1;
      if (row.status === "complete") bucket.done += 1;
      buckets.set(row.task_template_id, bucket);
    }
    return [...buckets.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);

  /** The ZIP arrives as an authenticated fetch rather than a plain link: a
   *  bearer token has no business in a URL, and the browser would not attach it. */
  const downloadPack = async () => {
    const response = await fetch(`${API_BASE_URL}/events/${eventId}/tasks/download.zip`, {
      headers: { Authorization: `Bearer ${getToken() ?? ""}` },
    });
    if (!response.ok) {
      toast("That download could not be prepared.");
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "deliverables.zip";
    link.click();
    URL.revokeObjectURL(url);
    toast("Downloaded the current version of every file.");
  };

  const tile = (name: "open" | "overdue" | "all", count: number) => ({
    c: count,
    on: () => setOnly(name),
    bd: only === name ? "var(--sg,#E04E4E)" : "var(--ln,#E1E7E9)",
    ring: only === name ? "0 0 0 3px var(--sw,#FFEAE6)" : "0 1px 2px rgba(13,16,32,.04)",
    numFg: only === name ? "var(--sg,#E04E4E)" : "var(--ik,#16232B)",
  });

  const toggle = (on: boolean) => ({
    Bg: on ? "var(--cd,#FFFFFF)" : "transparent",
    Fg: on ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
    Wt: on ? "600" : "400",
    Sh: on ? "0 1px 2px rgba(13,16,32,.10)" : "none",
  });
  const byTaskStyle = toggle(groupBy === "task");
  const bySpeakerStyle = toggle(groupBy === "speaker");

  const screen: TasksData = {
    ...stripData(stats),

    odCount: overdue.length,
    /* Until the query resolves, `all` is [] — so this screen stated "No
     * deliverables assigned yet" and four zeroes on an event with 79 overdue
     * tasks, every single load. An empty state and a loading state are
     * different claims and were rendering identically. */
    sumLine: isPending
      ? "Loading deliverables…"
      : all.length === 0
        ? "No deliverables assigned yet. Create a task template and assign it to the roster."
        : `${openRows.length} open across ${waiting.size} speaker${waiting.size === 1 ? "" : "s"}, ${overdue.length} overdue.`,
    allClear: !isPending && groups.length === 0,
    // Was the literal "84 speakers, zero open tasks here", printed on any
    // event and flashed on every load before the data arrived. An empty view
    // has two very different causes and the operator needs to know which.
    allClearBg: all.length === 0 ? "var(--sk,#EDF1F2)" : "var(--okw,#E2F1EC)",
    allClearBd: all.length === 0 ? "var(--ln,#E1E7E9)" : "var(--okl,#C2E0D5)",
    allClearFg: all.length === 0 ? "var(--i2,#3E4E58)" : "var(--ok,#0E7A5F)",
    allClearNote:
      all.length === 0
        ? "No deliverables have been assigned yet. Build a task template in Program, then assign it to the roster."
        : `Nothing outstanding in this view — ${all.length} task${all.length === 1 ? "" : "s"} across ${waiting.size} speaker${waiting.size === 1 ? "" : "s"}, all accounted for.`,

    tOpen: tile("open", openRows.length),
    tOdT: tile("overdue", overdue.length),
    tSpk: tile("all", waiting.size),
    tDoneT: {
      c: doneThisWeek.length,
      on: () => setOnly("all"),
      bd: "var(--ln,#E1E7E9)",
      ring: "0 1px 2px rgba(13,16,32,.04)",
      numFg: "var(--ik,#16232B)",
    },

    byTask: () => setGroupBy("task"),
    bySpeaker: () => setGroupBy("speaker"),
    vTaskBg: byTaskStyle.Bg,
    vTaskFg: byTaskStyle.Fg,
    vTaskWt: byTaskStyle.Wt,
    vTaskSh: byTaskStyle.Sh,
    vSpBg: bySpeakerStyle.Bg,
    vSpFg: bySpeakerStyle.Fg,
    vSpWt: bySpeakerStyle.Wt,
    vSpSh: bySpeakerStyle.Sh,

    nudgeAll: () => {
      const ids = [...new Set(overdue.map((row) => row.speaker_id))];
      if (ids.length === 0) {
        toast("Nothing is overdue.");
        return;
      }
      nudge.mutate(ids);
    },
    // Zero overdue can never send anything, so the button says that up front
    // rather than dressing a no-op as the loudest thing on the toolbar.
    nudgeDisabled: overdue.length === 0,
    nudgeTitle:
      overdue.length === 0
        ? "Nothing is overdue."
        : `Email every speaker with an overdue task (${overdue.length}).`,

    summary: perTemplate.map((entry) => ({
      n: entry.name,
      frac: `${entry.done}/${entry.total}`,
      w: `${entry.total === 0 ? 0 : Math.round((entry.done / entry.total) * 100)}%`,
      fill: entry.done === entry.total ? "var(--ok,#0E7A5F)" : "var(--sg,#E04E4E)",
      bg: "var(--cd,#FFFFFF)",
      bd: "var(--ln,#E1E7E9)",
      on: () => setOnly("all"),
    })),

    groups: groups.map(([key, bucket]) => {
      const late = bucket.rows.filter((row) => row.status === "overdue").length;
      const open = collapsed.includes(key) === false;
      return {
        n: bucket.name,
        meta:
          groupBy === "task"
            ? `${bucket.rows.length} assigned`
            : (bucket.rows[0]?.speaker_email ?? ""),
        chev: open ? "▾" : "▸",
        open,
        onTog: () =>
          setCollapsed((current) =>
            current.includes(key) ? current.filter((id) => id !== key) : [...current, key],
          ),
        hasOd: late > 0,
        odLabel: `${late} overdue`,
        rows: bucket.rows.map((row) => {
          const due = dueLabel(row, now);
          return {
            ini: initials(row.speaker_name),
            n: groupBy === "task" ? row.speaker_name : row.task_name,
            c: groupBy === "task" ? (KIND_WORD[row.kind] ?? row.kind) : row.speaker_name,
            sub:
              row.file_count > 0
                ? `${row.file_count} file${row.file_count === 1 ? "" : "s"} uploaded`
                : row.status === "submitted"
                  ? "Submitted, waiting on you"
                  : row.speaker_email,
            due: due.text,
            dueFg: due.fg,
            bar: bar(row),
            onNudge: () => nudge.mutate([row.speaker_id]),
            onDone: () => complete.mutate({ id: row.id, status: "complete" }),
          };
        }),
      };
    }),

    downloadPack: () => void downloadPack(),
    // Same reasoning as the nudge button: zero uploaded files means the zip
    // would be empty, so it is disabled rather than pretending to work.
    downloadDisabled: fileCount === 0,
    downloadTitle:
      fileCount === 0
        ? "No files have been uploaded yet."
        : `Download the current version of every uploaded file (${fileCount}) as one zip.`,

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
      <Tasks d={screen} />
      {/* Rendered alongside the prototype rather than inside it: the Tasks
       *  design is regenerated and exposes no per-row affordance, and the panel
       *  is per-file while its rows are per-task-per-speaker. */}
      <button
        type="button"
        onClick={() => setShowComments((open) => !open)}
        style={{
          position: "fixed",
          right: "16px",
          bottom: "16px",
          zIndex: 91,
          height: "36px",
          padding: "0 16px",
          borderRadius: "999px",
          border: "1px solid var(--ln,#E1E7E9)",
          background: "var(--cd,#FFFFFF)",
          boxShadow: "0 12px 32px rgba(16,19,25,.16)",
          font: "600 12.5px 'IBM Plex Sans',sans-serif",
          color: "var(--ik,#16232B)",
          whiteSpace: "nowrap",
        }}
      >
        {showComments ? "Close files" : `Files${fileCount > 0 ? ` · ${fileCount}` : ""}`}
      </button>
      {showComments ? (
        <aside
          aria-label="Files"
          style={{
            position: "fixed",
            top: "0",
            right: "0",
            bottom: "0",
            width: "min(480px, 100vw)",
            zIndex: 90,
            display: "flex",
            flexDirection: "column",
            background: "var(--pp,#F4F6F7)",
            borderLeft: "1px solid var(--ln,#E1E7E9)",
            boxShadow: "-16px 0 40px rgba(16,19,25,.12)",
          }}
        >
          <header style={{ padding: "18px 18px 10px" }}>
            <h2
              style={{
                font: "600 18px 'IBM Plex Sans',sans-serif",
                color: "var(--ik,#16232B)",
                margin: "0 0 4px",
              }}
            >
              Files
            </h2>
            <p
              style={{
                font: "400 12.5px 'IBM Plex Sans',sans-serif",
                color: "var(--i3,#6B7B84)",
                margin: "0",
              }}
            >
              Every deliverable uploaded to this event, each with its versions and its conversation.
              Speakers read these comments in their portal and can reply; for notes only staff
              should see, use the submission&rsquo;s internal notes.
            </p>
          </header>
          <div style={{ flex: "1", overflowY: "auto", padding: "0 18px 72px" }}>
            <FileThreads
              threads={threads ?? []}
              viewer="staff"
              sending={comment.isPending}
              onSend={(fileId, body) => comment.mutateAsync({ fileId, body })}
              onDownload={(fileId, filename) => {
                void download(`/events/${eventId}/files/${fileId}/download`, filename).catch(
                  (problem: Error) => toast(problem.message),
                );
              }}
            />
          </div>
        </aside>
      ) : null}
    </>
  );
}
