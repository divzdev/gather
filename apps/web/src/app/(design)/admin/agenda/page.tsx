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
import { useEffect, useMemo, useRef, useState } from "react";

import { useConsoleChrome } from "@/components/console/chrome";
import { Agenda, type AgendaData } from "@/components/design/Agenda";
import { authed, getEventId } from "@/lib/session";

import { allows, parseConstraints } from "./constraints";
import { AgendaView, type ViewKey } from "./views";

const MINUTES_PER_PX = 1.5;
const GRID_MINUTES = 480;
const SNAP = 5;
const TRACK_HUES = ["#3E8896", "#A85788", "#5A6BA8", "#7E5CB8", "#C4703A", "#34526B"] as const;

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

/** A session being written, before it exists.
 *
 *  `startMinute` null is the important case: a keynote can be created with
 *  nowhere to go — a brand-new event has no rooms and no days yet — and it
 *  lands in the unscheduled tray rather than being refused.
 */
type Compose = {
  title: string;
  abstract: string;
  speakerId: string;
  trackId: string | null;
  //: Null is "whatever the agenda is showing", resolved on every render rather
  //: than snapshotted when the sheet opened. The draft query can still be in
  //: flight at that moment, and freezing an empty day here meant picking a time
  //: and getting an unplaced session with no explanation.
  dayId: string | null;
  roomId: string | null;
  startMinute: number | null;
  duration: number;
};

/** The same sheet with its blanks filled in — what actually gets written. */
type Resolved = Omit<Compose, "dayId" | "roomId"> & { dayId: string; roomId: string };

/** A placement, and where the card was before it — which is the whole of what
 *  undo needs. `from` is absent when there is nothing to go back to. */
type Move = {
  id: string;
  roomIndex: number;
  minute: number;
  duration?: number;
  from?: { roomIndex: number; minute: number; fromTray: boolean };
};

