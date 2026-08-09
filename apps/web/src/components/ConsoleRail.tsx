"use client";

/**
 * Console navigation. Ported from ConsoleRail.dc.html: 216px expanded, 64px
 * collapsed icon-only, pill-shaped active item in accent-weak tint, small-caps
 * group eyebrows, org card at the top and profile at the foot. Collapse state
 * persists under the same `gather.rail` key the prototype used.
 */

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";

const RAIL_KEY = "gather.rail";

type Item = { label: string; href: Route; icon: React.ReactNode; count?: number };
type Group = { eyebrow: string | null; items: Item[] };

const icon = (paths: React.ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ flex: "none" }}>
    {paths}
  </svg>
);

const GROUPS: Group[] = [
  {
    eyebrow: null,
    items: [
      { label: "Overview", href: "/admin", icon: icon(<><rect x="1.8" y="1.8" width="4.6" height="4.6" rx="1.2" /><rect x="8.6" y="1.8" width="4.6" height="4.6" rx="1.2" /><rect x="1.8" y="8.6" width="4.6" height="4.6" rx="1.2" /><rect x="8.6" y="8.6" width="4.6" height="4.6" rx="1.2" /></>) },
    ],
  },
  {
    eyebrow: "PROGRAM",
    items: [
      { label: "Submissions", href: "/admin/submissions", icon: icon(<><path d="M2 3.2h11M2 7.5h11M2 11.8h7" strokeLinecap="round" strokeWidth="2" /></>) },
      { label: "Sessions", href: "/admin/sessions", icon: icon(<><rect x="1.8" y="2.6" width="11.4" height="9.8" rx="1.6" /><path d="M1.8 5.6h11.4" /></>) },
      { label: "Review", href: "/admin/review", icon: icon(<><path d="M7.5 2.2l1.7 3.4 3.8.5-2.7 2.6.6 3.7-3.4-1.8-3.4 1.8.6-3.7L2 6.1l3.8-.5z" strokeLinejoin="round" /></>) },
      { label: "Speakers", href: "/admin/speakers", icon: icon(<><circle cx="7.5" cy="5" r="2.6" /><path d="M2.6 12.8c.6-2.5 2.5-3.8 4.9-3.8s4.3 1.3 4.9 3.8" strokeLinecap="round" /></>) },
      { label: "Agenda", href: "/admin/agenda", icon: icon(<><rect x="1.8" y="2.8" width="11.4" height="10" rx="1.6" /><path d="M4.6 1.6v2.4M10.4 1.6v2.4M1.8 6.4h11.4" strokeLinecap="round" /></>) },
    ],
  },
  {
    eyebrow: "OPERATIONS",
    items: [
      { label: "Tasks", href: "/admin/tasks", icon: icon(<><path d="M2.4 4.4l1.6 1.6 3-3.2M2.4 10.4l1.6 1.6 3-3.2M8.8 4.6h4M8.8 10.6h4" strokeLinecap="round" /></>) },
      { label: "Messages", href: "/admin/messages", icon: icon(<><rect x="1.8" y="3.2" width="11.4" height="8.6" rx="1.6" /><path d="M2.4 4.2l5.1 3.6 5.1-3.6" /></>) },
    ],
  },
  {
    eyebrow: "SETUP",
    items: [
      { label: "Forms", href: "/admin/forms", icon: icon(<><rect x="2.4" y="1.8" width="10.2" height="11.4" rx="1.6" /><path d="M4.8 5.2h5.4M4.8 7.8h5.4M4.8 10.4h3" strokeLinecap="round" /></>) },
      { label: "Publishing", href: "/admin/publishing", icon: icon(<><circle cx="7.5" cy="7.5" r="5.5" /><path d="M2 7.5h11M7.5 2c1.6 1.8 2.4 3.7 2.4 5.5S9.1 11.2 7.5 13c-1.6-1.8-2.4-3.7-2.4-5.5S5.9 3.8 7.5 2z" /></>) },
      { label: "Settings", href: "/admin/settings", icon: icon(<><circle cx="7.5" cy="7.5" r="2.2" /><path d="M7.5 1.6v1.8M7.5 11.6v1.8M13.4 7.5h-1.8M3.4 7.5H1.6M11.7 3.3l-1.3 1.3M4.6 10.4l-1.3 1.3M11.7 11.7l-1.3-1.3M4.6 4.6L3.3 3.3" strokeLinecap="round" /></>) },
    ],
  },
  {
    eyebrow: "DEMO",
    items: [
      { label: "Speaker portal", href: "/portal", icon: icon(<><rect x="3.4" y="1.8" width="8.2" height="11.4" rx="1.8" /><path d="M6.6 11.2h1.8" strokeLinecap="round" /></>) },
    ],
  },
];

