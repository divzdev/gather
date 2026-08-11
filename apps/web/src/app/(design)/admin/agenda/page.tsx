"use client";

/** The room × time grid.
 *
 *  Two rules from the product shape all of this. **A drop is never refused for a
 *  conflict** — it lands, and the response tells you what it hit. And the grid
 *  must stay responsive under the drag, so the card follows the pointer against
 *  local state and the API is called once, on release.
 *
 *  Geometry is in minutes from the day's own start, converted to pixels at a
 *  fixed scale. Times are read and written in UTC throughout, so a card's
 *  position and its label can never disagree.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import { useConsoleChrome } from "@/components/console/chrome";
import { Agenda, type AgendaData } from "@/components/design/Agenda";
import { authed, getEventId } from "@/lib/session";

const MINUTES_PER_PX = 1.5;
const GRID_MINUTES = 480;
const SNAP = 5;
const TRACK_HUES = [
  "#3E8896",
  "#A85788",
  "#5A6BA8",
  "#7E5CB8",
  "#C4703A",
  "#34526B",
] as const;

type GridSession = {
  id: string;
  title: string;
  speaker_ids: string[];
  event_day_id: string | null;
  room_id: string | null;
  track_id: string | null;
  starts_at: string | null;
  duration_minutes: number;
  status: string;
  is_locked: boolean;
};

type Conflict = {
  conflict_key: string;
  kind: "room" | "speaker" | "track";
  severity: "hard" | "soft";
  label: string;
  starts_at: string;
  ends_at: string;
  session_ids: string[];
};

type Draft = {
  days: {
    id: string;
    day_date: string;
    starts_at_local: string;
    ends_at_local: string;
    label: string | null;
  }[];
  rooms: { id: string; name: string; sort_order: number }[];
  tracks: { id: string; name: string; hue_index: string }[];
  blocks: {
    id: string;
    event_day_id: string;
    label: string;
    starts_at: string;
    duration_minutes: number;
    spans_all_rooms: boolean;
    room_id: string | null;
  }[];
  scheduled: GridSession[];
  unscheduled: GridSession[];
  conflicts: Conflict[];
};

type Dragging = {
  id: string;
  duration: number;
  fromTray: boolean;
  roomIndex: number;
  minute: number;
};

const CLOCK = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

function clockAt(windowStart: number, minute: number): string {
  return CLOCK.format(new Date(windowStart + minute * 60_000));
}

export default function AgendaPage() {
  const { toasts, toast, dismiss } = useConsoleChrome();
  const queryClient = useQueryClient();
  const eventId = typeof window === "undefined" ? null : getEventId();

  const [dayIndex, setDayIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<"agent" | "conflicts">("conflicts");
  const [publishOpen, setPublishOpen] = useState(false);
  const [ghosts, setGhosts] = useState<
    { ref: string; sessionId: string; roomIndex: number; minute: number; title: string; duration: number }[]
  >([]);
  const [drag, setDrag] = useState<Dragging | null>(null);
  const dragRef = useRef<Dragging | null>(null);

  const { data } = useQuery({
    queryKey: ["agenda", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Draft>(`/events/${eventId}/schedule/draft`),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["agenda", eventId] });
  };

  const days = useMemo(() => data?.days ?? [], [data]);
  const rooms = useMemo(() => data?.rooms ?? [], [data]);
  const day = days[Math.min(dayIndex, Math.max(0, days.length - 1))] ?? null;

  /** Minute zero of the visible grid, in UTC. Everything else is an offset. */
  const windowStart = useMemo(
    () => (day === null ? 0 : Date.parse(`${day.day_date}T${day.starts_at_local}Z`)),
    [day],
  );

  const place = useMutation({
    mutationFn: (move: { id: string; roomIndex: number; minute: number; duration?: number }) =>
      authed<{ conflicts: Conflict[] }>(
        `/events/${eventId}/sessions/${move.id}/placement`,
        {
          method: "PATCH",
          body: {
            event_day_id: day?.id,
            room_id: rooms[move.roomIndex]?.id,
            starts_at: new Date(windowStart + move.minute * 60_000).toISOString(),
            ...(move.duration === undefined ? {} : { duration_minutes: move.duration }),
          },
        },
      ),
    onSuccess: (result) => {
      refresh();
      const hard = result.conflicts.filter((row) => row.severity === "hard");
      toast(
        hard.length === 0
          ? "Placed."
          : `Placed, with ${hard.length} clash${hard.length === 1 ? "" : "es"}. Open the inspector to resolve.`,
      );
    },
    onError: (problem: Error) => toast(problem.message),
  });

  const unschedule = useMutation({
    mutationFn: (id: string) =>
      authed(`/events/${eventId}/sessions/${id}/unschedule`, { method: "POST" }),
    onSuccess: () => {
      refresh();
      toast("Back in the tray.");
    },
    onError: (problem: Error) => toast(problem.message),
  });

  const ignore = useMutation({
    mutationFn: (input: { key: string; reason: string }) =>
      authed(`/events/${eventId}/conflicts/dismiss`, {
        method: "POST",
        body: { conflict_key: input.key, reason: input.reason },
      }),
    onSuccess: () => {
      refresh();
      toast("Noted as deliberate. It comes back if the clash changes.");
    },
    onError: (problem: Error) => toast(problem.message),
  });

  const acceptGhosts = useMutation({
    mutationFn: (rows: typeof ghosts) =>
      authed(`/events/${eventId}/sessions/bulk-placement`, {
        method: "POST",
        body: {
          placements: rows.map((row) => ({
            session_id: row.sessionId,
            event_day_id: day?.id,
            room_id: rooms[row.roomIndex]?.id,
            starts_at: new Date(windowStart + row.minute * 60_000).toISOString(),
          })),
        },
      }),
    onSuccess: (_result, rows) => {
      setGhosts([]);
      refresh();
      toast(`Placed ${rows.length} session${rows.length === 1 ? "" : "s"}.`);
    },
    onError: (problem: Error) => toast(problem.message),
  });

  const publish = useMutation({
    mutationFn: (acknowledge: boolean) =>
      authed<{ version: number; sessions: number }>(`/events/${eventId}/schedule/publish`, {
        method: "POST",
        body: { acknowledge_conflicts: acknowledge },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (result) => {
      setPublishOpen(false);
      refresh();
      toast(`Published version ${result.version}. ${result.sessions} sessions are live.`);
    },
    onError: (problem: Error) => {
      setPublishOpen(false);
      toast(problem.message);
    },
  });

  const conflicts = data?.conflicts ?? [];
  const conflicted = new Set(conflicts.flatMap((row) => row.session_ids));
  const onThisDay = (data?.scheduled ?? []).filter((row) => row.event_day_id === day?.id);
  const tray = (data?.unscheduled ?? []).filter(
    (row) => query.trim() === "" || row.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const columns = Math.max(1, rooms.length);
  const columnLeft = (index: number, lane = 0, lanes = 1) =>
    `calc(56px + (100% - 56px) * ${index / columns + lane / (columns * lanes)} + 3px)`;
  const columnWidth = (lanes = 1) => `calc((100% - 56px) * ${1 / (columns * lanes)} - 6px)`;
  const minuteOf = (row: GridSession) =>
    row.starts_at === null ? 0 : Math.round((Date.parse(row.starts_at) - windowStart) / 60_000);

  /** Overlapping cards in one room split into side-by-side lanes rather than
   *  stacking on top of each other, which is unreadable exactly when it matters. */
  const lanes = useMemo(() => {
    const startOf = (row: GridSession) =>
      row.starts_at === null ? 0 : Math.round((Date.parse(row.starts_at) - windowStart) / 60_000);
    const map = new Map<string, { lane: number; of: number }>();
    for (const room of rooms) {
      const inRoom = onThisDay
        .filter((row) => row.room_id === room.id)
        .sort((a, b) => startOf(a) - startOf(b) || b.duration_minutes - a.duration_minutes);
      let ends: number[] = [];
      let cluster: GridSession[] = [];
      const flush = () => {
        const width = Math.max(1, ends.length);
        for (const row of cluster) {
          const current = map.get(row.id);
          if (current) map.set(row.id, { ...current, of: width });
        }
        cluster = [];
        ends = [];
      };
      for (const row of inRoom) {
        const start = startOf(row);
        if (cluster.length > 0 && ends.every((end) => end <= start)) flush();
        let index = ends.findIndex((end) => end <= start);
        if (index === -1) {
          ends.push(start + row.duration_minutes);
          index = ends.length - 1;
        } else {
          ends[index] = start + row.duration_minutes;
        }
        map.set(row.id, { lane: index, of: 1 });
        cluster.push(row);
      }
      flush();
    }
    return map;
  }, [onThisDay, rooms, windowStart]);

  const trackHue = (trackId: string | null): string => {
    const track = data?.tracks.find((row) => row.id === trackId);
    return TRACK_HUES[Number(track?.hue_index ?? 0) % TRACK_HUES.length] ?? TRACK_HUES[0];
  };

  /** Pointer position to a (room, minute) slot. The grid is found from the event
   *  rather than a ref, because the generated markup owns the element. */
  const slotAt = (event: React.MouseEvent | MouseEvent): { roomIndex: number; minute: number } | null => {
    const target = event.target as HTMLElement | null;
    const grid =
      target?.closest("[data-agenda-grid]") ??
      document.querySelector("[data-agenda-grid]");
    if (grid === null) return null;
    const box = grid.getBoundingClientRect();
    const usable = box.width - 56;
    if (usable <= 0) return null;
    const x = event.clientX - box.left - 56;
    const y = event.clientY - box.top;
    const roomIndex = Math.max(0, Math.min(columns - 1, Math.floor((x / usable) * columns)));
    const raw = Math.round(y / MINUTES_PER_PX / SNAP) * SNAP;
    return { roomIndex, minute: Math.max(0, Math.min(GRID_MINUTES - SNAP, raw)) };
  };

  const beginDrag = (
    event: React.MouseEvent,
    row: GridSession,
    fromTray: boolean,
  ) => {
    if (row.is_locked) {
      toast(`${row.title} is locked. Unlock it before moving it.`);
      return;
    }
    event.preventDefault();
    const started: Dragging = {
      id: row.id,
      duration: row.duration_minutes,
      fromTray,
      roomIndex: rooms.findIndex((entry) => entry.id === row.room_id),
      minute: minuteOf(row),
    };
    dragRef.current = started;
    setDrag(started);

    const move = (native: MouseEvent) => {
      const slot = slotAt(native);
      if (slot === null || dragRef.current === null) return;
      const next = { ...dragRef.current, ...slot };
      dragRef.current = next;
      setDrag(next);
    };
    const finish = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", finish);
      const landed = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (landed !== null && landed.roomIndex >= 0) {
        place.mutate({ id: landed.id, roomIndex: landed.roomIndex, minute: landed.minute });
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", finish);
  };

  /** Auto-schedule assist: a first-fit pass over the tray that proposes slots
   *  rather than taking them. Nothing moves until the organiser accepts, which
   *  is the same shape every generated suggestion in this product takes. */
  const propose = () => {
    if (day === null || rooms.length === 0) {
      toast("Add a room and a day before auto-scheduling.");
      return;
    }
    const busy = rooms.map((room) =>
      onThisDay
        .filter((row) => row.room_id === room.id)
        .map((row) => [minuteOf(row), minuteOf(row) + row.duration_minutes] as const),
    );
    const proposed: typeof ghosts = [];
    for (const row of tray) {
      let placed = false;
      for (let minute = 0; minute + row.duration_minutes <= GRID_MINUTES && !placed; minute += 15) {
        for (let index = 0; index < rooms.length && !placed; index += 1) {
          const clash = (busy[index] ?? []).some(
            ([start, end]) => minute < end && start < minute + row.duration_minutes,
          );
          if (clash) continue;
          busy[index]?.push([minute, minute + row.duration_minutes]);
          proposed.push({
            ref: `${row.id}-${minute}`,
            sessionId: row.id,
            roomIndex: index,
            minute,
            title: row.title,
            duration: row.duration_minutes,
          });
          placed = true;
        }
      }
    }
    setGhosts(proposed);
    setPanel("agent");
    toast(
      proposed.length === 0
        ? "Nothing left to place on this day."
        : `Proposed ${proposed.length} placement${proposed.length === 1 ? "" : "s"}. Accept the ones you want.`,
    );
  };

  const dragPreview = drag !== null && drag.roomIndex >= 0;

  /** What the session under the cursor would collide with if dropped here.
   *
   *  Computed in the browser against data already loaded, so it appears while
   *  the card is still moving. The server remains the authority and recomputes
   *  on release; this is a preview, not a second source of truth. */
  const previewClash = ((): { hard: boolean; why: string } | null => {
    if (drag === null || drag.roomIndex < 0 || day === null) return null;
    const moving = [...onThisDay, ...(data?.unscheduled ?? [])].find((row) => row.id === drag.id);
    const roomId = rooms[drag.roomIndex]?.id;
    const from = drag.minute;
    const to = from + drag.duration;

    const startOf = (row: GridSession) =>
      row.starts_at === null ? 0 : Math.round((Date.parse(row.starts_at) - windowStart) / 60_000);

    for (const row of onThisDay) {
      if (row.id === drag.id) continue;
      const start = startOf(row);
      const end = start + row.duration_minutes;
      // Half-open, exactly as the server does it: touching is not overlapping.
      if (!(from < end && start < to)) continue;

      if (row.room_id === roomId) {
        return { hard: true, why: `${rooms[drag.roomIndex]?.name ?? "This room"} is taken` };
      }
      const shared = (moving?.speaker_ids ?? []).some((id) => row.speaker_ids.includes(id));
      if (shared) return { hard: true, why: "Same speaker, same time" };
      if (moving?.track_id != null && row.track_id === moving.track_id) {
        return { hard: false, why: "Same track overlaps" };
      }
    }
    return null;
  })();
  const hardCount = conflicts.filter((row) => row.severity === "hard").length;

  const screen: AgendaData = {

    roomCount: String(columns),
    roomCols: rooms.map((room) => ({ n: room.name.toUpperCase() })),
    roomRules: rooms.slice(1).map((_room, index) => ({
      left: `calc(56px + (100% - 56px) * ${(index + 1) / columns})`,
    })),
    hours: Array.from({ length: 8 }, (_entry, index) => ({
      label: clockAt(windowStart, index * 60),
      top: `${index * 60 * MINUTES_PER_PX}px`,
    })),
    blocks: (data?.blocks ?? [])
      .filter((block) => block.event_day_id === day?.id)
      .map((block) => {
        const minute = Math.round((Date.parse(block.starts_at) - windowStart) / 60_000);
        const index = rooms.findIndex((room) => room.id === block.room_id);
        return {
          label: `${block.label.toUpperCase()} · ${clockAt(windowStart, minute)}`,
          left: block.spans_all_rooms || index < 0 ? "56px" : columnLeft(index),
          w: block.spans_all_rooms || index < 0 ? "auto" : columnWidth(),
          top: `${minute * MINUTES_PER_PX}px`,
          h: `${Math.max(20, block.duration_minutes * MINUTES_PER_PX)}px`,
        };
      }),

    days: days.map((entry, index) => ({
      n: entry.label ?? `Day ${index + 1}`,
      on: () => {
        setDayIndex(index);
        setSelected(null);
        setGhosts([]);
      },
      bg: index === dayIndex ? "var(--cd,#FFFFFF)" : "none",
      fg: index === dayIndex ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
      wt: index === dayIndex ? "600" : "400",
      sh: index === dayIndex ? "0 1px 2px rgba(13,16,32,.10)" : "none",
    })),

    cards: onThisDay.map((row) => {
      const lane = lanes.get(row.id) ?? { lane: 0, of: 1 };
      const minute = minuteOf(row);
      const hue = trackHue(row.track_id);
      return {
        t: row.title,
        sp: row.is_locked ? "Locked" : "",
        spDisp: row.duration_minutes * MINUTES_PER_PX >= 56 && lane.of === 1 ? "block" : "none",
        col: hue,
        time:
          lane.of > 1
            ? clockAt(windowStart, minute)
            : `${clockAt(windowStart, minute)}–${clockAt(windowStart, minute + row.duration_minutes)} · ${row.duration_minutes} min`,
        left: columnLeft(
          Math.max(0, rooms.findIndex((room) => room.id === row.room_id)),
          lane.lane,
          lane.of,
        ),
        w: columnWidth(lane.of),
        top: `${minute * MINUTES_PER_PX}px`,
        h: `${Math.max(24, row.duration_minutes * MINUTES_PER_PX - 2)}px`,
        bd: conflicted.has(row.id)
          ? "1.5px solid var(--cn,#D8432B)"
          : selected === row.id
            ? "1.5px solid var(--sg,#E04E4E)"
            : "1px solid var(--ln,#E1E7E9)",
        sh:
          selected === row.id
            ? "0 4px 12px rgba(16,19,25,.14)"
            : "0 1px 2px rgba(13,16,32,.06)",
        op: drag?.id === row.id ? "0.35" : "1",
        onDown: (event) => beginDrag(event as React.MouseEvent, row, false),
        onClick: (event) => {
          event.stopPropagation();
          setSelected((current) => (current === row.id ? null : row.id));
        },
      };
    }),

    ribbons: conflicts
      .filter((row) => row.kind === "room" && row.session_ids.length > 1)
      .map((row) => {
        const first = onThisDay.find((entry) => entry.id === row.session_ids[0]);
        const index = rooms.findIndex((room) => room.id === first?.room_id);
        const from = Math.round((Date.parse(row.starts_at) - windowStart) / 60_000);
        const to = Math.round((Date.parse(row.ends_at) - windowStart) / 60_000);
        return {
          left: columnLeft(Math.max(0, index)),
          w: columnWidth(),
          top: `${from * MINUTES_PER_PX}px`,
          h: `${Math.max(6, (to - from) * MINUTES_PER_PX)}px`,
        };
      }),

    ghostCards: ghosts.map((ghost) => ({
      t: ghost.title,
      time: `${clockAt(windowStart, ghost.minute)} · ${ghost.duration} MIN`,
      left: columnLeft(ghost.roomIndex),
      w: columnWidth(),
      top: `${ghost.minute * MINUTES_PER_PX}px`,
      h: `${Math.max(44, ghost.duration * MINUTES_PER_PX - 2)}px`,
      onAcc: () => acceptGhosts.mutate([ghost]),
      onRej: () => setGhosts((current) => current.filter((row) => row.ref !== ghost.ref)),
    })),

    dropOn: dragPreview,
    drop: {
      left: dragPreview ? columnLeft(drag.roomIndex) : "56px",
      w: columnWidth(),
      top: `${(drag?.minute ?? 0) * MINUTES_PER_PX}px`,
      h: `${Math.max(24, (drag?.duration ?? 30) * MINUTES_PER_PX - 2)}px`,
      bg:
        previewClash === null
          ? "var(--sw,#FFEAE6)"
          : previewClash.hard
            ? "rgba(216,67,43,.12)"
            : "var(--pdw,#F9EDDF)",
      bd:
        previewClash === null
          ? "var(--sg,#E04E4E)"
          : previewClash.hard
            ? "var(--cn,#D8432B)"
            : "var(--pd,#B96A1F)",
      labTop: `${Math.max(0, (drag?.minute ?? 0) * MINUTES_PER_PX - 18)}px`,
      labFg:
        previewClash === null
          ? "var(--sg,#E04E4E)"
          : previewClash.hard
            ? "var(--cn,#D8432B)"
            : "var(--pd,#B96A1F)",
      label: dragPreview
        ? previewClash === null
          ? `${clockAt(windowStart, drag.minute)} · ${rooms[drag.roomIndex]?.name ?? ""}`
          : `${clockAt(windowStart, drag.minute)} · ${previewClash.why}`
        : "",
    },

    tray: tray.map((row) => ({
      t: row.title,
      col: trackHue(row.track_id),
      meta: `${data?.tracks.find((entry) => entry.id === row.track_id)?.name ?? "No track"} · ${row.duration_minutes} min`,
      op: drag?.id === row.id ? "0.35" : "1",
      onDown: (event) => beginDrag(event as React.MouseEvent, row, true),
    })),
    trayN: tray.length,
    trayEmpty: tray.length === 0,
    q: query,
    onQ: (event) => setQuery((event.target as HTMLInputElement).value),

    hasConf: conflicts.length > 0,
    noConf: conflicts.length === 0,
    noConfItems: conflicts.length === 0,
    confLabel: conflicts.length === 1 ? "1 CONFLICT" : `${conflicts.length} CONFLICTS`,
    confOn: panel === "conflicts",
    openConf: () => setPanel("conflicts"),
    closeConf: () => setPanel("agent"),
    confItems: conflicts.map((row) => ({
      kind: row.severity === "hard" ? row.kind.toUpperCase() : `${row.kind.toUpperCase()} · SOFT`,
      label: `${row.label} · ${clockAt(windowStart, Math.round((Date.parse(row.starts_at) - windowStart) / 60_000))}`,
      onGoto: () => setSelected(row.session_ids[0] ?? null),
      onIgnore: () => {
        const reason = window.prompt("Why is this one acceptable?");
        if (reason !== null && reason.trim() !== "") {
          ignore.mutate({ key: row.conflict_key, reason: reason.trim() });
        }
      },
    })),

    agentOn: panel === "agent",
    aiQ: "",
    onAiQ: () => undefined,
    aiText:
      ghosts.length > 0
        ? `${ghosts.length} proposed. Accept the ones you want; nothing has moved yet.`
        : "First-fit over everything still in the tray. It proposes slots, it does not take them.",
    runAi: () => propose(),
    ran: ghosts.length > 0,
    acceptAll: () => {
      if (ghosts.length > 0) acceptGhosts.mutate(ghosts);
    },
    viewToast: () => setPanel("conflicts"),

    pub: publishOpen,
    openPub: () => setPublishOpen(true),
    closePub: () => setPublishOpen(false),
    doPub: () => publish.mutate(hardCount > 0),
    pubLabel: hardCount > 0 ? `Publish with ${hardCount} clash` : "Publish",
    pubBg: "var(--bt,#FF6B6B)",
    pubFg: "var(--bf,#331313)",
    dirty: `${onThisDay.length} placed · ${tray.length} waiting`,
    discard: () => {
      setGhosts([]);
      refresh();
      toast("Reloaded from the server.");
    },

    // The compose sheet and the track filter are the design's; neither has an
    // endpoint behind it yet, so they stay inert rather than pretending.
    compOn: false,
    compX: () => undefined,
    compAdd: () => undefined,
    cT: "",
    onCT: () => undefined,
    cSp: "",
    onCSp: () => undefined,
    cNo: "",
    onCNo: () => undefined,
    cDay: "",
    onCDay: () => undefined,
    cRoom: "",
    onCRoom: () => undefined,
    cStart: "",
    onCStart: () => undefined,
    cDur: "",
    onCDur: () => undefined,
    cWarn: "",
    cWarnOn: false,
    cWhen: "",
    startOpts: [],
    trOpts: [],
    newSess: () => toast("Sessions are created by promoting an accepted submission."),
    gridDbl: () => toast("Drag a session from the tray to place it."),
    chips: [],
    hasChips: false,
    ck: selected === null ? "" : "✓",
    ckBg: "var(--cd,#FFFFFF)",
    ckBd: "var(--ls,#C8D2D5)",
    togCk: () => {
      if (selected !== null) unschedule.mutate(selected);
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

  return <Agenda d={screen} />;
}