const SLOT_MINUTES = 15;

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
  const [view, setView] = useState<ViewKey>("day");
  const [rules, setRules] = useState("");
  /** Chips are derived from the text, so dropping one has to be remembered
   *  separately — rewriting what somebody typed under their cursor is worse
   *  than carrying a small exclusion set. */
  const [dropped, setDropped] = useState<string[]>([]);
  const [unplaceable, setUnplaceable] = useState<string[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  /** Publishing is one of the four things the product refuses to do
   *  optimistically, so the acknowledgement is real state and the button reads
   *  it. It used to be wired to unschedule whatever was selected. */
  const [acknowledged, setAcknowledged] = useState(false);
  /** The new-session sheet. Null is closed, so there is no second flag that can
   *  disagree with the contents. */
  const [compose, setCompose] = useState<Compose | null>(null);
  const composeOpen = compose !== null;
  const [ghosts, setGhosts] = useState<
    {
      ref: string;
      sessionId: string;
      roomIndex: number;
      minute: number;
      title: string;
      duration: number;
    }[]
  >([]);
  const [drag, setDrag] = useState<Dragging | null>(null);
  const dragRef = useRef<Dragging | null>(null);

  const { data } = useQuery({
    queryKey: ["agenda", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Draft>(`/events/${eventId}/schedule/draft`),
  });

  /** Who can be put on a session. Only fetched once the sheet is open: the grid
   *  itself never needs the roster, and most visits never open the sheet. */
  const { data: roster } = useQuery({
    queryKey: ["agenda-roster", eventId],
    enabled: eventId !== null && compose !== null,
    queryFn: () => authed<{ speaker_id: string; name: string }[]>(`/events/${eventId}/speakers`),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["agenda", eventId] });
  };

  const days = useMemo(() => data?.days ?? [], [data]);
  const rooms = useMemo(() => data?.rooms ?? [], [data]);
  const day = days[Math.min(dayIndex, Math.max(0, days.length - 1))] ?? null;

  /** Minute zero of a day's grid, in UTC. Everything else is an offset.
   *
   *  The sheet can place a session on a day other than the one being looked at,
   *  so this takes an id rather than closing over the visible one. */
  const startOfDay = (dayId: string | null | undefined): number => {
    const entry = days.find((row) => row.id === dayId);
    return entry === undefined ? 0 : Date.parse(`${entry.day_date}T${entry.starts_at_local}Z`);
  };

  /** Minute zero of the visible grid, in UTC. */
  const windowStart = useMemo(
    () => (day === null ? 0 : Date.parse(`${day.day_date}T${day.starts_at_local}Z`)),
    [day],
  );

  const place = useMutation({
    mutationFn: (move: Move) =>
      authed<{ conflicts: Conflict[] }>(`/events/${eventId}/sessions/${move.id}/placement`, {
        method: "PATCH",
        body: {
          event_day_id: day?.id,
          room_id: rooms[move.roomIndex]?.id,
          starts_at: new Date(windowStart + move.minute * 60_000).toISOString(),
          ...(move.duration === undefined ? {} : { duration_minutes: move.duration }),
        },
      }),
    onSuccess: (result, move) => {
      refresh();
      const hard = result.conflicts.filter((row) => row.severity === "hard");
      // The undo puts the card back where it was and offers no undo of its own,
      // so the toast chain ends rather than becoming a redo nobody asked for.
      const previous = move.from;
      const revert =
        previous === undefined
          ? undefined
          : previous.fromTray
            ? () => unschedule.mutate(move.id)
            : () =>
                place.mutate({
                  id: move.id,
                  roomIndex: previous.roomIndex,
                  minute: previous.minute,
                });
      toast(
        hard.length === 0
          ? "Placed."
          : `Placed, with ${hard.length} clash${hard.length === 1 ? "" : "es"}. Open the inspector to resolve.`,
        revert,
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

  /** A session with no proposal behind it: the keynote nobody submitted, the
   *  sponsor slot, the panel invented in a planning meeting.
   *
   *  Two calls, because creating and placing are separate concerns in the API
   *  and a session with nowhere to go is a legitimate outcome. If the placement
   *  fails the session still exists — it is in the tray, which is recoverable,
   *  where a rollback would have thrown the typing away. */
  const create = useMutation({
    mutationFn: async (draft: Resolved) => {
      const made = await authed<{ id: string; title: string }>(`/events/${eventId}/sessions`, {
        method: "POST",
        body: {
          title: draft.title.trim(),
          abstract: draft.abstract.trim() === "" ? null : draft.abstract.trim(),
          track_id: draft.trackId,
          duration_minutes: draft.duration,
          speaker_ids: draft.speakerId === "" ? [] : [draft.speakerId],
        },
      });
      const placing = draft.startMinute !== null && draft.dayId !== "" && draft.roomId !== "";
      if (placing) {
        await authed(`/events/${eventId}/sessions/${made.id}/placement`, {
          method: "PATCH",
          body: {
            event_day_id: draft.dayId,
            room_id: draft.roomId,
            starts_at: new Date(
              startOfDay(draft.dayId) + (draft.startMinute ?? 0) * 60_000,
            ).toISOString(),
          },
        });
      }
      return { title: made.title, placed: placing, elsewhere: placing && draft.dayId !== day?.id };
    },
    onSuccess: (result) => {
      setCompose(null);
      refresh();
      // Naming the other day matters: the card is real but off-screen, and
      // "added to the grid" with no visible change reads as a failure.
      toast(
        !result.placed
          ? `Added ${result.title}. It is waiting in the tray.`
          : result.elsewhere
            ? `Added ${result.title} to another day. Switch days to see it.`
            : `Added ${result.title} to the grid.`,
      );
    },
    // The sheet stays open on failure so what was typed is still there.
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
  const slotAt = (
    event: React.MouseEvent | MouseEvent,
  ): { roomIndex: number; minute: number } | null => {
    const target = event.target as HTMLElement | null;
    const grid =
      target?.closest("[data-agenda-grid]") ?? document.querySelector("[data-agenda-grid]");
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

  /** "Delete unschedules", as the header has claimed all along.
   *
   *  Not while the sheet is open, and not while a field has focus — Backspace
   *  belongs to whatever is being typed into. */
  const removeSelected = unschedule.mutate;
  const undoable = toasts.findLast((entry) => entry.revert !== undefined);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        (event.target as HTMLElement | null)?.closest("input, textarea, select") !== null;
      if (typing || composeOpen) return;

      // ⌘Z runs the same revert the toast offers, rather than a second undo
      // stack that could disagree with it.
      if (event.key.toLowerCase() === "z" && (event.metaKey || event.ctrlKey)) {
        if (undoable === undefined) return;
        event.preventDefault();
        undoable.revert?.();
        dismiss(undoable.id);
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selected === null) return;
      event.preventDefault();
      removeSelected(selected);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, composeOpen, removeSelected, undoable, dismiss]);

  /** Open the sheet, optionally on the slot that was double-clicked. */
  const openCompose = (at?: { roomIndex: number; minute: number }) => {
    setCompose({
      title: "",
      abstract: "",
      speakerId: "",
      trackId: null,
      dayId: null,
      roomId: at === undefined ? null : (rooms[at.roomIndex]?.id ?? null),
      startMinute: at?.minute ?? null,
      duration: 30,
    });
  };

  const beginDrag = (event: React.MouseEvent, row: GridSession, fromTray: boolean) => {
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
        place.mutate({
          id: landed.id,
          roomIndex: landed.roomIndex,
          minute: landed.minute,
          from: { roomIndex: started.roomIndex, minute: started.minute, fromTray },
        });
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", finish);
  };

  /** What the rules box was understood to say. Derived, so editing the text
   *  re-reads it immediately and the chips never disagree with the box. */
  const parsed = useMemo(() => {
    const dayStart =
      day === null
        ? 0
        : Number(day.starts_at_local.slice(0, 2)) * 60 + Number(day.starts_at_local.slice(3, 5));
    const read = parseConstraints(rules, rooms, dayStart);
    return { ...read, understood: read.understood.filter((rule) => !dropped.includes(rule.label)) };
  }, [rules, rooms, day, dropped]);

  /** Auto-schedule assist: a first-fit pass over the tray that proposes slots
   *  rather than taking them. Nothing moves until the organiser accepts, which
   *  is the same shape every generated suggestion in this product takes.
   *
   *  Deterministic, and the panel says so — the rules box is pattern matching,
   *  not a model. It used to discard every keystroke, which was the worst of
   *  both: it looked like it was listening and it was not. */
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
    const stuck: string[] = [];
    for (const row of tray) {
      let placed = false;
      for (let minute = 0; minute + row.duration_minutes <= GRID_MINUTES && !placed; minute += 15) {
        for (let index = 0; index < rooms.length && !placed; index += 1) {
          if (
            !allows(parsed.understood, { minute, duration: row.duration_minutes, roomIndex: index })
          ) {
            continue;
          }
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
      // Saying which talks the rules left nowhere to go is the whole value of
      // having rules; silently placing fewer would look like a smaller tray.
      if (!placed) stuck.push(row.title);
    }
    setGhosts(proposed);
    setUnplaceable(stuck);
    setPanel("agent");
    toast(
      proposed.length === 0
        ? "Nothing could be placed under those rules."
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

  /** What the sheet's chosen slot would collide with. A warning and never a
   *  refusal, matching the rule the drag path already follows: the API accepts
   *  a clashing placement and reports it. */
  const canPlace = days.length > 0 && rooms.length > 0;

  /** The sheet's choices with the blanks filled in from what the agenda is
   *  currently showing. Everything downstream — the selects, the warning, the
   *  footer, the write — reads this rather than the raw choice, so a day that
   *  loaded late is picked up everywhere at once. */
  const draft =
    compose === null
      ? null
      : {
          ...compose,
          dayId: compose.dayId ?? day?.id ?? "",
          roomId: compose.roomId ?? rooms[0]?.id ?? "",
        };

  const composeClash = ((): string | null => {
    if (draft === null || draft.startMinute === null || draft.dayId === "") return null;
    const from = draft.startMinute;
    const to = from + draft.duration;
    const onThatDay = (data?.scheduled ?? []).filter((row) => row.event_day_id === draft.dayId);
    const dayStart = startOfDay(draft.dayId);

    for (const row of onThatDay) {
      const start =
        row.starts_at === null ? 0 : Math.round((Date.parse(row.starts_at) - dayStart) / 60_000);
      // Half-open, exactly as the server does it: touching is not overlapping.
      if (!(from < start + row.duration_minutes && start < to)) continue;
      if (row.room_id === draft.roomId) {
        return `${rooms.find((entry) => entry.id === draft.roomId)?.name ?? "That room"} is taken then`;
      }
      if (draft.speakerId !== "" && row.speaker_ids.includes(draft.speakerId)) {
        return "That speaker is already on at that time";
      }
    }
    return null;
  })();

  const composeWhen = ((): string => {
    if (draft === null) return "";
    if (!canPlace) return "No rooms or days yet — it goes to the tray.";
    if (draft.startMinute === null) return "Unplaced. It goes to the tray.";
    const index = days.findIndex((entry) => entry.id === draft.dayId);
    const dayLabel = days[index]?.label ?? `Day ${index + 1}`;
    const room = rooms.find((entry) => entry.id === draft.roomId)?.name ?? "";
    const base = startOfDay(draft.dayId);
    return `${dayLabel} · ${room} · ${clockAt(base, draft.startMinute)}–${clockAt(base, draft.startMinute + draft.duration)}`;
  })();

  /** Edit one field of the sheet. Guarded on null so a stale click after the
   *  sheet closed cannot resurrect it half-filled. */
  const editCompose = (patch: Partial<Compose>) =>
    setCompose((current) => (current === null ? current : { ...current, ...patch }));

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
          Math.max(
            0,
            rooms.findIndex((room) => room.id === row.room_id),
          ),
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
        sh: selected === row.id ? "0 4px 12px rgba(16,19,25,.14)" : "0 1px 2px rgba(13,16,32,.06)",
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
    aiQ: rules,
    onAiQ: (event) => setRules((event.target as HTMLTextAreaElement).value),
    aiText: [
      ghosts.length > 0
        ? `${ghosts.length} proposed. Accept the ones you want; nothing has moved yet.`
        : "First-fit over everything still in the tray. It proposes slots, it does not take them.",
      unplaceable.length === 0
        ? ""
        : `No slot left for ${unplaceable.length}: ${unplaceable.slice(0, 3).join(", ")}${
            unplaceable.length > 3 ? "…" : ""
          }`,
      // Never silently drop a line. If it was not understood, quote it back.
      parsed.ignored.length === 0
        ? ""
        : `Not understood: "${parsed.ignored[0]}". Try "leave 12:00 free", "nothing before 10:00", "nothing after 17:00", or "keep ${rooms[0]?.name ?? "Main Stage"} empty".`,
    ]
      .filter((line) => line !== "")
      .join("\n\n"),
    aiHead:
      ghosts.length === 0
        ? "✦ NOTHING PROPOSED"
        : `✦ PROPOSED · ${ghosts.length} PLACEMENT${ghosts.length === 1 ? "" : "S"}`,
    runAi: () => propose(),
    ran: ghosts.length > 0 || unplaceable.length > 0 || parsed.ignored.length > 0,
    acceptAll: () => {
      if (ghosts.length > 0) acceptGhosts.mutate(ghosts);
    },
    gridOn: view === "day",
    // The five the brief asks for, in the order it lists them. Only "day" is the
    // drag-and-drop grid; the rest are read-only groupings of the same data.
    views: (["list", "day", "week", "track", "room"] as const).map((key) => ({
      label: key[0]!.toUpperCase() + key.slice(1),
      active: view === key,
      on: () => setView(key),
    })),
    alt:
      view === "day" ? null : (
        <AgendaView
          input={{
            view,
            days,
            rooms,
            tracks: (data?.tracks ?? []).map((entry, index) => ({
              id: entry.id,
              name: entry.name,
              hue: TRACK_HUES[index % TRACK_HUES.length] ?? "#3E8896",
            })),
            scheduled: data?.scheduled ?? [],
            unscheduled: data?.unscheduled ?? [],
            conflicted,
            dayId: day?.id ?? null,
            onSelect: (id) => setSelected(id),
          }}
        />
      ),

    pub: publishOpen,
    openPub: () => {
      setAcknowledged(false);
      setPublishOpen(true);
    },
    closePub: () => setPublishOpen(false),
    doPub: () => {
      if (!acknowledged) {
        toast("Tick the box to confirm you have read the change list.");
        return;
      }
      publish.mutate(hardCount > 0);
    },
    pubLabel: hardCount > 0 ? `Publish with ${hardCount} clash` : "Publish",
    pubBg: "var(--bt,#FF6B6B)",
    pubFg: "var(--bf,#331313)",
    dirty: `${onThisDay.length} placed · ${tray.length} waiting`,
    discard: () => {
      setGhosts([]);
      refresh();
      toast("Reloaded from the server.");
    },

    /** The new-session sheet.
     *
     *  Promotion covers the sessions that came from the CFP. It cannot cover the
     *  keynote nobody submitted, and it covers nothing at all on a new event
     *  with no submissions yet — which is where an organiser starts. */
    compOn: compose !== null,
    compX: () => setCompose(null),
    compAdd: () => {
      if (draft === null) return;
      if (draft.title.trim() === "") {
        toast("Give it a title first.");
        return;
      }
      create.mutate(draft);
    },
    cT: compose?.title ?? "",
    onCT: (event) => editCompose({ title: (event.target as HTMLInputElement).value }),
    cNo: compose?.abstract ?? "",
    onCNo: (event) => editCompose({ abstract: (event.target as HTMLTextAreaElement).value }),
    cSp: compose?.speakerId ?? "",
    onCSp: (event) => editCompose({ speakerId: (event.target as HTMLSelectElement).value }),
    spOpts: (roster ?? []).map((person) => ({ v: person.speaker_id, l: person.name })),
    cDay: draft?.dayId ?? "",
    onCDay: (event) => editCompose({ dayId: (event.target as HTMLSelectElement).value }),
    dayOpts: days.map((entry, index) => ({ v: entry.id, l: entry.label ?? `Day ${index + 1}` })),
    cRoom: draft?.roomId ?? "",
    onCRoom: (event) => editCompose({ roomId: (event.target as HTMLSelectElement).value }),
    roomOpts: rooms.map((room) => ({ v: room.id, l: room.name })),
    cStart: compose === null || compose.startMinute === null ? "" : String(compose.startMinute),
    onCStart: (event) => {
      const raw = (event.target as HTMLSelectElement).value;
      editCompose({ startMinute: raw === "" ? null : Number(raw) });
    },
    // "Leave it unplaced" is first because it is the only option that always
    // works — a new event has no rooms and no days to place anything in.
    startOpts: canPlace
      ? [
          { v: "", l: "Leave it in the tray" },
          ...Array.from({ length: GRID_MINUTES / SLOT_MINUTES }, (_entry, index) => ({
            v: String(index * SLOT_MINUTES),
            l: clockAt(startOfDay(draft?.dayId), index * SLOT_MINUTES),
          })),
        ]
      : [{ v: "", l: "Set up rooms and days in Program first" }],
    cDur: String(compose?.duration ?? 30),
    onCDur: (event) => editCompose({ duration: Number((event.target as HTMLSelectElement).value) }),
    trOpts: (data?.tracks ?? []).map((entry) => {
      const hue = trackHue(entry.id);
      const chosen = compose?.trackId === entry.id;
      return {
        n: entry.name,
        col: hue,
        bd: chosen ? hue : "var(--ls,#C8D2D5)",
        bg: chosen ? "var(--sk,#EDF1F2)" : "var(--cd,#FFFFFF)",
        wt: chosen ? "600" : "500",
        // Clicking the chosen track again clears it: a session without a track
        // is valid, and there was otherwise no way back to one.
        on: () => editCompose({ trackId: chosen ? null : entry.id }),
      };
    }),
    cWarn: composeClash ?? "",
    cWarnOn: composeClash !== null,
    cWhen: composeWhen,
    newSess: () => openCompose(),
    // The header has promised "double-click adds" all along.
    gridDbl: (event) => {
      const slot = slotAt(event as React.MouseEvent);
      openCompose(slot ?? undefined);
    },
    chips: parsed.understood.map((rule) => ({
      t: rule.label,
      onX: () => setDropped((current) => [...current, rule.label]),
    })),
    hasChips: parsed.understood.length > 0,
    /** "I have reviewed the change list and the notification recipients."
     *
     *  This was bound to unschedule the selected session, so ticking the box in
     *  the publish dialog quietly took a talk off the grid. */
    ck: acknowledged ? "✓" : "",
    ckBg: acknowledged ? "var(--bt,#FF6B6B)" : "var(--cd,#FFFFFF)",
    ckBd: acknowledged ? "var(--bt,#FF6B6B)" : "var(--ls,#C8D2D5)",
    togCk: () => setAcknowledged((current) => !current),

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
