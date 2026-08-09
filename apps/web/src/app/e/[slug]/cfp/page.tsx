import { notFound } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";
import { CfpWizard } from "./CfpWizard";

export const dynamic = "force-dynamic";

/** Server-rendered: the public form is what strangers judge, so it should not
 *  wait on client JavaScript to show the event, deadline and questions. */
export default async function CfpPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const response = await fetch(`${API_BASE_URL}/public/events/${slug}/cfp-form`, {
    cache: "no-store",
  });
  if (!response.ok) notFound();

  return <CfpWizard form={await response.json()} />;
}