const listeners = new Set<() => void>();

function subscribeRail(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function railSnapshot(): string {
  return window.localStorage.getItem(RAIL_KEY) === "collapsed" ? "collapsed" : "open";
}

export function ConsoleRail() {
  const pathname = usePathname();
  const state = useSyncExternalStore(subscribeRail, railSnapshot, () => "open");
  const collapsed = state === "collapsed";

  const toggle = useCallback(() => {
    const next = window.localStorage.getItem(RAIL_KEY) === "collapsed" ? "open" : "collapsed";
    window.localStorage.setItem(RAIL_KEY, next);
    for (const listener of listeners) listener();
  }, []);

  // Longest match wins, so /admin/submissions does not also light up Overview.
  const activeHref = GROUPS.flatMap((g) => g.items)
    .map((i) => i.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav
      aria-label="Console"
      style={{
        width: collapsed ? 64 : 216,
        flex: "none",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: "var(--cd, #FFFFFF)",
        borderRight: "1px solid var(--ln, #E1E7E9)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: collapsed ? "12px 0" : "12px 12px",
          justifyContent: collapsed ? "center" : "flex-start",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "#12142E",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--bt, #FF6B6B)" }} />
        </span>
        {!collapsed && (
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: "block", font: "600 13px var(--font-plex-sans), sans-serif", color: "var(--ik, #16232B)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              DevFlow Conf 2027
            </span>
            <span className="tabular" style={{ display: "block", font: "400 10.5px var(--font-plex-mono), monospace", color: "var(--i4, #99A6AD)" }}>
              12–14 May
            </span>
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Open sidebar" : "Collapse sidebar"}
          title={collapsed ? "Open sidebar" : "Collapse sidebar"}
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border: "1px solid var(--ln, #E1E7E9)",
            background: "none",
            color: "var(--i3, #6B7B84)",
            display: collapsed ? "none" : "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M7.5 2.5L4 6l3.5 3.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 8px 12px" }}>
        {GROUPS.map((group, index) => (
          <div key={group.eyebrow ?? `group-${index}`}>
            {group.eyebrow !== null &&
              (collapsed ? (
                <div style={{ height: 1, background: "var(--ln, #E1E7E9)", margin: "9px 12px" }} />
              ) : (
                <div
                  style={{
                    font: "600 9.5px var(--font-plex-condensed), sans-serif",
                    letterSpacing: "0.1em",
                    color: "var(--i4, #99A6AD)",
                    padding: "12px 10px 6px",
                  }}
                >
                  {group.eyebrow}
                </div>
              ))}
            {group.items.map((item) => {
              const active = item.href === activeHref;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  aria-current={active ? "page" : undefined}
                  style={{
                    textDecoration: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    height: 38,
                    padding: collapsed ? 0 : "0 12px",
                    justifyContent: collapsed ? "center" : "flex-start",
                    borderRadius: 99,
                    background: active ? "var(--sw, #FFEAE6)" : "transparent",
                    color: active ? "var(--sg, #E04E4E)" : "var(--i2, #3E4E58)",
                    font: `${active ? 600 : 400} 13.5px var(--font-plex-sans), sans-serif`,
                  }}
                >
                  {item.icon}
                  {!collapsed && (
                    <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.label}
                    </span>
                  )}
                  {!collapsed && active && (
                    <span aria-hidden style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--sg, #E04E4E)", flex: "none" }} />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div
        style={{
          borderTop: "1px solid var(--ln, #E1E7E9)",
          padding: collapsed ? "10px 0" : "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          justifyContent: collapsed ? "center" : "flex-start",
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--sk, #EDF1F2)",
            border: "1px solid var(--ln, #E1E7E9)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            font: "600 10px var(--font-plex-condensed), sans-serif",
            color: "var(--i2, #3E4E58)",
            flex: "none",
          }}
        >
          JA
        </span>
        {!collapsed && (
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", font: "600 12.5px var(--font-plex-sans), sans-serif", color: "var(--ik, #16232B)" }}>
              Jordan Alvarez
            </span>
            <span style={{ display: "block", font: "400 10.5px var(--font-plex-mono), monospace", color: "var(--i4, #99A6AD)" }}>
              program lead
            </span>
          </span>
        )}
      </div>
    </nav>
  );
}

export function railToggleForCollapsed() {
  return null;
}
