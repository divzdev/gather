"use client";

/** The console's one header.
 *
 *  It carries global chrome only — which event you are in, search, notifications,
 *  who you are. Nothing about the current page appears here: no page name, no
 *  page actions. Those belong beside the page's own title, where the thing they
 *  act on is visible.
 *
 *  This exists because the thirteen generated screens each shipped the header
 *  inline from their prototype, and they drifted: search was on two of them at
 *  two different widths, the bell on two, a density toggle and a `?` on exactly
 *  one, and two screens had no header at all. A header that moves between pages
 *  reads as a different application on every click.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { openCommandPalette } from "@/components/console/CommandPalette";
import { EventSwitcher } from "@/components/console/EventSwitcher";
import { toggleMobileNav } from "@/components/console/mobileNav";
import { useConsoleChrome } from "@/components/console/chrome";
import { useProgramStats } from "@/components/console/stats";

const HOVER_CSS = `.gh-row:hover{background:var(--sk,#EDF1F2)}
.gh-danger:hover{background:var(--cnw,#FBE8E6)}
.gh-avatar:hover{border-color:var(--ls,#C8D2D5)}
.gh-search:hover{border-color:var(--ls,#C8D2D5)}`;

/** Escape closes whichever popover is open. The click-catcher below handles the
 *  pointer; without this the keyboard has no way out of the menu. */
function useEscape(onEscape: () => void, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape, active]);
}

