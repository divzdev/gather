"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { PageHead, card, pill } from "@/components/ui";
import { authed, getEventId } from "@/lib/session";

type Pending = { accepted: number; waitlisted: number; rejected: number; total: number };
type Page = { data: { status: string }[]; meta: { total: number } };

/** Action blocks ordered by urgency, and a clear "nothing needs you" state.
 *  No vanity charts: the design set rules them out. */
export default function OverviewPage() {
  const eventId = typeof window === "undefined" ? null : getEventId();

  const { data, isError } = useQuery({
    queryKey: ["overview", eventId],
    enabled: eventId !== null,
    queryFn: async () => {
      const [counts, page] = await Promise.all([
        authed<Pending>(`/events/${eventId}/submissions/pending-decisions`),
        authed<Page>(`/events/${eventId}/submissions?per_page=200`),
      ]);
      return { counts, page };
    },
  });

  const pending = data?.counts ?? null;
  const total = data?.page.meta.total ?? 0;
  const unreviewed = data?.page.data.filter((r) => r.status === "submitted").length ?? 0;
  const error =
    eventId === null
      ? "Sign in to see your event."
      : isError
        ? "Could not load your event."
        : null;

  const blocks = [
    {
      key: "decisions",
      when: (pending?.total ?? 0) > 0,
      tone: "pd",
      title: `${pending?.total ?? 0} decisions recorded but not sent`,
      body: "Nobody has been emailed yet. Review the recipient list before sending.",
      href: "/admin/submissions" as const,
      cta: "Review decisions",
    },
    {
      key: "unreviewed",
      when: unreviewed > 0,
      tone: "if",
      title: `${unreviewed} proposals waiting on review`,
      body: "Assign reviewers or open the review queue.",
      href: "/admin/review" as const,
      cta: "Open review",
    },
  ].filter((block) => block.when);

  return (
    <main style={{ padding: "20px 28px 80px" }}>
      <PageHead
        title="Good to see you"
        summary={
          total === 0
            ? "No proposals yet. Your call for papers is live."
            : `${total} proposals in. ${blocks.length === 0 ? "Nothing needs you right now." : "Here is what needs you."}`
        }
      />

      {error !== null && (
        <div style={{ ...card, padding: 14, borderColor: "var(--cnl)", background: "var(--cnw)", color: "var(--cn)" }}>
          {error}
        </div>
      )}

      {error === null && blocks.length === 0 && (
        <div style={{ ...card, padding: "40px 24px", textAlign: "center" }}>
          <p style={{ font: "600 15px var(--font-plex-sans)", color: "var(--ik)", margin: "0 0 6px" }}>
            Nothing needs you
          </p>
          <p style={{ font: "400 13px var(--font-plex-sans)", color: "var(--i3)", margin: 0 }}>
            Everything recorded has been actioned.
          </p>
        </div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {blocks.map((block) => (
          <div
            key={block.key}
            style={{
              ...card,
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "16px 18px",
              borderLeft: `3px solid var(--${block.tone})`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ font: "600 14px var(--font-plex-sans)", color: "var(--ik)", margin: 0 }}>
                {block.title}
              </p>
              <p style={{ font: "400 12.5px var(--font-plex-sans)", color: "var(--i3)", margin: "4px 0 0" }}>
                {block.body}
              </p>
            </div>
            <Link href={block.href} style={{ ...pill, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
              {block.cta}
            </Link>
          </div>
        ))}
      </div>
    </main>
  );
}
