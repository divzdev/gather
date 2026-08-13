"use client";

/** The two things living under the rail's "Forms & pages".
 *
 *  The nav item has said "Forms & pages" since the IA cleanup while `/admin/forms`
 *  held only forms, so the second half of the label led nowhere. These sit on
 *  both screens so either one tells you the other exists.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/forms", label: "Forms" },
  { href: "/admin/pages", label: "Pages" },
] as const;

export function SectionTabs() {
  const pathname = usePathname();

  return (
    <div
      role="navigation"
      aria-label="Forms and pages"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 3,
        borderRadius: 999,
        background: "var(--sk,#EDF1F2)",
        border: "1px solid var(--ln,#E1E7E9)",
        marginBottom: 16,
      }}
    >
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href as "/admin/forms"}
            aria-current={active ? "page" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 32,
              padding: "0 16px",
              borderRadius: 999,
              textDecoration: "none",
              background: active ? "var(--cd,#FFFFFF)" : "transparent",
              boxShadow: active ? "0 1px 2px rgba(13,16,32,.12)" : "none",
              color: active ? "var(--ik,#16232B)" : "var(--i3,#6B7B84)",
              font: `${active ? 600 : 500} 12.5px 'IBM Plex Sans',sans-serif`,
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
