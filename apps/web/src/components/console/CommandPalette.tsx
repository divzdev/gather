"use client";

/** ⌘K from anywhere in the console.
 *
 *  Screens first, because that is what it is used for ninety percent of the
 *  time and they need no round trip. Submissions and speakers are searched only
 *  once there is something to search for, so opening the palette costs nothing.
 *
 *  Mounted by the rail, which is on every console screen — a palette that works
 *  on some screens is worse than none, because you stop reaching for it.
 */

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { authed, getEventId } from "@/lib/session";

type Item = { label: string; hint: string; href: string };

/** The header's "Search or jump to… ⌘K" button lives inside a generated screen
 *  component, three levels away from the palette's state. A window event is the
 *  smallest thing that connects them without a store or a context provider for
 *  one boolean. */
export const PALETTE_EVENT = "gather:palette";

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(PALETTE_EVENT));
}

const SCREENS: Item[] = [
  { label: "Overview", hint: "Screen", href: "/admin" },
  { label: "Submissions", hint: "Screen", href: "/admin/submissions" },
  { label: "Sessions", hint: "Screen", href: "/admin/sessions" },
  { label: "Review", hint: "Screen", href: "/admin/review" },
  { label: "Speakers", hint: "Screen", href: "/admin/speakers" },
  { label: "Speaker directory", hint: "Screen", href: "/admin/directory" },
  { label: "Rooms & tracks", hint: "Screen", href: "/admin/program" },
  { label: "Agenda", hint: "Screen", href: "/admin/agenda" },
  { label: "Tasks", hint: "Screen", href: "/admin/tasks" },
  { label: "Messages", hint: "Screen", href: "/admin/messages" },
  { label: "Forms", hint: "Screen", href: "/admin/forms" },
  { label: "Publishing", hint: "Screen", href: "/admin/publishing" },
  { label: "Settings", hint: "Screen", href: "/admin/settings" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const eventId = typeof window === "undefined" ? null : getEventId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
        setQuery("");
        setCursor(0);
      }
      if (event.key === "Escape") setOpen(false);
    };
    const onAsk = () => {
      setQuery("");
      setCursor(0);
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_EVENT, onAsk);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(PALETTE_EVENT, onAsk);
    };
  }, []);

  const term = query.trim();
  const { data: found } = useQuery({
    queryKey: ["palette", eventId, term],
    // Two characters, so the first keystroke does not fire a search.
    enabled: open && eventId !== null && term.length >= 2,
    queryFn: async () => {
      const [submissions, speakers] = await Promise.all([
        authed<{ data: { id: string; title: string; code: string }[] }>(
          `/events/${eventId}/submissions?per_page=5&q=${encodeURIComponent(term)}`,
        ).catch(() => ({ data: [] })),
        authed<{ id: string; name: string; email: string }[]>(
          `/events/${eventId}/speakers`,
        ).catch(() => []),
      ]);
      const needle = term.toLowerCase();
      return [
        ...submissions.data.map((row) => ({
          label: row.title,
          hint: `Submission ${row.code}`,
          href: `/admin/submissions?open=${row.id}`,
        })),
        ...speakers
          .filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(needle))
          .slice(0, 5)
          .map((row) => ({
            label: row.name,
            hint: "Speaker",
            href: `/admin/speakers?open=${row.id}`,
          })),
      ];
    },
  });

  if (!open) return null;

  const screens = SCREENS.filter((item) =>
    term === "" ? true : item.label.toLowerCase().includes(term.toLowerCase()),
  );
  const results = [...screens, ...(found ?? [])].slice(0, 12);
  const active = Math.min(cursor, Math.max(0, results.length - 1));

  const go = (item: Item | undefined) => {
    if (item === undefined) return;
    setOpen(false);
    router.push(item.href as never);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(13,16,32,.36)",
        display: "grid",
        placeItems: "start center",
        paddingTop: "12vh",
        zIndex: 120,
      }}
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 560,
          maxWidth: "92vw",
          background: "var(--cd,#FFFFFF)",
          border: "1px solid var(--ln,#E1E7E9)",
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(13,16,32,.28)",
          overflow: "hidden",
        }}
      >
        <input
          autoFocus
          value={query}
          aria-label="Search screens, submissions and speakers"
          placeholder="Jump to a screen, a proposal, or a speaker"
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((current) => Math.min(current + 1, results.length - 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((current) => Math.max(current - 1, 0));
            }
            if (event.key === "Enter") go(results[active]);
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            height: 52,
            padding: "0 18px",
            border: "none",
            borderBottom: "1px solid var(--ln,#E1E7E9)",
            background: "none",
            font: "400 15px var(--font-plex-sans), sans-serif",
            color: "var(--ik,#16232B)",
            outline: "none",
          }}
        />
        <ul role="listbox" style={{ listStyle: "none", margin: 0, padding: 6, maxHeight: 380, overflowY: "auto" }}>
          {results.length === 0 ? (
            <li
              style={{
                padding: "12px 14px",
                font: "400 13px var(--font-plex-sans), sans-serif",
                color: "var(--i4,#99A6AD)",
              }}
            >
              Nothing matches “{term}”.
            </li>
          ) : (
            results.map((item, index) => (
              <li key={`${item.href}-${item.label}`}>
                <button
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => go(item)}
                  style={{
                    display: "flex",
                    width: "100%",
                    alignItems: "baseline",
                    gap: 10,
                    padding: "9px 12px",
                    borderRadius: 8,
                    border: "none",
                    textAlign: "left",
                    background: index === active ? "var(--sw,#FFEAE6)" : "none",
                    color: index === active ? "var(--sg,#E04E4E)" : "var(--ik,#16232B)",
                    font: "500 13.5px var(--font-plex-sans), sans-serif",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
                  <span
                    style={{
                      font: "400 11px var(--font-plex-mono), monospace",
                      color: "var(--i4,#99A6AD)",
                    }}
                  >
                    {item.hint}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
