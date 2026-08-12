"use client";

/** The form list, and the six-step builder behind it.
 *
 *  Everything the wizard edits is one `schema` blob plus a few columns on the
 *  form row, so each step writes the same PATCH. Saving is explicit rather than
 *  keystroke-by-keystroke: the server refuses structural changes once a form has
 *  submissions, and finding that out on every character typed would be miserable.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import { useConsoleChrome } from "@/components/console/chrome";
import { stripData, useProgramStats } from "@/components/console/stats";
import { Forms, type FormsData } from "@/components/design/Forms";
import { blankField, FieldEditor, type Field as EditableField } from "@/components/forms/FieldEditor";
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

export default function FormsPage() {
  const { toasts, toast, dismiss } = useConsoleChrome();
  const { stats, eventId } = useProgramStats();
  const queryClient = useQueryClient();

  const [openId, setOpenId] = useState<string | null>(null);
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
        body: { name: row.name, schema: row.schema, closes_at: row.closes_at },
      }),
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: ["forms", eventId] });
      setEdit(row);
      toast("Saved.");
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
      authed<{ slug: string; timezone: string; submission_limit_per_speaker: number | null }>(
        `/events/${eventId}`,
      ),
  });

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

  const draft = edit;
  const settings = draft?.schema.settings;
  const section = draft?.schema.sections[0];
  const inBuilder = openId !== null && draft !== null;

  const tile = (name: "All" | "Open" | "Draft", count: number) => ({
    c: count,
    on: () => setTab(name),
    bd: tab === name ? "var(--sg,#E04E4E)" : "var(--ln,#E1E7E9)",
    ring: tab === name ? "0 0 0 3px var(--sw,#FFEAE6)" : "0 1px 2px rgba(13,16,32,.04)",
    numFg: tab === name ? "var(--sg,#E04E4E)" : "var(--ik,#16232B)",
  });

  const partCheck = check(settings?.collect_participants ?? true);
  const termsCheck = check(settings?.require_terms ?? false);
  const confirmCheck = check(settings?.confirm_participants ?? true);
  const adminCheck = check(settings?.notify_admins_on_submit ?? true);

  const screen: FormsData = {
    ...stripData(stats),

    inList: !inBuilder,
    inBuilder,
    crumb: inBuilder ? `/ Forms / ${draft.name}` : "/ Forms",
    bName: draft?.name ?? "",
    backToList: () => {
      setOpenId(null);
      setEdit(null);
    },
    newForm: () => create.mutate(),

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
          row.closes_at === null ? "no close date" : `closes ${DAY.format(new Date(row.closes_at))}`,
        st: look.l,
        stFg: look.fg,
        stBg: look.bg,
        onOpen: () => open(row),
        /* Labelled "Duplicate" and it copied a link — built from the event's
         * *name*, so the link was "/e/DevFlow Conf 2027/cfp" and 404ed anyway.
         * It duplicates now, which is what it says. */
        onCopy: () => duplicate.mutate(row),
      };
    }),

    steps: STEPS.map((entry, index) => ({
      n: entry.n,
      sub: entry.sub,
      on: () => setStep(index),
      mark: index < step ? "✓" : String(index + 1),
      bg: index === step ? "var(--sw,#FFEAE6)" : "none",
      fg: index === step ? "var(--sg,#E04E4E)" : "var(--i2,#3E4E58)",
      wt: index === step ? "600" : "400",
      dotBg: index <= step ? "var(--sg,#E04E4E)" : "var(--cd,#FFFFFF)",
      dotBd: index <= step ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)",
      dotFg: index <= step ? "#FFFFFF" : "var(--i4,#99A6AD)",
    })),
    s1: step === 0,
    s2: step === 1,
    s3: step === 2,
    s4: step === 3,
    s5: step === 4,
    s6: step === 5,
    nextStep: () => {
      if (step === STEPS.length - 1) {
        if (draft !== null) save.mutate(draft);
        return;
      }
      setStep((current) => current + 1);
    },
    prevStep: () => setStep((current) => Math.max(0, current - 1)),
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
    partBd: partCheck.ckBd,
    partBg: partCheck.ckBg,
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
        (entry) => void (entry.page_heading = (event.target as HTMLInputElement).value.slice(0, 15)),
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
        bd: mark.ckBd,
        bg: mark.ckBg,
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
    // Was the literal "PT · event timezone", wrong for any event outside
    // Pacific — and the picker reads the browser's clock, not the event's, so
    // the label has to say which one the operator is looking at.
    closeZone: eventRow === undefined ? "" : `${eventRow.timezone.replace(/_/g, " ")} · event timezone`,
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
      rd:
        (settings?.allow_drafts ?? true) === entry.on
          ? "var(--sg,#E04E4E)"
          : "var(--ls,#C8D2D5)",
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
    </>
  );
}
