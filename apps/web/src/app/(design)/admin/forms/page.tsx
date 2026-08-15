"use client";

/** The form list, and the six-step builder behind it.
 *
 *  Everything the wizard edits is one `schema` blob plus a few columns on the
 *  form row, so each step writes the same PATCH. Saving is explicit rather than
 *  keystroke-by-keystroke: the server refuses structural changes once a form has
 *  submissions, and finding that out on every character typed would be miserable.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { useConsoleChrome } from "@/components/console/chrome";
import { stripData, useProgramStats } from "@/components/console/stats";
import { SectionTabs } from "@/components/console/SectionTabs";
import { Forms, type FormsData } from "@/components/design/Forms";
import {
  blankField,
  FieldEditor,
  type Field as EditableField,
} from "@/components/forms/FieldEditor";
import { LogicEditor } from "@/components/forms/LogicEditor";
import { pill, quietPill } from "@/components/ui";
import { authed } from "@/lib/session";

type Choice = { value: string; label: string };

type Field = {
  key: string;
  type: string;
  label: string;
  help_text: string | null;
  required: boolean;
  choices: Choice[];
  max_length?: number | null;
  identity_bearing: boolean;
  hidden_from_new: boolean;
};

/** show/hide a field when another field's answer matches. */
type Rule = { field: string; operator: string; value: unknown; action: string; target: string };

type Role = {
  key: string;
  label: string;
  enabled: boolean;
  minimum: number;
  maximum: number;
};

type Settings = {
  allow_drafts: boolean;
  allow_co_speakers: boolean;
  max_co_speakers: number;
  confirmation_message: string;
  welcome_message: string;
  require_terms: boolean;
  page_heading: string;
  collect_participants: boolean;
  participant_roles: Role[];
  notify_admins_on_submit: boolean;
  confirm_participants: boolean;
};

type Section = { key: string; title: string; description: string | null; fields: Field[] };

type Schema = { sections: Section[]; logic: Rule[]; settings: Settings };

type FormRow = {
  id: string;
  name: string;
  kind: string;
  schema: Schema;
  status: string;
  is_locked: boolean;
  opens_at: string | null;
  closes_at: string | null;
};

const STEPS = [
  { n: "What you collect", sub: "Sessions or abstracts" },
  { n: "Welcome screen", sub: "Message and terms" },
  { n: "Submission questions", sub: "The form itself" },
  { n: "Participants", sub: "Roles and contact fields" },
  { n: "Form settings", sub: "Deadline, limits, drafts" },
  { n: "Notifications", sub: "Alerts and reminders" },
] as const;

const KINDS = [
  { key: "cfp", n: "Call for papers", d: "Talk proposals from speakers you have not met yet." },
  { key: "task", n: "Speaker task", d: "A form you send to people already on the programme." },
] as const;

/** Three words for three states, and no fourth.
 *
 *  This screen briefly carried four names for the same two conditions: a
 *  "Draft" pill, a "Live and collecting" tile, an "Open" tab, and Open/Close
 *  buttons. Three of those meant the same thing. The tile was the outlier and
 *  now says "Open" like everything else.
 *
 *  These labels match the API's `FormStatus` deliberately — when the vocabulary
 *  on screen is the vocabulary in the payload, a support conversation and a log
 *  line describe the same thing.
 */
const STATUS: Record<string, { l: string; fg: string; bg: string }> = {
  open: { l: "Open", fg: "var(--ok,#0E7A5F)", bg: "var(--okw,#E2F1EC)" },
  draft: { l: "Draft", fg: "var(--if,#47599F)", bg: "var(--ifw,#E9ECF7)" },
  closed: { l: "Closed", fg: "var(--i3,#6B7B84)", bg: "var(--sk,#EDF1F2)" },
};

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function check(on: boolean) {
  return {
    ck: on ? "✓" : "",
    ckBg: on ? "var(--sg,#E04E4E)" : "var(--cd,#FFFFFF)",
    ckBd: on ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)",
  };
}

/** The background of a selected *row*, which is not the background of a
 *  selected *checkbox*.
 *
 *  `check().ckBg` is the accent at full strength, correct for a 14px square with
 *  a white tick on it. It was also being handed to whole rows as their
 *  background — so selecting "Collect participant details" painted the entire
 *  row solid coral and left its label and help text in their normal dark ink on
 *  top of it, which is both unreadable and reads as an error state rather than a
 *  selection. Selection is a tint plus an accent border; emphasis at full
 *  strength belongs to the small thing that is actually ticked.
 */