export function ConsoleHeader() {
  const { chrome } = useConsoleChrome();
  const { stats } = useProgramStats();
  const [bell, setBell] = useState(false);

  const closeBell = () => setBell(false);
  useEscape(closeBell, bell);
  useEscape(chrome.closeUser, chrome.popUser);

  // The dot is a claim that something needs you. It only appears when one of
  // these is actually non-zero, so an empty console shows a clean bell.
  const alerts = (
    [
      {
        n: stats.conflicts,
        label: "schedule conflict",
        href: "/admin/agenda",
        tone: "var(--cn,#D8432B)",
      },
      {
        n: stats.overdueTasks,
        label: "overdue speaker task",
        href: "/admin/tasks",
        tone: "var(--pd,#B96A1F)",
      },
      {
        n: stats.unreviewed,
        label: "submission awaiting review",
        href: "/review",
        tone: "var(--if,#47599F)",
      },
    ] as const
  ).filter((row) => row.n > 0);

  return (
    <header
      style={{
        height: 64,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 20px",
        borderBottom: "1px solid var(--ln,#E1E7E9)",
        background: "var(--cd,#FFFFFF)",
        position: "relative",
        zIndex: 30,
      }}
    >
      <style>{HOVER_CSS}</style>

      {/* The way into the rail on a screen too narrow to keep one. Hidden above
       *  the breakpoint by `[data-console-menu]` in globals.css, where the rail
       *  is a column again and this would be a second way to do nothing. */}
      <button
        type="button"
        data-console-menu
        onClick={toggleMobileNav}
        aria-label="Open navigation"
        style={{
          width: 38,
          height: 38,
          flex: "none",
          display: "none",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 10,
          border: "1px solid var(--ln,#E1E7E9)",
          background: "var(--cd,#FFFFFF)",
          color: "var(--i2,#3E4E58)",
        }}
      >
        <svg
          viewBox="0 0 16 16"
          width="17"
          height="17"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <path d="M2 4h12M2 8h12M2 12h12" />
        </svg>
      </button>

      <EventSwitcher />

      <button
        type="button"
        className="gh-search"
        onClick={() => openCommandPalette()}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          flex: 1,
          minWidth: 0,
          maxWidth: 560,
          height: 40,
          padding: "0 16px",
          borderRadius: 11,
          background: "var(--sk,#EDF1F2)",
          border: "1px solid var(--ln,#E1E7E9)",
          font: "400 13.5px var(--font-plex-sans), sans-serif",
          color: "var(--i3,#6B7B84)",
          textAlign: "left",
          transition: "border-color .12s",
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          style={{ flex: "none" }}
          aria-hidden="true"
        >
          <circle cx="5" cy="5" r="3.6" />
          <path d="M8 8l2.6 2.6" />
        </svg>
        <span
          style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          Search or jump to…
        </span>
        <span
          style={{
            font: "500 10px var(--font-plex-mono), monospace",
            border: "1px solid var(--ls,#C8D2D5)",
            borderRadius: 4,
            padding: "1px 5px",
            flex: "none",
          }}
        >
          ⌘K
        </span>
      </button>

      <div style={{ flex: 1, minWidth: 0 }} />

      <div style={{ position: "relative", flex: "none" }}>
        <button
          type="button"
          className="gh-row"
          onClick={() => setBell((open) => !open)}
          aria-label="Notifications"
          aria-expanded={bell}
          title="Notifications"
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "none",
            border: "none",
            color: "var(--i2,#3E4E58)",
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden="true"
          >
            <path d="M7.5 1.8a3.9 3.9 0 0 1 3.9 3.9c0 2.6.8 3.6 1.4 4.2H2.2c.6-.6 1.4-1.6 1.4-4.2A3.9 3.9 0 0 1 7.5 1.8z" />
            <path d="M6.2 12.2a1.4 1.4 0 0 0 2.6 0" />
          </svg>
          {alerts.length === 0 ? null : (
            <span
              style={{
                position: "absolute",
                top: 5,
                right: 6,
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--cn,#D8432B)",
                border: "1.5px solid var(--cd,#FFFFFF)",
              }}
            />
          )}
        </button>
        {bell ? (
          <>
            <button
              type="button"
              onClick={closeBell}
              aria-label="Close notifications"
              style={{
                position: "fixed",
                inset: 0,
                background: "none",
                border: "none",
                cursor: "default",
                zIndex: 41,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 36,
                right: 0,
                width: 264,
                background: "var(--cd,#FFFFFF)",
                border: "1px solid var(--ln,#E1E7E9)",
                borderRadius: 12,
                boxShadow: "0 16px 40px rgba(13,16,32,.20)",
                padding: 6,
                zIndex: 42,
              }}
            >
              <div
                style={{
                  font: "600 9.5px var(--font-plex-sans), sans-serif",
                  letterSpacing: "0.1em",
                  color: "var(--i4,#99A6AD)",
                  padding: "8px 10px 6px",
                }}
              >
                NEEDS YOU
              </div>
              {alerts.length === 0 ? (
                <div
                  style={{
                    font: "400 12.5px var(--font-plex-sans), sans-serif",
                    color: "var(--i3,#6B7B84)",
                    padding: "2px 10px 10px",
                  }}
                >
                  Nothing waiting. No conflicts, no overdue tasks, no unreviewed proposals.
                </div>
              ) : (
                alerts.map((row) => (
                  <Link
                    key={row.href}
                    className="gh-row"
                    href={row.href}
                    onClick={closeBell}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "8px 10px",
                      borderRadius: 7,
                      textDecoration: "none",
                      font: "400 12.5px var(--font-plex-sans), sans-serif",
                      color: "var(--ik,#16232B)",
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: row.tone,
                        flex: "none",
                      }}
                    />
                    <span>
                      {row.n} {row.label}
                      {row.n === 1 ? "" : "s"}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </>
        ) : null}
      </div>

      <div style={{ position: "relative", flex: "none" }}>
        <button
          type="button"
          className="gh-avatar"
          onClick={chrome.togUser}
          title="Account"
          aria-label="Account menu"
          aria-expanded={chrome.popUser}
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--sk,#EDF1F2)",
            border: "1px solid var(--ln,#E1E7E9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: "600 10px var(--font-plex-sans), sans-serif",
            color: "var(--i2,#3E4E58)",
            padding: 0,
            transition: "border-color .12s",
          }}
        >
          {chrome.youInitials}
        </button>
        {chrome.popUser ? (
          <>
            <button
              type="button"
              onClick={chrome.closeUser}
              aria-label="Close account menu"
              style={{
                position: "fixed",
                inset: 0,
                background: "none",
                border: "none",
                cursor: "default",
                zIndex: 41,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 36,
                right: 0,
                width: 248,
                background: "var(--cd,#FFFFFF)",
                border: "1px solid var(--ln,#E1E7E9)",
                borderRadius: 12,
                boxShadow: "0 16px 40px rgba(13,16,32,.20)",
                padding: 6,
                zIndex: 42,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px" }}>
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "var(--sk,#EDF1F2)",
                    border: "1px solid var(--ln,#E1E7E9)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    font: "600 11px var(--font-plex-sans), sans-serif",
                    color: "var(--i2,#3E4E58)",
                    flex: "none",
                  }}
                >
                  {chrome.youInitials}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      font: "600 12.5px var(--font-plex-sans), sans-serif",
                      color: "var(--ik,#16232B)",
                    }}
                  >
                    {chrome.youName}
                  </span>
                  <span
                    style={{
                      display: "block",
                      font: "400 10.5px var(--font-plex-mono), monospace",
                      color: "var(--i4,#99A6AD)",
                    }}
                  >
                    {chrome.youRole}
                    {chrome.youOrg === "" ? "" : ` · ${chrome.youOrg}`}
                  </span>
                </span>
              </div>

              <div style={{ height: 1, background: "var(--ln,#E1E7E9)", margin: "4px 6px" }} />

              <div
                style={{
                  font: "600 9.5px var(--font-plex-sans), sans-serif",
                  letterSpacing: "0.1em",
                  color: "var(--i4,#99A6AD)",
                  padding: "8px 10px 6px",
                }}
              >
                THEME
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px 10px" }}
              >
                {chrome.accents.map((accent) => (
                  <button
                    type="button"
                    key={accent.n}
                    onClick={accent.on}
                    title={accent.n}
                    aria-label={accent.n}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      border: "none",
                      background: accent.c,
                      boxShadow: accent.ring,
                      padding: 0,
                      flex: "none",
                    }}
                  />
                ))}
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  className="gh-row"
                  onClick={chrome.togTheme}
                  title={chrome.themeTitle}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    height: 26,
                    padding: "0 10px",
                    borderRadius: 99,
                    border: "1px solid var(--ls,#C8D2D5)",
                    background: "none",
                    font: "500 11px var(--font-plex-sans), sans-serif",
                    color: "var(--i2,#3E4E58)",
                  }}
                >
                  {chrome.themeGlyph} {chrome.themeWord}
                </button>
              </div>

              <div style={{ height: 1, background: "var(--ln,#E1E7E9)", margin: "4px 6px" }} />

              <button
                type="button"
                className="gh-row"
                onClick={chrome.profileGo}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 7,
                  border: "none",
                  background: "none",
                  font: "400 12.5px var(--font-plex-sans), sans-serif",
                  color: "var(--ik,#16232B)",
                  textAlign: "left",
                }}
              >
                Your profile
              </button>
              <Link
                className="gh-row"
                href="/admin/settings"
                onClick={chrome.closeUser}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "8px 10px",
                  borderRadius: 7,
                  textDecoration: "none",
                  font: "400 12.5px var(--font-plex-sans), sans-serif",
                  color: "var(--ik,#16232B)",
                }}
              >
                Event settings
              </Link>

              <div style={{ height: 1, background: "var(--ln,#E1E7E9)", margin: "4px 6px" }} />

              <button
                type="button"
                className="gh-danger"
                onClick={chrome.signOut}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 7,
                  border: "none",
                  background: "none",
                  font: "400 12.5px var(--font-plex-sans), sans-serif",
                  color: "var(--cn,#D8432B)",
                  textAlign: "left",
                }}
              >
                Sign out
              </button>
            </div>
          </>
        ) : null}
      </div>
    </header>
  );
}
