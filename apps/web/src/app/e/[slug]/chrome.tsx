/** The public event surface's furniture.
 *
 *  These pages are the conference's, not Gather's. A visitor arriving from a
 *  speaker's tweet has never heard of us and should not have to: the product's
 *  name appears once, in the footer, and everything above it belongs to the
 *  event.
 *
 *  Fixed dark, like the marketing landing and the sign-in screen, and for the
 *  same reason — a stranger has not set a theme, so there is nothing to follow.
 *  The console's tokens flip under the theme toggle and would have made one
 *  conference's public page look like two different sites depending on who last
 *  used the admin. The palette below is the landing's, in one place.
 */

export const INK = {
  page: "var(--e-page, #07080E)",
  raised: "var(--e-raised, #101018)",
  text: "var(--e-text, #F3F4F8)",
  muted: "var(--e-muted, #9A9FB1)",
  faint: "var(--e-faint, #7C8093)",
  edge: "var(--e-edge, rgba(255,255,255,.10))",
  edgeStrong: "var(--e-edge-strong, rgba(255,255,255,.18))",
  accent: "var(--e-accent, #FF6B6B)",
  onAccent: "var(--e-on-accent, #331313)",
} as const;

/** The six track hues from `tokens.css`, in the order `hue_index` counts. A
 *  track carries the same colour on every public page, which is what makes the
 *  agenda's spines and the session cards read as one programme. */
export const TRACK_HUES = [
  "var(--e-track-0, #7D8CFF)",
  "var(--e-track-1, #3BBFAD)",
  "var(--e-track-2, #E86A8B)",
  "var(--e-track-3, #63BC85)",
  "var(--e-track-4, #6FA8E8)",
  "var(--e-track-5, #C4703A)",
] as const;

export function trackHue(index: number | null | undefined): string {
  if (index === null || index === undefined) return INK.muted;
  const hue = TRACK_HUES[Math.abs(index) % TRACK_HUES.length];
  return hue ?? INK.muted;
}

export const MONO = "ui-monospace,'SF Mono',Menlo,monospace";
export const SANS = "var(--font-manrope), -apple-system, BlinkMacSystemFont, sans-serif";

export function display(size: string, weight = 800): React.CSSProperties {
  return {
    fontFamily: SANS,
    fontWeight: weight,
    letterSpacing: "-.03em",
    lineHeight: 1.05,
    fontSize: size,
    margin: 0,
  };
}