function rowTint(on: boolean) {
  return {
    bg: on ? "var(--sw,#FFEAE6)" : "var(--cd,#FFFFFF)",
    bd: on ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)",
  };
}

export default function FormsPage() {
  const { toasts, toast, dismiss } = useConsoleChrome();
  const { stats, eventId } = useProgramStats();
  const queryClient = useQueryClient();

  const [openId, setOpenId] = useState<string | null>(null);
  /** Closing an open form is one of the never-optimistic actions: speakers
   *  lose the live form the moment it lands. First click arms, second click
   *  does it; anything else disarms. */
  const [armedClose, setArmedClose] = useState<string | null>(null);
  useEffect(() => {
    if (armedClose === null) return undefined;
    const timer = window.setTimeout(() => setArmedClose(null), 5000);
    return () => window.clearTimeout(timer);
  }, [armedClose]);
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<"All" | "Open" | "Draft">("All");
  const [edit, setEdit] = useState<FormRow | null>(null);
  //  null = closed. A field with an empty key is a new one being added.
  const [editing, setEditing] = useState<EditableField | null>(null);
  const dragging = useRef<number | null>(null);

  const { data: forms } = useQuery({
    queryKey: ["forms", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<FormRow[]>(`/events/${eventId}/forms`),
  });

  const save = useMutation({
    mutationFn: (row: FormRow) =>
      authed<FormRow>(`/events/${eventId}/forms/${row.id}`, {
        method: "PATCH",
        body: { name: row.name, kind: row.kind, schema: row.schema, closes_at: row.closes_at },
      }),
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: ["forms", eventId] });
      setEdit(row);
      toast(`Saved “${row.name}”.`);
    },
    // A locked form rejects structural edits by design, and the message says
    // which field caused it, so it goes straight through.
    onError: (problem: Error) => toast(problem.message),
  });

  /** A real copy of the schema, unlocked and back in draft — the point of
   *  duplicating a form is to change it, and the original may be locked because
   *  submissions have arrived. */
  /** Read straight from the event rather than through `stats`, whose `Event`
   *  type is shared with several screens and belongs to another session. */
  const { data: eventRow } = useQuery({
    queryKey: ["event", eventId],
    enabled: eventId !== null,
    queryFn: () =>
      authed<{
        slug: string;
        timezone: string;
        ends_on: string;
        created_at: string;
        submission_limit_per_speaker: number | null;
      }>(`/events/${eventId}`),
  });

  /** The window a call for papers can legally close in.
   *
   *  Lower bound is now: a deadline already past closes the call the moment it
   *  opens, and the public page would show a countdown that has finished.
   *  Upper bound is the last day of the event: soliciting talks for a conference
   *  that has already ended is not a deadline anyone meant to set.
   *
   *  Reported rather than silently clamped — an organiser who typed 1987 made a
   *  mistake worth showing them, and a value quietly moved to something else is
   *  how you end up with a deadline nobody chose.
   */
  // Read once when the builder mounts rather than on every render: reading the
  // clock during render is impure, and a lower bound that slides as you type
  // would invalidate a value you had just chosen.
  const [openedAt] = useState(() => {
    const pad = (value: number) => String(value).padStart(2, "0");
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  });

  const closeBounds = useMemo(() => {
    // `ends_on` is a calendar date; the deadline may sit anywhere on that day.
    const max = eventRow === undefined ? "" : `${eventRow.ends_on}T23:59`;

    /* The picker's floor is when the event was created, not `now`.
     *
     * `now` was both too strict and too loose. Too strict, because a deadline
     * already in the past is a real thing to record — a call that has closed —
     * and the greyed-out picker made it unreachable while the app still allowed
     * it. Too loose, because `min` never stopped anything typed or pasted: a
     * mistyped year reached the state, showed a red line, and saved anyway.
     *
     * So the bound is now the same rule the API enforces, and the two messages
     * below are ranked to match: before the event existed is an error, already
     * passed is a warning about something legal. */
    const floor = eventRow === undefined ? openedAt : eventRow.created_at.slice(0, 16);

    const chosen = edit?.closes_at ?? null;
    let problem: string | null = null;
    if (chosen !== null) {
      const when = new Date(chosen);
      if (eventRow !== undefined && when < new Date(eventRow.created_at)) {
        problem = `That is before this event existed, so it cannot be right — check the year. The event was created ${DAY.format(new Date(eventRow.created_at))}.`;
      } else if (max !== "" && when > new Date(`${eventRow?.ends_on}T23:59:59`)) {
        problem = `The call cannot close after the event ends on ${eventRow?.ends_on}.`;
      } else if (when < new Date(openedAt)) {
        problem = "That deadline has already passed, so the call would close as soon as it opens.";
      }
    }
    return { min: floor, max, problem };
  }, [edit?.closes_at, eventRow, openedAt]);

  const duplicate = useMutation({
    mutationFn: (row: FormRow) =>
      authed<FormRow>(`/events/${eventId}/forms`, {
        method: "POST",
        body: { name: `${row.name} (copy)`, kind: row.kind, schema: row.schema },
      }),
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: ["forms", eventId] });
      toast(`Copied to “${row.name}”. It starts as a draft, so nothing public changed.`);
    },
    onError: (error: Error) => toast(error.message),
  });

  /** The limit is enforced against the *event* at submit, not the form, so this
   *  is the only place it can be written from. */
  const setEventLimit = useMutation({
    mutationFn: (value: number | null) =>
      authed(`/events/${eventId}`, {
        method: "PATCH",
        body: { submission_limit_per_speaker: value },
      }),
    onSuccess: (_result, value) => {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
      toast(
        value === null
          ? "No limit — a speaker can send as many proposals as they like."
          : `Limit set: ${value} proposal${value === 1 ? "" : "s"} per speaker, drafts included.`,
      );
    },
    onError: (error: Error) => toast(error.message),
  });

  /** Draft-only, and the API is the authority.
   *
   *  There was no way to remove a form at all, so a stray "Create a form" click
   *  left a blank draft on the list permanently — five of them, in the case that
   *  prompted this. Deleting is refused once a form is locked, because a locked
   *  form has submissions behind it and removing it would orphan real answers.
   */
  const remove = useMutation({
    mutationFn: (row: FormRow) =>
      authed(`/events/${eventId}/forms/${row.id}`, { method: "DELETE" }),
    onSuccess: (_result, row) => {
      void queryClient.invalidateQueries({ queryKey: ["forms", eventId] });
      if (openId === row.id) {
        setOpenId(null);
        setEdit(null);
      }
      toast(`Deleted “${row.name}”.`);
    },
    onError: (problem: Error) => toast(problem.message),
  });

  /** Open a form to the public, or close it again.
   *
   *  `FormUpdate` has accepted `status` all along; nothing in the console ever
   *  sent it, so every form was created a draft and stayed one. "5 forms, 0
   *  open" with no control that could change it — the call for papers could be
   *  built and named and never actually opened.
   */
  const setStatus = useMutation({
    mutationFn: (input: { row: FormRow; status: string }) =>
      authed<FormRow>(`/events/${eventId}/forms/${input.row.id}`, {
        method: "PATCH",
        body: { status: input.status },
      }),
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: ["forms", eventId] });
      toast(
        row.status === "open"
          ? `“${row.name}” is live. The public form is collecting submissions.`
          : `“${row.name}” is closed. The public form stops accepting submissions.`,
      );
    },
    onError: (problem: Error) => toast(problem.message),
  });

  const create = useMutation({
    mutationFn: () =>
      authed<FormRow>(`/events/${eventId}/forms`, {
        method: "POST",
        body: {
          name: "Untitled form",
          kind: "cfp",
          schema: {
            sections: [{ key: "proposal", title: "Your proposal", fields: [] }],
            logic: [],
            settings: {},
          },
        },
      }),
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: ["forms", eventId] });
      setOpenId(row.id);
      setEdit(row);
      setStep(0);
      toast("New form created.");
    },
    onError: (problem: Error) => toast(problem.message),
  });

  const all = useMemo(() => forms ?? [], [forms]);
  const shown = all.filter((row) => tab === "All" || STATUS[row.status]?.l === tab);

  const open = (row: FormRow) => {
    setOpenId(row.id);
    setEdit(structuredClone(row));
    setStep(0);
  };

  /** Every step edits the same draft, so one helper covers all six. */
  const patch = (change: (draft: FormRow) => void) => {
    setEdit((current) => {
      if (current === null) return current;
      const next = structuredClone(current);
      change(next);
      return next;
    });
  };
  const patchSettings = (change: (settings: Settings) => void) =>
    patch((draft) => change(draft.schema.settings));

  /* Leaving the builder threw the draft away without a word. Every edit here is
   * local until Save form on the last step, so a Back on step one — the button
   * that *is* the exit — silently discarded a whole form. Compare against the
   * server's copy rather than tracking a flag, so a change and its undo counts
   * as clean. */
  const [leaving, setLeaving] = useState<null | (() => void)>(null);
  const draft = edit;
  const settings = draft?.schema.settings;
  const section = draft?.schema.sections[0];
  const inBuilder = openId !== null && draft !== null;
  const stored = (forms ?? []).find((row) => row.id === openId) ?? null;
  const shape = (row: FormRow | null) =>
    // `kind` belongs here: leaving it out meant switching Call for papers to
    // Speaker task did not count as a change, so the builder let you walk away
    // from that edit without the unsaved-changes prompt — and it was dropped
    // from the save body anyway, which is how the choice looked decorative.
    row === null ? "" : JSON.stringify([row.name, row.kind, row.schema, row.closes_at]);
  const unsaved = inBuilder && stored !== null && shape(draft) !== shape(stored);
  /** Every way out of the builder goes through here. */
  const leave = (go: () => void) => (unsaved ? setLeaving(() => go) : go());

  const tile = (name: "All" | "Open" | "Draft", count: number) => ({
    c: count,
    on: () => setTab(name),
    bd: tab === name ? "var(--sg,#E04E4E)" : "var(--ln,#E1E7E9)",
    ring: tab === name ? "0 0 0 3px var(--sw,#FFEAE6)" : "0 1px 2px rgba(13,16,32,.04)",
    numFg: tab === name ? "var(--sg,#E04E4E)" : "var(--ik,#16232B)",
  });

  const partCheck = check(settings?.collect_participants ?? true);
  const partTint = rowTint(settings?.collect_participants ?? true);
  const termsCheck = check(settings?.require_terms ?? false);
  const confirmCheck = check(settings?.confirm_participants ?? true);
  const adminCheck = check(settings?.notify_admins_on_submit ?? true);

  const screen: FormsData = {
    tabs: <SectionTabs />,
    ...stripData(stats),

    inList: !inBuilder,
    inBuilder,
    crumb: inBuilder ? `/ Forms / ${draft.name}` : "/ Forms",
    // The title *is* the name field. There was nowhere else to rename a form —
    // it was created as "Untitled form" and stayed that way, because the only
    // thing showing the name was an `<h1>`, and an organiser cannot type into a
    // heading. Rendering the input in the heading's own place means the name
    // lives where you already look for it, rather than in a settings step
    // somebody has to find.
    // A section with no questions rendered as a section title, a page heading
    // and then nothing — a screen that looks finished and is not. The only way
    // to add a question was a button in the far top-right corner, nowhere near
    // the emptiness it fills, so it was possible to walk all six steps and save
    // a form that can never be opened. This says what is missing and puts the
    // action where the questions will be.
    /* The engine has run conditional logic since the first migration and
     * nothing in the product could write a rule; `logic: []` was hardcoded at
     * form creation. The editor also carries the builder-time warning
     * docs/APP_CONTEXT.md asks for: a required field a rule can hide silently
     * blocks submission, and the only moment to say so is while the rule is
     * being made. */
    logicPanel: (
      <LogicEditor
        fields={(section?.fields ?? []) as EditableField[]}
        rules={draft?.schema.logic ?? []}
        onChange={(next) => patch((entry) => void (entry.schema.logic = next))}
      />
    ),
    fieldsEmpty:
      (section?.fields.length ?? 0) > 0 ? null : (
        <div
          style={{
            border: "1px dashed var(--ls,#C8D2D5)",
            borderRadius: 12,
            padding: "26px 24px",
            textAlign: "center",
            background: "var(--sk,#EDF1F2)",
          }}
        >
          <p
            style={{
              font: "600 14px var(--font-plex-sans)",
              color: "var(--ik)",
              margin: "0 0 4px",
            }}
          >
            No questions yet
          </p>
          <p
            style={{
              font: "400 12.5px/1.55 var(--font-plex-sans)",
              color: "var(--i3)",
              margin: "0 auto 16px",
              maxWidth: "46ch",
            }}
          >
            A call for papers needs at least one question — a session title at minimum, since that
            is what the proposal is listed under. A form with no questions cannot be opened.
          </p>
          <button
            onClick={() => setEditing(blankField())}
            style={{
              height: 40,
              padding: "0 20px",
              borderRadius: 999,
              border: "none",
              background: "var(--sg)",
              color: "var(--cd)",
              font: "600 13px var(--font-plex-sans)",
              cursor: "pointer",
            }}
          >
            Add the first question
          </button>
        </div>
      ),
    // Plain text — this one also labels the step sidebar, where a 30px input
    // would be absurd.
    bName: draft?.name ?? "",
    bNameField:
      draft === null ? (
        ""
      ) : (
        <input
          value={draft.name}
          aria-label="Form name"
          placeholder="Name this form"
          onChange={(event) => {
            const next = event.target.value;
            patch((row) => void (row.name = next));
          }}
          style={{
            font: "600 30px/1.15 'IBM Plex Sans', sans-serif",
            letterSpacing: "-0.02em",
            color: "var(--ik,#16232B)",
            background: "none",
            border: "none",
            borderBottom: "1.5px dashed var(--ls,#C8D2D5)",
            padding: "0 2px 2px",
            margin: 0,
            width: `${Math.max(12, Math.min(38, draft.name.length + 2))}ch`,
            minWidth: 0,
          }}
        />
      ),
    backToList: () =>
      leave(() => {
        setOpenId(null);
        setEdit(null);
      }),
    // "Create a form" used to POST a new row on every click, so two clicks —
    // or one click, a look around, and a click back — left two identical
    // "Untitled form · 0 fields" drafts with no way to tell them apart. A blank
    // untouched draft is not a thing anyone wanted two of; if one is already
    // sitting there, that is the one you meant.
    newForm: () => {
      const blank = all.find(
        (row) =>
          row.status === "draft" &&
          !row.is_locked &&
          row.closes_at === null &&
          row.schema.sections.every((entry) => entry.fields.length === 0),
      );
      if (blank !== undefined) {
        open(blank);
        toast("Opened the blank draft you already had, rather than making a second one.");
        return;
      }
      create.mutate();
    },

    sumLine:
      all.length === 0
        ? "No forms yet. Create one and it becomes your call for papers."
        : `${all.length} form${all.length === 1 ? "" : "s"}, ${all.filter((row) => row.status === "open").length} open.`,
    tAllF: tile("All", all.length),
    tOpenF: tile("Open", all.filter((row) => row.status === "open").length),
    tDraftF: tile("Draft", all.filter((row) => row.status === "draft").length),
    tResp: {
      c: stats.total,
      on: () => setTab("All"),
      bd: "var(--ln,#E1E7E9)",
      ring: "0 1px 2px rgba(13,16,32,.04)",
      numFg: "var(--ik,#16232B)",
    },

    formRows: shown.map((row) => {
      const look = STATUS[row.status] ?? STATUS.draft!;
      const fieldCount = row.schema.sections.reduce(
        (total, entry) => total + entry.fields.length,
        0,
      );
      return {
        n: row.name,
        kind: row.kind === "cfp" ? "Call for papers" : "Speaker task",
        meta: `${fieldCount} field${fieldCount === 1 ? "" : "s"}${row.is_locked ? " · locked, has submissions" : ""}`,
        closes:
          row.closes_at === null
            ? "no close date"
            : `closes ${DAY.format(new Date(row.closes_at))}`,
        st: look.l,
        stFg: look.fg,
        stBg: look.bg,
        onOpen: () => open(row),
        /* Labelled "Duplicate" and it copied a link — built from the event's
         * *name*, so the link was "/e/DevFlow Conf 2027/cfp" and 404ed anyway.
         * It duplicates now, which is what it says. */
        onCopy: () => duplicate.mutate(row),
        // A form with no questions can be opened, submitted against, and then
        // rejected by the API — `title` is required and nothing supplies it, so
        // the submitter gets a validation error for a field they were never
        // shown. Refuse at the point of opening, where the organiser can act on
        // it, rather than at the point of submitting, where the speaker cannot.
        ...(() => {
          const empty = row.schema.sections.every((entry) => entry.fields.length === 0);
          const isOpen = row.status === "open";
          return {
            onStatus: () => {
              if (!isOpen && empty) {
                toast("Add at least one question before opening this form.");
                return;
              }
              if (isOpen && armedClose !== row.id) {
                setArmedClose(row.id);
                return;
              }
              setArmedClose(null);
              setStatus.mutate({ row, status: isOpen ? "closed" : "open" });
            },
            statusLabel: isOpen ? (armedClose === row.id ? "Sure? Click again" : "Close") : "Open",
            statusOff: !isOpen && empty,
            statusTitle: isOpen
              ? armedClose === row.id
                ? `Click again and “${row.name}” stops accepting submissions immediately`
                : `Stop “${row.name}” accepting submissions`
              : empty
                ? "This form has no questions yet, so there is nothing to submit."
                : `Make “${row.name}” live and start collecting`,
          };
        })(),
        // Locked means submissions exist behind it; the API refuses, and the
        // button says why rather than letting someone find out from a toast.
        onDelete: () => {
          if (row.is_locked) return;
          remove.mutate(row);
        },
        deleteOff: row.is_locked,
        deleteTitle: row.is_locked
          ? "This form has submissions, so it cannot be deleted."
          : `Delete “${row.name}”`,
      };
    }),

    steps: STEPS.map((entry, index) => ({
      n: entry.n,
      sub: entry.sub,
      on: () => setStep(index),
      mark: index < step ? "✓" : String(index + 1),
      bg: index === step ? "var(--sw,#EDEDFA)" : "none",
      fg: index === step ? "var(--sg,#5254B0)" : "var(--i2,#3F3F46)",
      wt: index === step ? "600" : "400",
      dotBg: index <= step ? "var(--sg,#5254B0)" : "var(--cd,#FFFFFF)",
      dotBd: index <= step ? "var(--sg,#5254B0)" : "var(--ls,#C9C9CF)",
      dotFg: index <= step ? "var(--bf,#FFFFFF)" : "var(--i4,#99A6AD)",
    })),
    s1: step === 0,
    s2: step === 1,
    s3: step === 2,
    s4: step === 3,
    s5: step === 4,
    s6: step === 5,
    nextStep: () => {
      if (step === STEPS.length - 1) {
        // Finishing the last step is finishing the form, so it returns to the
        // list. Saying "Saved." and leaving you on step six looks like the
        // button did not work — there is nothing further to do here, and the
        // only evidence the save landed is on the page you cannot see.
        //
        // Scoped to this call rather than the mutation, because "View live
        // form" saves too and must stay put.
        // Stated on the field and enforced here. A message you can save past is
        // decoration.
        if (closeBounds.problem !== null) {
          toast(closeBounds.problem);
          setStep(4);
          return;
        }
        if (draft !== null) {
          save.mutate(draft, {
            onSuccess: () => {
              setOpenId(null);
              setEdit(null);
            },
          });
        }
        return;
      }
      setStep((current) => current + 1);
    },
    // On the first step there is no previous step, and clamping to 0 made the
    // button look broken — it was the only control on screen that could be
    // clicked and do nothing at all. Back from step one is back out of the
    // builder, which is the only place left to go.
    prevStep: () => {
      if (step === 0) {
        leave(() => {
          setOpenId(null);
          setEdit(null);
        });
        return;
      }
      setStep((current) => current - 1);
    },
    prevLabel: step === 0 ? "Back to forms" : "Back",
    nextLabel: step === STEPS.length - 1 ? "Save form" : "Next",
    /* Was: save the draft, toast "Saved.", show nothing. The button is called
     * "View live form", so it saves *and then opens the form* — in a new tab,
     * because losing an unsaved builder to a navigation is worse than a tab. */
    preview: () => {
      const slug = eventRow?.slug;
      if (draft !== null) save.mutate(draft);
      if (slug === undefined) {
        toast("This event has no public address yet — set one in Settings.");
        return;
      }
      window.open(`/e/${slug}/cfp`, "_blank", "noopener");
    },
    savedStamp: save.isPending ? "Saving…" : "Unsaved changes are kept until you save",

    kinds: KINDS.map((entry) => ({
      n: entry.n,
      d: entry.d,
      on: () => patch((row) => void (row.kind = entry.key)),
      bd: draft?.kind === entry.key ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)",
      bg: draft?.kind === entry.key ? "var(--sw,#FFEAE6)" : "var(--cd,#FFFFFF)",
    })),
    partCk: partCheck.ck,
    partCkBg: partCheck.ckBg,
    partCkBd: partCheck.ckBd,
    // Same source as `partCheck`, so the row's tint can never disagree with the
    // tick inside it.
    partBd: partTint.bd,
    partBg: partTint.bg,
    togPart: () =>
      patchSettings((entry) => void (entry.collect_participants = !entry.collect_participants)),

    welcome: settings?.welcome_message ?? "",
    onWelcome: (event) =>
      patchSettings(
        (entry) => void (entry.welcome_message = (event.target as HTMLTextAreaElement).value),
      ),
    termsCk: termsCheck.ck,
    termsBd: termsCheck.ckBd,
    termsBg: termsCheck.ckBg,
    togTerms: () => patchSettings((entry) => void (entry.require_terms = !entry.require_terms)),

    secTitle: section?.title ?? "",
    onSecTitle: (event) =>
      patch((row) => {
        const first = row.schema.sections[0];
        if (first !== undefined) first.title = (event.target as HTMLInputElement).value;
      }),
    pageHead: settings?.page_heading ?? "",
    onPageHead: (event) =>
      patchSettings(
        (entry) =>
          void (entry.page_heading = (event.target as HTMLInputElement).value.slice(0, 15)),
      ),
    fields: (section?.fields ?? []).map((field, index) => ({
      n: field.label,
      req: field.required ? "required" : "optional",
      meta: `${field.type.replace(/_/g, " ")}${field.choices.length > 0 ? ` · ${field.choices.length} choices` : ""}`,
      // A locked form keeps its fields: deletion becomes "hide from new
      // submissions" so answers already given keep their meaning.
      locked: draft?.is_locked ?? false,
      idb: field.identity_bearing,
      canX: !(draft?.is_locked ?? false),
      onX: (event) => {
        // The row itself opens the editor, so removal must not also do that.
        event.stopPropagation();
        patch((row) => {
          const first = row.schema.sections[0];
          if (first !== undefined) {
            first.fields = first.fields.filter((entry) => entry.key !== field.key);
          }
        });
      },
      onEdit: () => setEditing({ ...field, max_length: field.max_length ?? null }),
      onDragStart: () => {
        dragging.current = index;
      },
      onDragOver: (event) => event.preventDefault(),
      onDrop: (event) => {
        event.preventDefault();
        const from = dragging.current;
        dragging.current = null;
        if (from === null || from === index) return;
        patch((row) => {
          const first = row.schema.sections[0];
          if (first === undefined) return;
          const moved = first.fields.splice(from, 1)[0];
          if (moved !== undefined) first.fields.splice(index, 0, moved);
        });
      },
    })),
    addField: () => setEditing(blankField()),

    roles: (settings?.participant_roles ?? []).map((role) => {
      const mark = check(role.enabled);
      return {
        n: role.label,
        ck: mark.ck,
        ckBg: mark.ckBg,
        ckBd: mark.ckBd,
        bd: rowTint(role.enabled).bd,
        bg: rowTint(role.enabled).bg,
        onSel: role.enabled,
        min: String(role.minimum),
        max: String(role.maximum),
        onTog: () =>
          patchSettings((entry) => {
            const found = entry.participant_roles.find((item) => item.key === role.key);
            if (found !== undefined) found.enabled = !found.enabled;
          }),
        // Refused at the point of entry, not at save. The incumbent accepted
        // this combination and then rejected every submission with no
        // explanation — it is the bug the customer hit on camera.
        onMin: (event) =>
          patchSettings((entry) => {
            const found = entry.participant_roles.find((item) => item.key === role.key);
            if (found === undefined) return;
            const wanted = Math.max(0, Number((event.target as HTMLInputElement).value) || 0);
            if (wanted > found.maximum) {
              toast(
                `${found.label}: a minimum of ${wanted} cannot go with a maximum of ${found.maximum}.`,
              );
              return;
            }
            found.minimum = wanted;
          }),
        onMax: (event) =>
          patchSettings((entry) => {
            const found = entry.participant_roles.find((item) => item.key === role.key);
            if (found === undefined) return;
            const wanted = Math.max(1, Number((event.target as HTMLInputElement).value) || 1);
            if (wanted < found.minimum) {
              toast(
                `${found.label}: a maximum of ${wanted} cannot go with a minimum of ${found.minimum}.`,
              );
              return;
            }
            found.maximum = wanted;
          }),
      };
    }),
    cfCk: confirmCheck.ck,
    cfBd: confirmCheck.ckBd,
    cfBg: confirmCheck.ckBg,
    togConfirm: () =>
      patchSettings((entry) => void (entry.confirm_participants = !entry.confirm_participants)),

    closeAt: draft?.closes_at?.slice(0, 16) ?? "",
    // A deadline in the past closes the call the instant it opens, and one after
    // the conference has finished is a call for talks at an event that already
    // happened. The picker accepted 1987. Bounds are on the input so the browser
    // refuses out-of-range values, and stated below it so someone typing rather
    // than picking is told why — the picker is not the only way text gets here.
    closeMin: closeBounds.min,
    closeMax: closeBounds.max,
    closeError:
      closeBounds.problem === null ? null : (
        <span
          role="alert"
          style={{
            display: "block",
            marginTop: 6,
            font: "500 12px var(--font-plex-sans)",
            color: "var(--cn)",
          }}
        >
          {closeBounds.problem}
        </span>
      ),
    // Was the literal "PT · event timezone", wrong for any event outside
    // Pacific — and the picker reads the browser's clock, not the event's, so
    // the label has to say which one the operator is looking at.
    closeZone:
      eventRow === undefined ? "" : `${eventRow.timezone.replace(/_/g, " ")} · event timezone`,
    /* `new Date(value).toISOString()` raises RangeError on anything that is not
     * a date, and the input had no `type`, so a half-typed value threw on every
     * keystroke. It is a datetime-local now, and the parse is still guarded —
     * the picker is not the only way text reaches this. */
    onCloseAt: (event) =>
      patch((row) => {
        const value = (event.target as HTMLInputElement).value;
        if (value === "") {
          row.closes_at = null;
          return;
        }
        const when = new Date(value);
        if (Number.isNaN(when.getTime())) return;
        row.closes_at = when.toISOString();
      }),
    /* Was `useState("1")` and nothing else: it accepted a number, reported
     * nothing and reset on reopen. The limit lives on the event — it is what
     * `_check_limit` enforces at submit — so it is written there. Blank means
     * no limit, which is what the seeded event actually has. */
    limit: eventRow?.submission_limit_per_speaker?.toString() ?? "",
    onLimit: (event) => {
      const raw = (event.target as HTMLInputElement).value.trim();
      if (raw !== "" && !/^[1-9][0-9]{0,2}$/.test(raw)) return;
      setEventLimit.mutate(raw === "" ? null : Number(raw));
    },
    draftOpts: [
      { on: true, n: "Let speakers save and come back" },
      { on: false, n: "Submissions must be completed in one sitting" },
    ].map((entry) => ({
      n: entry.n,
      on: () => patchSettings((row) => void (row.allow_drafts = entry.on)),
      rb: (settings?.allow_drafts ?? true) === entry.on ? "var(--sg,#E04E4E)" : "transparent",
      rd: (settings?.allow_drafts ?? true) === entry.on ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)",
    })),

    adCk: adminCheck.ck,
    adBd: adminCheck.ckBd,
    adBg: adminCheck.ckBg,
    togAdmin: () =>
      patchSettings(
        (entry) => void (entry.notify_admins_on_submit = !entry.notify_admins_on_submit),
      ),

    toasts: toasts.map((entry) => ({
      msg: entry.msg,
      onX: () => dismiss(entry.id),
    })),
  };

  return (
    <>
      <Forms d={screen} />
      {editing !== null ? (
        <FieldEditor
          field={editing}
          existingKeys={(section?.fields ?? []).map((entry) => entry.key)}
          onCancel={() => setEditing(null)}
          onSave={(saved) => {
            patch((row) => {
              const first = row.schema.sections[0];
              if (first === undefined) return;
              const at = first.fields.findIndex((entry) => entry.key === saved.key);
              if (at === -1) first.fields.push(saved);
              else first.fields[at] = saved;
            });
            setEditing(null);
          }}
        />
      ) : null}

      {leaving !== null && draft !== null ? (
        <div
          onClick={() => setLeaving(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(13,16,32,.4)",
            display: "grid",
            placeItems: "center",
            padding: 20,
            zIndex: 150,
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Unsaved changes"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 440,
              maxWidth: "100%",
              background: "var(--cd)",
              border: "1px solid var(--ln)",
              borderRadius: 14,
              padding: 22,
              display: "grid",
              gap: 14,
              boxShadow: "0 24px 60px rgba(13,16,32,.28)",
            }}
          >
            <p style={{ font: "600 15px var(--font-plex-sans)", color: "var(--ik)", margin: 0 }}>
              Leave “{draft.name}” without saving?
            </p>
            <p
              style={{
                font: "400 13px/1.6 var(--font-plex-sans)",
                color: "var(--i3)",
                margin: 0,
              }}
            >
              Everything you have changed in the builder is still only on this screen. Leaving now
              throws it away.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button style={quietPill} onClick={() => setLeaving(null)}>
                Keep editing
              </button>
              <button
                style={{ ...quietPill, borderColor: "var(--cnl)", color: "var(--cn)" }}
                onClick={() => {
                  const go = leaving;
                  setLeaving(null);
                  go();
                }}
              >
                Discard changes
              </button>
              <button
                style={pill}
                disabled={save.isPending}
                onClick={() => {
                  const go = leaving;
                  save.mutate(draft, {
                    onSuccess: () => {
                      setLeaving(null);
                      go();
                    },
                  });
                }}
              >
                {save.isPending ? "Saving…" : "Save and leave"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
