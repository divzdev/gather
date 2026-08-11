"use client";

/** A right-anchored dialog for creating one record.
 *
 *  The program editors used to carry their add-form at the bottom of the list
 *  they add to, which puts the primary action of the screen below every row on
 *  it. With four rooms that is merely odd; with two hundred it is unreachable,
 *  and the empty state is reduced to pointing downwards at it.
 *
 *  A drawer instead of a centre modal because these forms sit beside a list you
 *  are reading — keeping the list on screen is the point. Anchored right rather
 *  than left so it never covers the rail you navigated from.
 */

import { useEffect, useRef, type ReactNode } from "react";

/* Keyframes rather than a transition driven by state: the panel only ever
   animates on mount, so a state flag would exist purely to be flipped one frame
   after it was set. */
const ANIMATION_CSS = `
@keyframes ghDrawerIn { from { transform: translateX(100%) } to { transform: translateX(0) } }
@keyframes ghScrimIn { from { opacity: 0 } to { opacity: 1 } }
@media (prefers-reduced-motion: reduce) {
  .gh-drawer, .gh-scrim { animation-duration: .01ms !important }
}`;

export function SideDrawer({
  open,
  title,
  subtitle,
  onClose,
  footer,
  width = "min(520px, 94vw)",
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  /** Widen for forms that lay their fields out in columns — the agenda's
   *  placement sheet puts day, room, start and length on one row and reads as a
   *  cramped column at the default. */
  width?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  /** Whatever was focused when the drawer opened, so closing returns you there
   *  rather than to the top of the document. */
  const opener = useRef<HTMLElement | null>(null);
  /** Callers pass an inline arrow, so a direct dependency would re-run this
   *  effect on every parent render — re-arming the listeners and yanking focus
   *  back to the first field while someone is typing in the second. */
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;

    opener.current = document.activeElement as HTMLElement | null;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab" || panel.current === null) return;
      // Contain Tab inside the panel: behind it is a whole console of controls
      // that look reachable and are not, once the scrim is up.
      const focusable = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'input, select, textarea, button:not([tabindex="-1"]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);

    const focusTimer = window.setTimeout(() => {
      panel.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    }, 60);

    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.clearTimeout(focusTimer);
      opener.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <style>{ANIMATION_CSS}</style>
      <button
        type="button"
        className="gh-scrim"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(13,16,32,.44)",
          border: "none",
          cursor: "default",
          zIndex: 70,
          animation: "ghScrimIn .18s ease both",
        }}
      />
      <div
        ref={panel}
        className="gh-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width,
          background: "var(--cd)",
          borderLeft: "1px solid var(--ln)",
          boxShadow: "-24px 0 60px rgba(13,16,32,.28)",
          zIndex: 71,
          display: "flex",
          flexDirection: "column",
          animation: "ghDrawerIn .22s cubic-bezier(.22,.61,.36,1) both",
        }}
      >
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            padding: "20px 24px 16px",
            borderBottom: "1px solid var(--ln)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2
              style={{
                font: "600 19px/1.2 var(--font-plex-sans)",
                letterSpacing: "-0.01em",
                color: "var(--ik)",
                margin: 0,
              }}
            >
              {title}
            </h2>
            {subtitle === undefined ? null : (
              <p
                style={{
                  font: "400 12.5px/1.5 var(--font-plex-sans)",
                  color: "var(--i3)",
                  margin: "6px 0 0",
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 28,
              height: 28,
              flex: "none",
              borderRadius: 7,
              border: "none",
              background: "none",
              color: "var(--i3)",
              font: "500 14px var(--font-plex-sans)",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 28px" }}>{children}</div>

        {footer === undefined ? null : (
          <div
            style={{
              flex: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 8,
              padding: "14px 24px",
              borderTop: "1px solid var(--ln)",
              background: "var(--cd)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </>
  );
}
