"use client";

/** The pieces the agenda is drawn from, one screen each.
 *
 *  This was a single page with four stacked sections and an add-form inside
 *  every one of them: to reach event days you scrolled past three other
 *  editors, and nothing told you what was already configured. Each piece now has
 *  its own page behind a section nav.
 *
 *  The add-form used to sit *underneath* the list it adds to, so the screen's
 *  primary action was the last thing on it — fine at four rooms, unreachable at
 *  two hundred, and it forced an empty state whose only advice was to look
 *  further down. Creating now starts from a button in the page header and
 *  happens in a drawer, with the list still visible beside it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { SideDrawer } from "@/components/console/SideDrawer";
import { EmptyState, PAGE_ICON, PageHead, card, pill, quietPill } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { authed } from "@/lib/session";
import { useSubmitOnce } from "@/lib/submitOnce";

type Row = Record<string, unknown> & { id: string; name?: string };

/** Track hues are an index into the design's palette, not free-form colour. */
const HUES = [
  "#3E8896",
  "#A85788",
  "#5A6BA8",
  "#7E5CB8",
  "#C4703A",
  "#34526B",
  "#0E7A5F",
  "#B96A1F",
];

type Field = {
  key: string;
  label: string;
  placeholder: string;
  type?: string;
  /** What a new row starts with. The API defaults an event day to 09:00–18:00
   *  whether or not the form sends anything, so showing blank inputs would hide
   *  a value that is about to be written. */
  initial?: string;
  /** Half-width, so two related fields share a row. A start and an end read as
   *  one control and stack into a column of four boxes without it. */
  half?: true;
  /** Rendered under the input. Says what the value does, not what it is. */
  hint?: string;
  /** `hue` swaps the input for the palette itself — asking someone to type a
   *  number between 1 and 8 to choose a colour is a question with a visible
   *  answer they cannot see. */
  kind?: "hue";
};

type Panel = {
  key: string;
  path: string;
  title: string;
  /** What one of them is called, for buttons and confirmations. */
  singular: string;
  blurb: string;
  /** Why this exists, for the screen with nothing on it yet. */
  emptyBody: string;
  /** What creating one will do. Never a repeat of `blurb` — the page summary is
   *  still on screen behind the drawer. */
  createHint: string;
  /** What an edit will change beyond this row, stated before it is committed.
   *  Returns null when the pending change has no reach. */
  cascade?: (draft: Record<string, string>, row: Row) => string | null;
  /** Turns the new-row form values into a create body. */
  build: (draft: Record<string, string>) => Record<string, unknown> | string;
  fields: Field[];
  describe: (row: Row) => string;
  /** A second line under the row's name, for rows whose interesting content is
   *  what they hold rather than what they are called. Only event days have it:
   *  a room is a name and a capacity, but a day is a container, and a list of
   *  containers that will not say whether they are full is not much of a list. */
  secondary?: (row: Row) => string;
};

