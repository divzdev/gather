"use client";

/** The sign-in screen's furniture, kept apart from its logic.
 *
 *  This surface does not use the console's theme tokens, and that is deliberate
 *  rather than an oversight: sign-in is a marketing surface with one fixed dark
 *  treatment, designed in `GatherDesign/Auth.dc.html`. The console's tokens flip
 *  with the theme toggle, which nobody has set yet at the point they are looking
 *  at this page. The palette below is that design, in one place instead of
 *  scattered through the markup.
 */

import Link from "next/link";

export const INK = {
  page: "#07080E",
  text: "#F3F4F8",
  muted: "#9A9FB1",
  // Lighter than the prototype's dim grey, which measures 3.31:1 on `page` and
  // fails AA. The text it carries is instructional — "At least 12 characters",
  // the footer note — not decoration, so it has to be readable. This is 5.11:1.
  faint: "#7C8093",
  field: "#121216",
  edge: "#2A2A31",
  pill: "#F1F1F2",
  onPill: "#141417",
} as const;

export const HAIRLINE = "rgba(255,255,255,.18)";
const MONO = "ui-monospace,'SF Mono',Menlo,monospace";

export const display = (size: string) => ({
  fontFamily: "var(--font-manrope), sans-serif",
  fontWeight: 800,
  letterSpacing: "-.03em",
  fontSize: size,
  lineHeight: 1.05,
});

export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size, borderRadius: size / 3.7 }}>
      <rect width="24" height="24" rx="6.5" fill="#F1F1F2" />
      <circle cx="14.7" cy="14.7" r="5.7" fill="#9FA1E8" />
      <circle cx="6.3" cy="6.3" r="2.7" fill="#141417" />
      <circle cx="14.4" cy="5.4" r="1.9" fill="#141417" />
      <circle cx="5.4" cy="14.4" r="1.9" fill="#141417" />
    </svg>
  );
}

export function GithubGlyph({ size = 17 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      style={{ width: size, height: size, fill: "currentColor", display: "block", flex: "none" }}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** The photographic half. Hidden below 1024px, where it would be a header nobody
 *  asked for above the form they came for.
 *
 *  Served from this repository, not from the design tool that produced the
 *  prototype: the original was a 2.7 MB PNG on a third-party CDN, which is a
 *  referrer leak on the sign-in page, a blank panel on a machine with no
 *  network, and forty times the bytes. It is 48 KB of WebP now. The gradient
 *  underneath is the brand palette, so a failed load still leaves a composed
 *  panel rather than a hole.
 */
export function BrandPanel() {
  return (
    <div
      className="relative hidden overflow-hidden lg:block"
      style={{
        background:
          `radial-gradient(90% 60% at 20% 15%, rgba(255,107,107,.22), transparent 70%),` +
          `radial-gradient(70% 50% at 80% 90%, rgba(125,140,255,.16), transparent 70%), #0B0C13`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- next/image wants
          intrinsic dimensions or `fill`, and this is a decorative full-bleed
          layer already sized by CSS; the asset is pre-optimised at build time
          rather than on request. */}
      <img
        src="/design/photos/keynote-hall.webp"
        alt=""
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "50% 40%",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            `linear-gradient(to right, rgba(7,8,14,.25), rgba(7,8,14,.7) 82%, ${INK.page}),` +
            `linear-gradient(to top, rgba(7,8,14,.85), rgba(7,8,14,.15) 45%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "34px 40px",
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            minHeight: 36,
            textDecoration: "none",
            color: INK.text,
            width: "max-content",
          }}
        >
          <Mark />
          <span style={{ ...display("19px"), letterSpacing: "-.02em" }}>Gather</span>
        </Link>
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: INK.muted,
              marginBottom: 14,
            }}
          >
            Open source · MIT · <b style={{ color: INK.pill }}>Nothing to buy</b>
          </div>
          <div
            style={{
              ...display("clamp(1.7rem,2.6vw,2.4rem)"),
              lineHeight: 1.08,
              maxWidth: "11em",
              color: INK.text,
            }}
          >
            Every talk on that stage started here.
          </div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: INK.muted, marginTop: 16 }}>
            214 proposals · 61 sessions · 80 speakers
          </div>
        </div>
      </div>
    </div>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "22px 0" }}>
      <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,.1)" }} />
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".14em", color: INK.faint }}>
        {label}
      </span>
      <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,.1)" }} />
    </div>
  );
}

export function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: "block",
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: ".1em",
        textTransform: "uppercase",
        color: INK.muted,
        margin: "0 0 8px",
      }}
    >
      {children}
    </label>
  );
}

export function fieldStyle(invalid: boolean): React.CSSProperties {
  return {
    width: "100%",
    boxSizing: "border-box",
    height: 46,
    background: INK.field,
    border: `1px solid ${invalid ? "#F27E95" : INK.edge}`,
    borderRadius: 11,
    padding: "13px 15px",
    fontFamily: "var(--font-manrope), sans-serif",
    fontSize: 15,
    fontWeight: 500,
    color: INK.text,
    outline: "none",
  };
}

/** The white pill. One per screen, and it always says what it is about to do. */
export function Primary({
  children,
  onClick,
  busy,
  type = "submit",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  busy?: boolean;
  type?: "submit" | "button";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy}
      style={{
        width: "100%",
        minHeight: 48,
        background: INK.text,
        color: "#0A0B12",
        border: "none",
        borderRadius: 980,
        padding: "14px 24px",
        fontFamily: "var(--font-manrope), sans-serif",
        fontSize: 15.5,
        fontWeight: 700,
        cursor: busy ? "wait" : "pointer",
        opacity: busy ? 0.7 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function Quiet({
  children,
  onClick,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        width: "100%",
        minHeight: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        background: "none",
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 980,
        padding: "12px 24px",
        fontFamily: "var(--font-manrope), sans-serif",
        fontSize: 14,
        fontWeight: 700,
        color: INK.muted,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/** A said-something box: the magic link went out, or the account needs
 *  confirming. Never a dead end — every one of these carries the next action. */
export function Notice({
  tone = "quiet",
  children,
}: {
  tone?: "quiet" | "warn";
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        border: `1px solid ${tone === "warn" ? "#66302E" : HAIRLINE}`,
        background: tone === "warn" ? "#3A1D1D" : INK.field,
        borderRadius: 14,
        padding: "14px 16px",
        marginTop: 14,
        fontSize: 13.5,
        fontWeight: 600,
        lineHeight: 1.55,
        color: INK.text,
      }}
    >
      {children}
    </div>
  );
}

export const monoFont = MONO;
