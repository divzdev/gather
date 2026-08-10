"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { useConsoleChrome } from "@/components/console/chrome";
import { Settings, type SettingsData } from "@/components/design/Settings";
import { useTheme } from "@/components/ThemeProvider";
import { ACCENT_NAMES, ACCENTS } from "@/lib/theme";
import { API_BASE_URL } from "@/lib/api";
import { authed, getEventId } from "@/lib/session";

type Event = {
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

type Panel = "event" | "brand" | "email" | "integrations";

const PANELS: { key: Panel; label: string }[] = [
  { key: "event", label: "Event" },
  { key: "brand", label: "Brand" },
  { key: "email", label: "Email" },
  { key: "integrations", label: "Integrations" },
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

export default function SettingsPage() {
  const { chrome, toasts, toast, dismiss } = useConsoleChrome();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const eventId = typeof window === "undefined" ? null : getEventId();

  const [panel, setPanel] = useState<Panel>("event");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [revealKey, setRevealKey] = useState(false);
  const [mailsOn, setMailsOn] = useState<Record<string, boolean>>({});

  const { data: event } = useQuery({
    queryKey: ["event", eventId],
    enabled: eventId !== null,
    queryFn: () => authed<Event>(`/events/${eventId}`),
  });

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
   *  persist half-written dates. */
  const pending = useRef<number | null>(null);
  const commit = useCallback(
    (changes: Record<string, unknown>) => {
      if (pending.current !== null) window.clearTimeout(pending.current);
      pending.current = window.setTimeout(() => save.mutate(changes), COMMIT_DELAY_MS);
    },
    [save],
  );

  const field =
    <K extends keyof Draft>(key: K, onCommit: (value: string) => Record<string, unknown> | null) =>
    (event_: React.SyntheticEvent) => {
      const value = (event_.target as HTMLInputElement | HTMLSelectElement).value;
      setDraft((current) => ({ ...current, [key]: value }));
      const changes = onCommit(value);
      if (changes !== null) commit(changes);
    };

  /** A date only counts once it is whole; `2026-0` is not a date. */
  const whenComplete = (value: string, build: (value: string) => Record<string, unknown>) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? build(value) : null;

  const publicUrl =
    event === undefined ? "" : `${window.location.origin}/e/${event.slug}`;

  const screen: SettingsData = {
    ...chrome,

    panels: PANELS.map((entry) => {
      const active = panel === entry.key;
      return {
        n: entry.label,
        on: () => setPanel(entry.key),
        bg: active ? "var(--sw,#FFEAE6)" : "none",
        fg: active ? "var(--sg,#E04E4E)" : "var(--i2,#3E4E58)",
        wt: active ? "600" : "500",
        dot: active ? "inline-block" : "none",
      };
    }),
    pEvent: panel === "event",
    pBrand: panel === "brand",
    pEmail: panel === "email",
    pInteg: panel === "integrations",

    f: draft,
    onName: (e: React.SyntheticEvent) =>
      setDraft((c) => ({ ...c, name: (e.target as HTMLInputElement).value })),
    onSlug: (e: React.SyntheticEvent) =>
      setDraft((c) => ({ ...c, slug: (e.target as HTMLInputElement).value })),
    onLoc: (e: React.SyntheticEvent) =>
      setDraft((c) => ({ ...c, loc: (e.target as HTMLInputElement).value })),
    onHook: (e: React.SyntheticEvent) =>
      setDraft((c) => ({ ...c, hook: (e.target as HTMLInputElement).value })),
    onType: field("type", (value) => ({ status: value })),
    onTz: field("tz", (value) => ({ timezone: value.split(" · ")[0] })),
    onStarts: field("starts", (value) => whenComplete(value, (date) => ({ starts_on: date }))),
    onEnds: field("ends", (value) => whenComplete(value, (date) => ({ ends_on: date }))),
    onCfpCloses: field("cfpCloses", (value) =>
      value.trim() === ""
        ? { cfp_closes_at: null }
        : whenComplete(value, (date) => ({ cfp_closes_at: endOfDay(date) })),
    ),

    // The design has no save button; text fields commit when they lose focus.
    stamp: save.isPending
      ? "Saving…"
      : event === undefined
        ? "Loading"
        : `Editing ${event.name}`,

    copyUrl: () => {
      void navigator.clipboard.writeText(publicUrl);
      toast(`Copied ${publicUrl}`);
    },
    // Uploading works; serving a file to an anonymous visitor does not, and a
    // logo that only signed-in staff can see is not a logo.
    upLogo: () => toast("Branding images need a public file route, which is not built yet."),
    upBg: () => toast("Branding images need a public file route, which is not built yet."),

    pubAccents: ACCENT_NAMES.map((name) => ({
      n: name,
      c: ACCENTS[name].dot,
      on: () => theme.setAccent(name),
      ring:
        theme.accent === name
          ? `0 0 0 2px var(--cd,#FFFFFF), 0 0 0 4px ${ACCENTS[name].dot}`
          : "inset 0 0 0 1px rgba(0,0,0,.12)",
    })),
    pubAccentLine: `Public pages use ${theme.accent}.`,

    mails: [
      { key: "confirmation", n: "Submission confirmation", trigger: "on submit" },
      { key: "decision", n: "Decision notice", trigger: "when you send decisions" },
      { key: "reminder5", n: "CFP reminder", trigger: "5 days before close" },
      { key: "reminder1", n: "CFP reminder", trigger: "1 day before close" },
    ].map((mail) => {
      const on = mailsOn[mail.key] ?? true;
      return {
        n: mail.n,
        trigger: mail.trigger,
        on: (on ? "true" : "false") as "true" | "false",
        onTog: () => {
          setMailsOn((current) => ({ ...current, [mail.key]: !on }));
          toast("Scheduled mail is queued by the worker; this preference is not stored yet.");
        },
        swBg: on ? "var(--sg,#E04E4E)" : "var(--ls,#C8D2D5)",
        swX: on ? "14px" : "2px",
      };
    }),

    apiKey: revealKey ? `${API_BASE_URL} (no key needed — same origin)` : "••••••••••••••••",
    revealKey: () => setRevealKey((shown) => !shown),
    revealLabel: revealKey ? "Hide" : "Reveal",
    copyKey: () => {
      void navigator.clipboard.writeText(API_BASE_URL);
      toast("Copied the API base URL.");
    },
    testHook: () => toast("Outbound webhooks are not part of this build."),

    toasts: toasts.map((entry) => ({ msg: entry.msg, onX: () => dismiss(entry.id) })),
  };

  return <Settings d={screen} />;
}
