"use client";

import { usePathname } from "next/navigation";

import { Rail } from "@/components/console/Rail";

/** Shell for the screens that are not yet ported.
 *
 * They used to carry a second, hand-built rail, so moving between a ported
 * screen and an unported one looked like moving between two different apps.
 * One rail, everywhere.
 */
const NAV = [
  ["/admin/submissions", "Submissions"],
  ["/admin/sessions", "Sessions"],
  ["/admin/review", "Review"],
  ["/admin/speakers", "Speakers"],
  ["/admin/agenda", "Agenda"],
  ["/admin/tasks", "Tasks"],
  ["/admin/messages", "Messages"],
  ["/admin/forms", "Forms"],
  ["/admin/publishing", "Publishing"],
  ["/admin/settings", "Settings"],
] as const;

type NavName = (typeof NAV)[number][1];

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const match = NAV.find(([href]) => pathname.startsWith(href));
  const active: NavName | "Overview" = match?.[1] ?? "Overview";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0,1fr)",
        height: "100vh",
        overflow: "hidden",
        background: "var(--pp, #F4F6F7)",
        color: "var(--ik, #16232B)",
      }}
    >
      <Rail active={active} style={{ height: "100%", minHeight: 0 }} />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</div>
    </div>
  );
}
