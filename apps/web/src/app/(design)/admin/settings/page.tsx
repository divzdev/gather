"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { AiKeyPanel } from "@/components/console/AiKeyPanel";
import { OrganizationPanel } from "@/components/console/OrganizationPanel";
import { OrgPeoplePanel } from "@/components/console/OrgPeoplePanel";
import { useMe } from "@/components/console/useMe";
import { TeamPanel } from "@/components/console/TeamPanel";
import { useConsoleChrome } from "@/components/console/chrome";
import { Settings, type SettingsData } from "@/components/design/Settings";
import { SETTINGS_ICON } from "@/components/ui";
import { authed, getEventId } from "@/lib/session";

type Event = {
  org_id: string;
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  starts_on: string;
  ends_on: string;
  location: string | null;
  description: string | null;
  cfp_opens_at: string | null;
  cfp_closes_at: string | null;
};

/** The two tiers are two groups in the sidebar, and they stay two: an event
 *  panel never edits the organisation, and an organisation panel never edits an
 *  event (spec 0004). */
type Panel = "event" | "team" | "brand" | "email" | "integrations" | "org" | "people";

const PANELS: { key: Panel; label: string }[] = [
  { key: "event", label: "Event" },
  { key: "team", label: "Team" },
  { key: "brand", label: "Brand" },
  { key: "email", label: "Email" },
  { key: "integrations", label: "Integrations" },
];

const ORG_PANELS: { key: Panel; label: string }[] = [
  { key: "org", label: "Organisation" },
  { key: "people", label: "People" },
];

type Draft = {
  name: string;
  slug: string;
  type: string;
  tz: string;
  starts: string;
  ends: string;
  cfpCloses: string;
  loc: string;
  hook: string;
};

const COMMIT_DELAY_MS = 700;

const EMPTY: Draft = {
  name: "",
  slug: "",
  type: "",
  tz: "",
  starts: "",
  ends: "",
  cfpCloses: "",
  loc: "",
  hook: "",
};

/** A datetime as `YYYY-MM-DD`, which is what the design's date inputs show and
 *  what a person types. Times of day are not part of this screen. */
function toDateInput(iso: string | null): string {
  return iso === null ? "" : iso.slice(0, 10);
}

/** Back to an instant. A CFP closes at the end of the day it names, otherwise
 *  setting today's date would shut the form retroactively this morning. */