const PANELS: Panel[] = [
  {
    key: "rooms",
    path: "rooms",
    title: "Rooms",
    singular: "room",
    blurb: "Every place a session can happen. These become the agenda's columns.",
    emptyBody:
      "Rooms are the columns of the agenda grid. Add the spaces your sessions run in and the grid draws itself around them.",
    createHint: "Rooms appear as agenda columns in the order you add them.",
    fields: [
      { key: "name", label: "Room name", placeholder: "Main Stage" },
      {
        key: "capacity",
        label: "Capacity",
        placeholder: "800",
        type: "number",
        hint: "Optional. Shown when a session is bigger than the room it is in.",
      },
    ],
    build: (draft) => {
      if ((draft.name ?? "").trim() === "") return "A room needs a name.";
      const capacity = Number(draft.capacity);
      return {
        name: draft.name!.trim(),
        capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
      };
    },
    describe: (row) => (row.capacity ? `seats ${String(row.capacity)}` : "no capacity set"),
  },
  {
    key: "tracks",
    path: "tracks",
    title: "Tracks",
    singular: "track",
    blurb: "The themes you file talks under. Each gets a colour on the grid.",
    emptyBody:
      "Tracks are the themes you file talks under. Each takes a colour on the grid and becomes a filter on the public schedule.",
    createHint: "Pick a colour you can tell apart at a glance on a full grid.",
    fields: [
      { key: "name", label: "Track name", placeholder: "Platform & Infra" },
      {
        key: "hue_index",
        label: "Colour",
        placeholder: "1",
        kind: "hue",
        hint: "Used for this track's cards on the agenda and the public schedule.",
      },
    ],
    build: (draft) => {
      if ((draft.name ?? "").trim() === "") return "A track needs a name.";
      const hue = Number(draft.hue_index);
      return {
        name: draft.name!.trim(),
        hue_index: Number.isFinite(hue) && hue >= 1 && hue <= 8 ? hue : 1,
      };
    },
    describe: (row) => `colour ${String(row.hue_index ?? 1)}`,
  },
  {
    key: "session-formats",
    path: "session-formats",
    title: "Session formats",
    singular: "format",
    blurb: "Talk, workshop, keynote. The default duration pre-fills a new session.",
    emptyBody:
      "Formats are the shapes your programme comes in — talk, workshop, keynote. Each carries a default length.",
    createHint: "The default length pre-fills a session, so you are not typing 30 every time.",
    fields: [
      { key: "name", label: "Format name", placeholder: "Talk (30 min)" },
      {
        key: "default_duration_minutes",
        label: "Default minutes",
        placeholder: "30",
        type: "number",
        hint: "Between 5 and 600. Pre-fills the length when a session takes this format.",
      },
    ],
    build: (draft) => {
      if ((draft.name ?? "").trim() === "") return "A format needs a name.";
      const minutes = Number(draft.default_duration_minutes);
      if (!Number.isFinite(minutes) || minutes < 5 || minutes > 600) {
        return "Default duration must be between 5 and 600 minutes.";
      }
      return { name: draft.name!.trim(), default_duration_minutes: minutes };
    },
    describe: (row) => `${String(row.default_duration_minutes ?? 30)} min by default`,
  },
  {
    key: "days",
    path: "days",
    title: "Event days",
    singular: "day",
    blurb: "One row per day the conference runs. The agenda gets a tab for each.",
    emptyBody:
      "Add the dates your conference runs. Each becomes a tab on the agenda, and sessions are placed inside it.",
    createHint: "A day with no label is shown by its date.",
    fields: [
      { key: "day_date", label: "Date", placeholder: "2027-05-12", type: "date" },
      {
        key: "starts_at_local",
        label: "Doors open",
        placeholder: "09:00",
        type: "time",
        initial: "09:00",
        half: true,
      },
      {
        key: "ends_at_local",
        label: "Doors close",
        placeholder: "18:00",
        type: "time",
        initial: "18:00",
        half: true,
        hint: "The hours the agenda grid covers for this day. A workshop day that starts at 13:00 draws a shorter grid than the keynote day.",
      },
      {
        key: "label",
        label: "Label",
        placeholder: "Day one",
        hint: "Optional. Shown after the date, never instead of it.",
      },
    ],
    cascade: (draft, row) => {
      const was = String(row.day_date ?? "");
      const now = draft.day_date ?? "";
      if (now === "" || now === was) return null;
      // The API shifts them by the same delta rather than stranding them, but
      // the reader is looking at a list of days and cannot see the agenda move.
      return "Every session and break already on this day moves with it, keeping its time of day.";
    },
    build: (draft) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.day_date ?? "")) return "Pick a date.";
      const opens = draft.starts_at_local ?? "";
      const closes = draft.ends_at_local ?? "";
      if (!/^\d{2}:\d{2}/.test(opens) || !/^\d{2}:\d{2}/.test(closes)) {
        return "A day needs an opening and a closing time.";
      }
      // Checked here as well as by the API, so the reason arrives without a
      // round trip and names the two values rather than the two field names.
      if (opens >= closes) return `A day cannot close at ${closes} and open at ${opens}.`;
      return {
        day_date: draft.day_date,
        starts_at_local: opens,
        ends_at_local: closes,
        label: (draft.label ?? "").trim() === "" ? null : draft.label!.trim(),
      };
    },
    // Beside Remove, so the cost of deleting a day is legible before the click
    // rather than in the refusal afterwards.
    describe: (row) => {
      const sessions = Number(row.session_count ?? 0);
      return sessions === 0 ? "empty" : `${sessions} session${sessions === 1 ? "" : "s"}`;
    },
    secondary: dayLine,
  },
];

/** The API serialises a time as `09:00:00`; nobody wants to read the seconds. */
function hhmm(value: unknown, fallback: string): string {
  return String(value ?? fallback).slice(0, 5);
}

