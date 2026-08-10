import Link from "next/link";
import { notFound } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

export type EventInfo = {
  name: string;
  slug: string;
  description: string | null;
  location: string | null;
  starts_on: string;
  ends_on: string;
};

export async function getPublic<T>(slug: string, path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/public/events/${slug}${path}`, {
    cache: "no-store",
  });
  if (!response.ok) notFound();
  return response.json() as Promise<T>;
}

const NAV = [
  { href: "", label: "About" },
  { href: "/schedule", label: "Sessions" },
  { href: "/agenda", label: "Agenda" },
  { href: "/speakers", label: "Speakers" },
  { href: "/itinerary", label: "My schedule" },
  { href: "/cfp", label: "Submit a talk" },
] as const;

/** Public shell. Body is 16px here, not the console's 14px, and the display face
 *  is allowed because these are the pages strangers see. */
export function PublicShell({
  event,
  slug,
  active,
  children,
}: {
  event: EventInfo;
  slug: string;
  active: string;
  children: React.ReactNode;
}) {
  const dates = `${new Date(event.starts_on).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${new Date(event.ends_on).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div style={{ fontSize: 16, minHeight: "100vh", background: "var(--pp)" }}>
      <header style={{ borderBottom: "1px solid var(--ln)", background: "var(--cd)" }}>
        <div style={{ maxWidth: 1040, margin: "0 auto", padding: "18px 24px" }}>
          <p style={{ margin: 0, font: "600 10px var(--font-plex-condensed)", letterSpacing: "0.12em", color: "var(--i4)" }}>
            {dates}
            {event.location !== null ? ` · ${event.location}` : ""}
          </p>
          <h1 style={{ font: "600 30px var(--font-bricolage), sans-serif", color: "var(--ik)", margin: "4px 0 14px" }}>
            {event.name}
          </h1>
          <nav style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {NAV.map((item) => {
              const selected = active === item.label;
              return (
                <Link
                  key={item.label}
                  href={`/e/${slug}${item.href}` as never}
                  style={{
                    textDecoration: "none",
                    padding: "6px 14px",
                    borderRadius: 999,
                    font: "500 13px var(--font-plex-sans), sans-serif",
                    background: selected ? "var(--sw)" : "transparent",
                    color: selected ? "var(--sg)" : "var(--i2)",
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 24px 80px" }}>{children}</main>
    </div>
  );
}

export function NotPublished({ what }: { what: string }) {
  return (
    <div
      style={{
        background: "var(--cd)",
        border: "1px solid var(--ln)",
        borderRadius: 14,
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      <p style={{ font: "600 15px var(--font-plex-sans)", color: "var(--ik)", margin: "0 0 6px" }}>
        The {what} is not published yet
      </p>
      <p style={{ font: "400 14px var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}>
        Check back closer to the event.
      </p>
    </div>
  );
}