function endOfDay(value: string): string | null {
  if (value.trim() === "") return null;
  const parsed = new Date(`${value}T23:59:59Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** The same fifteen offered at /admin/events/new. The select used to carry four
 *  literal options with **no `value` attribute**, so each option's value was its
 *  own label ("America/Los_Angeles · PT") and the bound IANA string could never
 *  match one — React fell back to the first, and every event on every screen
 *  claimed to be in Los Angeles. Eleven zones could not be displayed or edited. */
const ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

/** The field was labelled "Event type" and offered "Conference · in person",
 *  "Meetup series" and two others — none of which exist. It is bound to
 *  `status`, the event lifecycle, so choosing one PATCHed a sentence into an
 *  enum column. These are the six real states. */
const STAGES = [
  { v: "draft", l: "Draft — nothing public yet" },
  { v: "cfp_open", l: "Call for papers open" },
  { v: "in_review", l: "In review" },
  { v: "scheduled", l: "Scheduled" },
  { v: "live", l: "Live" },
  { v: "archived", l: "Archived" },
];

/** `\d{4}-\d{2}-\d{2}` accepts 2027-13-45. This asks the calendar. */
function realDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const OK_TONE = {
  fg: "var(--ok,#0E7A5F)",
  bg: "var(--okw,#E2F1EC)",
  bd: "var(--okl,#C2E0D5)",
} as const;
const OFF_TONE = {
  fg: "var(--i3,#6B7B84)",
  bg: "var(--sk,#EDF1F2)",
  bd: "var(--ln,#E1E7E9)",
} as const;
/** Built, but it waits for a person. Distinct from both "on" and "absent". */
const ASK_TONE = {
  fg: "var(--if,#47599F)",
  bg: "var(--ifw,#E9ECF7)",
  bd: "var(--ifl,#C6CDEA)",
} as const;

export default function SettingsPage() {
  const { toasts, toast, dismiss } = useConsoleChrome();
  const queryClient = useQueryClient();
  const eventId = typeof window === "undefined" ? null : getEventId();

  const [panel, setPanel] = useState<Panel>("event");
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const { data: event } = useQuery({
    queryKey: ["event", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Event>(`/events/${eventId}`),
  });

  // The org key card and the whole ORGANISATION group are org-scoped and
  // owner/admin-only: the API 403s everyone else, so anyone else simply doesn't
  // get them drawn.
  const { isManager: canManageKey } = useMe();
  const orgId = event?.org_id ?? null;
  //: The organisation this screen may edit, or null. One name that narrows,
  //: rather than repeating `orgId === null || !canManageKey` at each use.
  const manageableOrgId = canManageKey ? orgId : null;

  // Seeded once per event, not on every refetch: a save refetches, and
  // re-seeding from the response would wipe whatever is half-typed in another
  // field. Adjusted during render rather than in an effect so the first paint
  // already has the real values.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (event !== undefined && event.id !== loadedId) {
    setLoadedId(event.id);
    setDraft({
      name: event.name,
      slug: event.slug,
      type: event.status,
      tz: event.timezone,
      starts: event.starts_on,
      ends: event.ends_on,
      cfpCloses: toDateInput(event.cfp_closes_at),
      loc: event.location ?? "",
      hook: "",
    });
  }

  const save = useMutation({
    mutationFn: (changes: Record<string, unknown>) =>
      authed<Event>(`/events/${eventId}`, { method: "PATCH", body: changes }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["event", eventId], updated);
      void queryClient.invalidateQueries({ queryKey: ["program-stats", eventId] });
      toast("Saved.");
    },
    onError: (error: Error) => toast(error.message),
  });

  /** The design has no save button, so fields commit themselves — but only once
   *  the typing stops. Saving per keystroke would PATCH on every character and
   *  persist half-written dates.
   *
   *  Two things that debounce has to get right, and did not:
   *
   *  It has to *accumulate*. One timer served every field and each new edit
   *  replaced the last one's payload, so setting a name and then a slug inside
   *  the delay saved the slug and silently dropped the name.
   *
   *  It has to *flush*. Nothing cancelled or fired the timer on the way out, so
   *  typing a date and leaving within 700ms discarded the edit — no request, no
   *  error, and the field showing the value you had just typed until something
   *  refetched. The CFP deadline is set on this screen, so the write being lost
   *  is the call staying open. */
  const pending = useRef<number | null>(null);
  const queued = useRef<Record<string, unknown>>({});
  const flush = useCallback(() => {
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = null;
    const changes = queued.current;
    queued.current = {};
    if (Object.keys(changes).length > 0) save.mutate(changes);
  }, [save]);

  const commit = useCallback(
    (changes: Record<string, unknown>) => {
      queued.current = { ...queued.current, ...changes };
      if (pending.current !== null) window.clearTimeout(pending.current);
      pending.current = window.setTimeout(flush, COMMIT_DELAY_MS);
    },
    [flush],
  );

  /** Leaving the screen is a commit, not a cancel. `flush` is stable across
   *  renders only through `save`, so this is keyed to it rather than run once —
   *  a stale closure here would send the edit to the previous event. */
  useEffect(() => flush, [flush]);

  const field =
    <K extends keyof Draft>(key: K, onCommit: (value: string) => Record<string, unknown> | null) =>
    (event_: React.SyntheticEvent) => {
      const value = (event_.target as HTMLInputElement | HTMLSelectElement).value;
      setDraft((current) => ({ ...current, [key]: value }));
      const changes = onCommit(value);
      if (changes !== null) commit(changes);
    };

  /** A date only counts once it is whole *and* real; `2026-0` is not a date and
   *  neither is `2027-13-45`, which the old shape-only check waved through to
   *  the API. */
  const whenComplete = (value: string, build: (value: string) => Record<string, unknown>) =>
    realDate(value) ? build(value) : null;

  const publicUrl = event === undefined ? "" : `${window.location.origin}/e/${event.slug}`;

  const screen: SettingsData = {
    panels: PANELS.map((entry) => {
      const active = panel === entry.key;
      return {
        n: entry.label,
        on: () => setPanel(entry.key),
        bg: active ? "var(--sk,#EFEFF2)" : "none",
        fg: active ? "var(--ik,#141417)" : "var(--i2,#3F3F46)",
        wt: active ? "600" : "500",
        dot: active ? "inline-block" : "none",
      };
    }),
    // The same navigation the sidebar draws, as one control — a phone gets the
    // dropdown, a desktop the list, and both read `panel`, so they cannot
    // disagree about which section is open.
    navValue: panel,
    onNav: (changed: React.SyntheticEvent) =>
      setPanel((changed.target as HTMLSelectElement).value as Panel),
    navGroups: [
      { label: "Event settings", options: PANELS.map((e) => ({ v: e.key, l: e.label })) },
      ...(manageableOrgId === null
        ? []
        : [{ label: "Organisation", options: ORG_PANELS.map((e) => ({ v: e.key, l: e.label })) }]),
    ],
    orgPanels:
      manageableOrgId === null
        ? []
        : ORG_PANELS.map((entry) => {
            const active = panel === entry.key;
            return {
              n: entry.label,
              on: () => setPanel(entry.key),
              bg: active ? "var(--sk,#EFEFF2)" : "none",
              fg: active ? "var(--ik,#141417)" : "var(--i2,#3F3F46)",
              wt: active ? "600" : "500",
            };
          }),
    orgPanel:
      panel !== "org" || manageableOrgId === null ? null : (
        <OrganizationPanel orgId={manageableOrgId} toast={toast} />
      ),
    peoplePanel:
      panel !== "people" || manageableOrgId === null ? null : (
        <OrgPeoplePanel orgId={manageableOrgId} toast={toast} />
      ),

    pEvent: panel === "event",
    pTeam: panel === "team",
    teamPanel:
      panel !== "team" || eventId === null ? null : (
        <TeamPanel
          eventId={eventId}
          toast={toast}
          onManageOrg={manageableOrgId === null ? undefined : () => setPanel("people")}
        />
      ),
    aiPanel:
      panel !== "integrations" || orgId === null || !canManageKey ? null : (
        <AiKeyPanel orgId={orgId} toast={toast} />
      ),
    pBrand: panel === "brand",
    pEmail: panel === "email",
    pInteg: panel === "integrations",

    f: draft,
    // These three went through setDraft alone and never committed: you could
    // rename the event, watch the field accept it, and lose it on reload.
    // A blank name or slug is refused by the API, so it is not sent at all —
    // the field keeps what you typed and the event keeps its old value.
    onName: field("name", (value) => (value.trim() === "" ? null : { name: value.trim() })),
    onSlug: field("slug", (value) => (value.trim() === "" ? null : { slug: value.trim() })),
    // Clearing a location is a legitimate edit, so an empty string does commit.
    onLoc: field("loc", (value) => ({ location: value })),
    onType: field("type", (value) => ({ status: value })),
    onTz: field("tz", (value) => ({ timezone: value })),
    typeOpts: STAGES.map((stage) => ({ v: stage.v, l: stage.l })),
    /* The fields commit on change and there is no save button, so refusing a
     * value silently is indistinguishable from accepting it — the screen kept
     * "2026-13-45" on display while the event kept its real date. Say so. */
    dateProblem: (() => {
      for (const [key, label] of [
        ["starts", "The start date"],
        ["ends", "The end date"],
        ["cfpCloses", "The CFP close date"],
      ] as const) {
        const value = draft[key];
        if (value.trim() !== "" && !realDate(value))
          return `${label} is not a real date, so it has not been saved.`;
      }
      if (realDate(draft.starts) && realDate(draft.ends) && draft.ends < draft.starts)
        return "The event cannot end before it starts, so the end date has not been saved.";
      return "";
    })(),
    tzOpts: ZONES.map((zone) => ({ v: zone, l: zone.replace(/_/g, " ") })),
    // An event cannot end before it starts. /admin/events/new has enforced this
    // since it was written; this screen let you undo it afterwards.
    onStarts: field("starts", (value) =>
      whenComplete(value, (date) =>
        draft.ends !== "" && realDate(draft.ends) && date > draft.ends
          ? { starts_on: date, ends_on: date }
          : { starts_on: date },
      ),
    ),
    onEnds: field("ends", (value) =>
      !realDate(value) || (realDate(draft.starts) && value < draft.starts)
        ? null
        : { ends_on: value },
    ),
    onCfpCloses: field("cfpCloses", (value) =>
      value.trim() === ""
        ? { cfp_closes_at: null }
        : whenComplete(value, (date) => ({ cfp_closes_at: endOfDay(date) })),
    ),

    // The design has no save button; text fields commit when they lose focus.
    stamp: save.isPending ? "Saving…" : event === undefined ? "Loading" : `Editing ${event.name}`,

    copyUrl: () => {
      void navigator.clipboard.writeText(publicUrl);
      toast(`Copied ${publicUrl}`);
    },
    // Uploading works; serving a file to an anonymous visitor does not, and a
    // logo that only signed-in staff can see is not a logo.
    upLogo: () => toast("Branding images need a public file route, which is not built yet."),
    upBg: () => toast("Branding images need a public file route, which is not built yet."),

    // The five-accent picker retired with spec 0002 — the palette is fixed,
    // and pretending public pages would restyle was never true anyway.
    pubAccents: [],
    pubAccentLine: "This build ships one palette; public pages match it.",

    /* Four switches used to sit here, defaulted on, animating on click and
     * toasting that the preference was not stored. Two of the four named
     * emails do not exist anywhere in the product, and a third — the decision
     * notice — is deliberately never automatic, so an off switch for it
     * implied a danger the design has already made impossible. A switch that
     * changes nothing is worse than no switch: the operator makes a choice,
     * the screen confirms it, and the next send ignores it.
     *
     * What replaces them is the same treatment this screen's Integrations
     * panel already uses — what is true, said plainly. */
    mails: [
      {
        n: "Submission confirmation",
        trigger:
          "The moment a proposal is submitted, carrying its code so the speaker can check status later.",
        state: "Automatic",
        link: "See it in Messages",
        linkD: "inline-flex",
        ...OK_TONE,
      },
      {
        n: "Overdue deliverable reminder",
        trigger:
          "Nightly, to speakers with something past due. The same 24-hour floor as the manual nudge, so a sweep and a chase cannot double up.",
        state: "Automatic",
        link: "Chase from Tasks",
        linkD: "inline-flex",
        ...OK_TONE,
      },
      {
        n: "Schedule change",
        trigger:
          "When you publish with “email the speakers whose session changed” ticked — never on a publish that changed nothing.",
        state: "You choose",
        link: "Publish from Agenda",
        linkD: "inline-flex",
        ...ASK_TONE,
      },
      {
        n: "Decision notice",
        trigger:
          "Queues when you set a decision and waits. Only Send decisions releases it, against a recipient count the server recomputes.",
        state: "Never automatic",
        link: "Send from Messages",
        linkD: "inline-flex",
        ...ASK_TONE,
      },
      {
        n: "CFP closing reminder",
        trigger:
          "Not built. Nothing counts down to the close date, so nobody is reminded to submit.",
        state: "Not built",
        link: "",
        linkD: "none",
        ...OFF_TONE,
      },
    ],
    mailFoot:
      "Deciding is not sending. Setting accept, reject or waitlist writes the outcome and emails nobody; Messages is the only thing in the product that can mail a decision, and it makes you confirm the count first.",

    /* This panel used to assert "Accelevents · Connected · event id ae_88412 ·
     * last push 6 Aug 14:02 · 12 create, 3 update, 0 fail" as literal markup,
     * on an integration APP_CONTEXT records as cut. Beside it sat a webhook
     * form for a declared non-goal whose "Send test" only ever apologised, and
     * an API key for a product that has no API keys. All of it is gone. What is
     * left is true, and the one genuinely-built item says so plainly. */
    integrations: [
      {
        n: "Calendar invites",
        state: "Built",
        note: "A real .ics with a stable UID and an incrementing SEQUENCE, so a speaker's calendar updates the existing entry instead of growing a second one. It goes out from the agenda when you publish with \u201cemail the speakers whose session changed\u201d ticked \u2014 never with a decision, because an accepted talk has no time yet.",
        ...OK_TONE,
      },
      {
        n: "Accelevents push",
        state: "API only",
        note: "Pushing the accepted programme to Accelevents is implemented and tested at the API — configure, test the connection, dry-run, execute — but no console screen reaches it yet. Credentials are sealed at rest and never returned once saved.",
        ...OFF_TONE,
      },
      {
        n: "Outbound webhooks",
        state: "Not planned",
        note: "A declared non-goal, along with Zapier. If you need the data out, the schedule and speaker JSON are on the public event pages and the embed reads the same snapshot.",
        ...OFF_TONE,
      },
    ],
    integFoot:
      "Everything this product sends leaves through email, and every message it has sent is listed in Messages \u2014 there is no other outbound path.",

    // A mark per panel, matching the tile every other console head now carries.
    iEvent: SETTINGS_ICON.event,
    iBrand: SETTINGS_ICON.brand,
    iEmail: SETTINGS_ICON.email,
    iInteg: SETTINGS_ICON.integrations,

    toasts: toasts.map((entry) => ({ msg: entry.msg, onX: () => dismiss(entry.id) })),
  };

  return <Settings d={screen} />;
}