/** A timestamp as a wall-clock time in the event's own day.
 *
 *  Formatted in UTC deliberately. These come back as `timestamptz`, and the
 *  browser's timezone is not the conference's — rendering a 09:00 Pacific
 *  keynote in a European browser as 18:00 would be worse than showing nothing.
 */
const CLOCK = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

/** What the day actually holds, under its date.
 *
 *  Every figure is derived by the API from what is filed against this day, so
 *  an empty day says it is empty rather than echoing its opening window back
 *  and reading like a day that has been built.
 */
function dayLine(row: Row): string {
  const window = `${hhmm(row.starts_at_local, "09:00")}–${hhmm(row.ends_at_local, "18:00")} open`;
  const sessions = Number(row.session_count ?? 0);
  const breaks = Number(row.break_count ?? 0);
  const parts = [window];

  if (sessions === 0) {
    parts.push("nothing scheduled yet");
  } else {
    const rooms = Number(row.room_count ?? 0);
    const first = row.first_session_at;
    // `last_session_at` is the last session's *start*, not its end — so this
    // says "first at / last starts", never a span it cannot vouch for.
    const last = row.last_session_at;
    const where = rooms > 0 ? ` in ${rooms} room${rooms === 1 ? "" : "s"}` : "";
    const when =
      typeof first === "string" && typeof last === "string"
        ? `, first at ${CLOCK.format(new Date(first))}, last starts ${CLOCK.format(new Date(last))}`
        : "";
    parts.push(`${sessions} session${sessions === 1 ? "" : "s"}${where}${when}`);
  }

  if (breaks > 0) parts.push(`${breaks} break${breaks === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** What the row calls itself. The remove control has to name the same thing the
 *  row shows, or a screen reader announces a button for something else.
 *
 *  A day leads with its date, never with its label. The label is free text and
 *  is regularly something like "25" or a placeholder somebody typed once — the
 *  row showing that *instead of* the date left you unable to tell which day of
 *  the conference you were looking at.
 */
function label(row: Row): string {
  if (row.day_date !== undefined && row.day_date !== null) {
    // Parsed as UTC midnight; formatting in local time would move the date
    // itself backwards a day anywhere west of Greenwich.
    return DATE.format(new Date(`${String(row.day_date)}T00:00:00Z`));
  }
  return String(row.name ?? row.label ?? "");
}

/** The day's own name, shown after its date rather than in place of it. */
function subLabel(row: Row): string {
  const own = String(row.label ?? "").trim();
  return row.day_date !== undefined && own !== "" ? own : "";
}

/** What deleting this row is already known to cost, before the API is asked.
 *
 *  `session_count` comes back on every program resource for exactly this
 *  reason (see the API's `Read` base schema) — it is the same number the
 *  delete guard checks, so a row known to be in use can say so up front
 *  instead of spending a click finding out. Event days also carry
 *  `break_count`; rooms and days can still be refused for schedule blocks the
 *  list payload does not carry, which is why a `null` here reads as "nothing
 *  known to be attached", never as a guarantee the delete will succeed.
 */
function knownUsage(panel: Panel, row: Row): string | null {
  const sessions = Number(row.session_count ?? 0);
  const breaks = panel.key === "days" ? Number(row.break_count ?? 0) : 0;
  if (sessions === 0 && breaks === 0) return null;

  const bits = [
    sessions > 0 ? `${sessions} session${sessions === 1 ? "" : "s"}` : null,
    breaks > 0 ? `${breaks} break${breaks === 1 ? "" : "s"}` : null,
  ].filter((bit): bit is string => bit !== null);
  const plural = bits.length > 1 || sessions > 1 || breaks > 1;
  const noun = panel.key === "days" ? "day" : panel.singular;

  return `${bits.join(" and ")} ${plural ? "are" : "is"} still attached to this ${noun}. Move ${
    plural ? "them" : "it"
  } first — deleting it would take ${plural ? "them" : "it"} with it.`;
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  height: 38,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid var(--ls)",
  background: "var(--cd)",
  font: "400 13.5px var(--font-plex-sans)",
  color: "var(--ik)",
};

/** The one destructive control on this screen. Filled with the negative tint
 *  rather than a ghost border, so it never reads as a second Edit — and tall
 *  enough that a slip of the thumb lands on the row, not the button. */
const dangerPill = {
  height: "var(--control-h-md, 44px)",
  padding: "0 20px",
  borderRadius: 999,
  border: "1px solid var(--cnl)",
  background: "var(--cnw)",
  color: "var(--cn)",
  font: "600 12.5px var(--font-plex-sans)",
};

function useRefresh(panelKey: string, eventId: string | null): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: [panelKey, eventId] });
    void queryClient.invalidateQueries({ queryKey: ["agenda", eventId] });
  };
}

/** The form values an existing row starts from. The field keys are the API's
 *  own column names, so this needs no per-panel mapping. */
function draftOf(panel: Panel, row: Row | null): Record<string, string> {
  if (row === null) {
    return Object.fromEntries(
      panel.fields
        .filter((field) => field.initial !== undefined)
        .map((field) => [field.key, field.initial!]),
    );
  }
  return Object.fromEntries(
    panel.fields.map((field) => {
      const value = row[field.key] == null ? "" : String(row[field.key]);
      // The API serialises a time as `09:00:00`. A `<input type="time">` shows
      // a seconds box when it is given one, so an edit drawer would open with
      // a third segment nobody asked for and no way to reach it.
      return [field.key, field.type === "time" ? value.slice(0, 5) : value];
    }),
  );
}

/** Create and edit in one drawer.
 *
 *  Mounted with a `key` that changes per row, so the draft is seeded by
 *  construction and resets by unmounting — rather than by an effect that syncs
 *  props into state and has to remember every field on the way back out.
 */
function RowDrawer({
  panel,
  eventId,
  editing,
  open,
  onClose,
}: {
  panel: Panel;
  eventId: string | null;
  /** The row being changed, or null to create a new one. */
  editing: Row | null;
  open: boolean;
  onClose: () => void;
}) {
  const once = useSubmitOnce();
  const refresh = useRefresh(panel.key, eventId);
  const [draft, setDraft] = useState<Record<string, string>>(() => draftOf(panel, editing));
  const [problem, setProblem] = useState("");

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      authed(
        editing === null
          ? `/events/${eventId}/${panel.path}`
          : `/events/${eventId}/${panel.path}/${editing.id}`,
        { method: editing === null ? "POST" : "PATCH", body },
      ),
    onSuccess: () => {
      setProblem("");
      refresh();
      onClose();
    },
    onError: (error: Error) => setProblem(error.message),
  });

  const submit = () =>
    once(() => {
      const built = panel.build(draft);
      if (typeof built === "string") {
        setProblem(built);
        return;
      }
      save.mutate(built);
    });

  const set = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  // What this edit will do beyond the row itself. Shown before it is committed,
  // because the effect reaches rows on a screen the reader is not looking at.
  const cascade = editing === null ? null : (panel.cascade?.(draft, editing) ?? null);

  return (
    <SideDrawer
      open={open}
      title={editing === null ? `New ${panel.singular}` : `Edit ${label(editing)}`}
      subtitle={editing === null ? panel.createHint : undefined}
      onClose={onClose}
      footer={
        <>
          <button type="button" style={quietPill} onClick={onClose}>
            Cancel
          </button>
          <button type="button" style={pill} disabled={save.isPending} onClick={submit}>
            {save.isPending
              ? "Saving…"
              : editing === null
                ? `Add ${panel.singular}`
                : "Save changes"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        // Half-width fields pair up on one row; everything else spans both
        // columns, so a form with no pairs looks exactly as it did.
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}
      >
        {panel.fields.map((field) => (
          <div
            key={field.key}
            style={{
              display: "grid",
              gap: 6,
              gridColumn: field.half === true ? "auto" : "1 / -1",
              // Pack to the top. Two half-width fields share a row, and if one
              // carries a hint its cell is taller — stretching would push the
              // shorter cell's input down and misalign the pair.
              alignContent: "start",
            }}
          >
            <label
              htmlFor={`new-${panel.key}-${field.key}`}
              style={{ font: "500 12px var(--font-plex-sans)", color: "var(--i2)" }}
            >
              {field.label}
            </label>

            {field.kind === "hue" ? (
              <div
                id={`new-${panel.key}-${field.key}`}
                role="radiogroup"
                aria-label={field.label}
                style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
              >
                {HUES.map((hue, index) => {
                  const value = String(index + 1);
                  const chosen = (draft[field.key] ?? "1") === value;
                  return (
                    <button
                      key={hue}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      aria-label={`Colour ${value}`}
                      onClick={() => set(field.key, value)}
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 9,
                        border: "none",
                        background: hue,
                        boxShadow: chosen
                          ? "0 0 0 2px var(--cd), 0 0 0 4px var(--sg)"
                          : "inset 0 0 0 1px rgba(0,0,0,.14)",
                      }}
                    />
                  );
                })}
              </div>
            ) : (
              <input
                id={`new-${panel.key}-${field.key}`}
                type={field.type ?? "text"}
                value={draft[field.key] ?? ""}
                placeholder={field.placeholder}
                onChange={(event) => set(field.key, event.target.value)}
                style={inputStyle}
              />
            )}

            {field.hint === undefined ? null : (
              <p
                style={{
                  font: "400 11.5px/1.5 var(--font-plex-sans)",
                  color: "var(--i4)",
                  margin: 0,
                }}
              >
                {field.hint}
              </p>
            )}
          </div>
        ))}

        {cascade === null ? null : (
          <p
            style={{
              font: "400 12.5px/1.5 var(--font-plex-sans)",
              color: "var(--pd)",
              background: "var(--pdw)",
              border: "1px solid var(--pdl)",
              borderRadius: 8,
              padding: "9px 12px",
              margin: 0,
            }}
          >
            {cascade}
          </p>
        )}

        {problem === "" ? null : (
          <p
            role="alert"
            style={{
              font: "400 12.5px/1.5 var(--font-plex-sans)",
              color: "var(--cn)",
              background: "var(--cnw)",
              border: "1px solid var(--cnl)",
              borderRadius: 8,
              padding: "9px 12px",
              margin: 0,
            }}
          >
            {problem}
          </p>
        )}

        {/* Enter submits from any field; the visible button lives in the footer. */}
        <button type="submit" style={{ display: "none" }} aria-hidden="true" tabIndex={-1} />
      </form>
    </SideDrawer>
  );
}

/** The one confirmation on this screen that has to stop the click rather than
 *  just announce it — the row it names is gone for good, and the row is the
 *  only context left once it is.
 *
 *  A centred dialog, not `SideDrawer`: that component frames a form to fill
 *  in, and this is one decision with two answers. It still takes focus and
 *  closes on Escape, because a destructive prompt earns that even at a
 *  fraction of the size.
 */
function DeleteConfirm({
  panel,
  row,
  pending,
  problem,
  onCancel,
  onConfirm,
}: {
  panel: Panel;
  row: Row;
  pending: boolean;
  /** Set only once a real attempt has been refused — replaces the guess below
   *  with what the API actually said, breaks included. */
  problem: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const usage = knownUsage(panel, row);
  // A count already in hand (sessions, and for a day, breaks) is a guaranteed
  // 409 — the delete guard in program/router.py refuses every one of them.
  // Asking the API to confirm what the list already knows wastes the click.
  const blocked = usage !== null;
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(13,16,32,.4)",
        display: "grid",
        placeItems: "center",
        padding: 20,
        zIndex: 140,
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="program-delete-title"
        aria-describedby="program-delete-body"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 440,
          maxWidth: "100%",
          background: "var(--cd)",
          border: "1px solid var(--ln)",
          borderRadius: 14,
          padding: 22,
          boxShadow: "0 24px 60px rgba(13,16,32,.28)",
          display: "grid",
          gap: 14,
        }}
      >
        <p
          id="program-delete-title"
          style={{ font: "600 15px var(--font-plex-sans)", color: "var(--ik)", margin: 0 }}
        >
          Delete the {panel.singular} “{label(row)}”?
        </p>
        <p
          id="program-delete-body"
          role={problem === "" ? undefined : "alert"}
          style={{
            font: "400 13px/1.6 var(--font-plex-sans)",
            color: problem === "" ? "var(--i3)" : "var(--cn)",
            margin: 0,
          }}
        >
          {problem !== "" ? problem : (usage ?? "This can't be undone.")}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button ref={cancelRef} type="button" style={quietPill} onClick={onCancel}>
            {blocked ? "Close" : "Cancel"}
          </button>
          {blocked ? null : (
            <button
              type="button"
              style={{ ...dangerPill, opacity: pending ? 0.7 : 1 }}
              disabled={pending}
              onClick={onConfirm}
            >
              {pending ? "Deleting…" : `Delete ${panel.singular}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function List({
  panel,
  eventId,
  onAdd,
  onEdit,
}: {
  panel: Panel;
  eventId: string | null;
  onAdd: () => void;
  onEdit: (row: Row) => void;
}) {
  const refresh = useRefresh(panel.key, eventId);
  const [problem, setProblem] = useState("");
  /** The row a delete has been asked for but not yet committed. Holding the
   *  row itself, not just its id, is what lets the dialog keep naming it
   *  after `onEdit`/`onAdd` change what else is on screen. */
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);

  const { data, isPending: rowsLoading } = useQuery({
    queryKey: [panel.key, eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Row[]>(`/events/${eventId}/${panel.path}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      authed(`/events/${eventId}/${panel.path}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setProblem("");
      setConfirmDelete(null);
      refresh();
    },
    // Deleting something a session still points at is refused by the database;
    // say so rather than showing a raw constraint error. Anything else (a
    // dropped connection, a 500) gets its own honest line instead of the same
    // "still in use" guess, which would be a lie the rest of the time.
    onError: (error: Error) =>
      setProblem(
        error instanceof ApiError && error.status === 409
          ? error.message
          : `Something went wrong deleting this ${panel.singular}. Try again.`,
      ),
  });

  const rows = data ?? [];

  if (rowsLoading) {
    return (
      <div style={{ ...card, padding: "48px 24px", textAlign: "center" }}>
        <p style={{ font: "400 13px var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}>
          Loading {panel.title.toLowerCase()}…
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={`No ${panel.title.toLowerCase()} yet`}
        body={panel.emptyBody}
        action={
          <button type="button" style={pill} onClick={onAdd}>
            Add the first {panel.singular}
          </button>
        }
      />
    );
  }

  return (
    <>
      <section style={{ ...card, padding: 8 }}>
        <div style={{ display: "grid", gap: 2 }}>
          {rows.map((row) => (
            <div
              key={row.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 9,
              }}
            >
              {panel.key === "tracks" ? (
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    flex: "none",
                    background: HUES[(Number(row.hue_index ?? 1) - 1) % HUES.length],
                  }}
                />
              ) : null}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ font: "500 13.5px var(--font-plex-sans)", color: "var(--ik)" }}>
                    {label(row)}
                  </span>
                  {subLabel(row) === "" ? null : (
                    <span style={{ font: "400 12.5px var(--font-plex-sans)", color: "var(--i3)" }}>
                      · {subLabel(row)}
                    </span>
                  )}
                </span>
                {panel.secondary === undefined ? null : (
                  <span
                    style={{
                      display: "block",
                      font: "400 11.5px var(--font-plex-mono)",
                      color: "var(--i4)",
                      marginTop: 3,
                    }}
                  >
                    {panel.secondary(row)}
                  </span>
                )}
              </span>
              <span style={{ font: "400 11.5px var(--font-plex-mono)", color: "var(--i4)" }}>
                {panel.describe(row)}
              </span>
              <button
                onClick={() => onEdit(row)}
                aria-label={`Edit ${label(row)}`}
                style={quietPill}
              >
                Edit
              </button>
              <button
                onClick={() => {
                  setProblem("");
                  setConfirmDelete(row);
                }}
                aria-label={`Delete ${label(row)}`}
                style={dangerPill}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </section>

      {confirmDelete === null ? null : (
        <DeleteConfirm
          panel={panel}
          row={confirmDelete}
          pending={remove.isPending}
          problem={problem}
          onCancel={() => {
            setConfirmDelete(null);
            setProblem("");
          }}
          onConfirm={() => remove.mutate(confirmDelete.id)}
        />
      )}
    </>
  );
}

/** One program section end to end: its header, its list, and its create drawer.
 *  The header's button and the empty state's button open the same drawer, so
 *  there is one way to create and it is visible from the top of the screen. */
function ProgramSection({
  panel,
  crumbs,
  eventId,
}: {
  panel: Panel;
  crumbs: readonly string[];
  eventId: string | null;
}) {
  /** null = closed, "new" = creating, a Row = editing that row. */
  const [open, setOpen] = useState<Row | "new" | null>(null);

  return (
    <>
      <PageHead
        icon={PAGE_ICON.program}
        crumbs={crumbs}
        title={panel.title}
        summary={panel.blurb}
        right={
          <button type="button" style={pill} onClick={() => setOpen("new")}>
            Add a {panel.singular}
          </button>
        }
      />
      <List
        panel={panel}
        eventId={eventId}
        onAdd={() => setOpen("new")}
        onEdit={(row) => setOpen(row)}
      />
      {open === null ? null : (
        <RowDrawer
          // Remounts per row, so the draft is seeded from whichever record was
          // opened instead of carrying the last one's values across.
          key={open === "new" ? "new" : open.id}
          panel={panel}
          eventId={eventId}
          editing={open === "new" ? null : open}
          open
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

export { List, PANELS, ProgramSection, label, HUES };
export type { Panel, Row };
