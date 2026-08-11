"use client";

/** One piece of the program skeleton, on its own screen.
 *
 *  Each of these used to be a section of a four-editor scroll. Given a page of
 *  its own, each can say what it is for and show what already exists without
 *  competing with three others for the top of the viewport.
 */

import { notFound, useParams } from "next/navigation";

import { useProgramStats } from "@/components/console/stats";

import { PANELS, ProgramSection } from "../panels";
import { ProgramShell, SECTIONS } from "../shell";

export default function ProgramSectionPage() {
  const params = useParams<{ section: string }>();
  const { eventId } = useProgramStats();

  const section = SECTIONS.find((entry) => entry.key === params.section);
  const panel = PANELS.find((entry) => entry.key === params.section);
  if (section === undefined || panel === undefined) notFound();

  return (
    <ProgramShell>
      <div style={{ padding: "20px 28px 80px" }}>
        <ProgramSection
          panel={panel}
          crumbs={["Program", "Setup", section.label]}
          eventId={eventId}
        />
      </div>
    </ProgramShell>
  );
}