/** Small-caps label above a section. The landing calls these eyebrows. */
export function Eyebrow({ children, hue }: { children: React.ReactNode; hue?: string }) {
  return (
    <div
      style={{
        fontFamily: SANS,
        fontSize: 12.5,
        fontWeight: 800,
        letterSpacing: ".18em",
        textTransform: "uppercase",
        color: hue ?? INK.muted,
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

export function Section({
  children,
  eyebrow,
  title,
  lede,
  hue,
  tight,
}: {
  children?: React.ReactNode;
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  lede?: React.ReactNode;
  hue?: string;
  tight?: boolean;
}) {
  return (
    <section style={{ padding: tight === true ? "44px 0" : "clamp(56px,8vh,104px) 0" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 max(22px,4vw)" }}>
        {eyebrow === undefined ? null : <Eyebrow hue={hue}>{eyebrow}</Eyebrow>}
        {title === undefined ? null : (
          <h2 style={{ ...display("clamp(1.7rem,3.1vw,2.6rem)"), color: INK.text }}>{title}</h2>
        )}
        {lede === undefined ? null : (
          <p
            style={{
              fontFamily: SANS,
              fontSize: "clamp(1rem,1.25vw,1.12rem)",
              color: INK.muted,
              fontWeight: 500,
              lineHeight: 1.6,
              margin: "16px 0 0",
              maxWidth: "42em",
            }}
          >
            {lede}
          </p>
        )}
        {children === undefined ? null : (
          <div style={{ marginTop: title === undefined && eyebrow === undefined ? 0 : 34 }}>
            {children}
          </div>
        )}
      </div>
    </section>
  );
}

/** A tinted pill. Colour never carries the meaning alone — every one of these
 *  has a word in it. */
export function Chip({
  children,
  hue = INK.muted,
  solid,
}: {
  children: React.ReactNode;
  hue?: string;
  solid?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        minHeight: 30,
        padding: "0 14px",
        borderRadius: 999,
        fontFamily: SANS,
        fontSize: 12.5,
        fontWeight: 700,
        letterSpacing: ".02em",
        color: solid === true ? INK.onAccent : hue,
        background: solid === true ? hue : `color-mix(in srgb, ${hue} 15%, transparent)`,
        border: `1px solid ${solid === true ? "transparent" : `color-mix(in srgb, ${hue} 35%, transparent)`}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function Dot({ hue }: { hue: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 7,
        height: 7,
        borderRadius: 999,
        background: hue,
        display: "inline-block",
        flex: "none",
      }}
    />
  );
}

type ButtonProps = {
  href: string;
  children: React.ReactNode;
  tone?: "solid" | "outline";
};

/** Links, not buttons: every one of these navigates, and a `<button>` that
 *  navigates loses middle-click, open-in-new-tab and the status bar. */
export function Cta({ href, children, tone = "solid" }: ButtonProps) {
  const solid = tone === "solid";
  return (
    <a
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 48,
        padding: "0 28px",
        borderRadius: 999,
        fontFamily: SANS,
        fontSize: 15.5,
        fontWeight: 700,
        textDecoration: "none",
        background: solid ? INK.text : "rgba(7,8,14,.35)",
        color: solid ? "#0A0B12" : INK.text,
        border: solid ? "1px solid transparent" : `1px solid ${INK.edgeStrong}`,
        backdropFilter: solid ? undefined : "blur(6px)",
      }}
    >
      {children}
    </a>
  );
}

export function Card({
  children,
  hue,
  padding = 24,
}: {
  children: React.ReactNode;
  hue?: string;
  padding?: number;
}) {
  return (
    <div
      style={{
        position: "relative",
        background: INK.raised,
        border: `1px solid ${INK.edge}`,
        borderRadius: 16,
        padding,
        overflow: "hidden",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      {hue === undefined ? null : (
        <span
          aria-hidden
          style={{ position: "absolute", inset: "0 auto 0 0", width: 3, background: hue }}
        />
      )}
      {children}
    </div>
  );
}

/** Initials on a tinted disc. Speakers have a `headshot_file_id` only once they
 *  have uploaded one, and most have not by the time a programme goes public —
 *  a grid of identical grey silhouettes is worse than no faces at all. */
export function Initials({ name, size = 52 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  // Deterministic, so the same person is the same colour on every page.
  const seed = [...name].reduce((total, character) => total + character.charCodeAt(0), 0);
  const hue = trackHue(seed);
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        background: `color-mix(in srgb, ${hue} 22%, ${INK.raised})`,
        border: `1px solid color-mix(in srgb, ${hue} 40%, transparent)`,
        color: hue,
        fontFamily: SANS,
        fontWeight: 800,
        fontSize: Math.round(size * 0.34),
        letterSpacing: ".02em",
      }}
    >
      {initials}
    </span>
  );
}

/** Not an error. A programme that is not published yet is the normal state for
 *  most of a conference's life, and it should read as anticipation rather than
 *  as something broken. */
export function NotPublished({ what, slug }: { what: string; slug: string }) {
  return (
    <Section>
      <div
        style={{
          border: `1px solid ${INK.edge}`,
          borderRadius: 20,
          padding: "clamp(36px,7vw,72px)",
          textAlign: "center",
          background: `radial-gradient(90% 120% at 50% 0%, rgba(255,107,107,.10), transparent 70%), ${INK.raised}`,
        }}
      >
        <Eyebrow>Not yet</Eyebrow>
        <h2 style={{ ...display("clamp(1.5rem,2.6vw,2.1rem)"), color: INK.text }}>
          The {what} goes live once the programme is set.
        </h2>
        <p
          style={{
            fontFamily: SANS,
            fontSize: 15.5,
            color: INK.muted,
            fontWeight: 500,
            lineHeight: 1.6,
            margin: "16px auto 28px",
            maxWidth: "34em",
          }}
        >
          Talks are still being chosen. When the organisers publish, everything appears here at once
          — every session, who is giving it, and where.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Cta href={`/e/${slug}`} tone="outline">
            Back to the event
          </Cta>
        </div>
      </div>
    </Section>
  );
}
