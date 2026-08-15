import { Suspense } from "react";

import { AssistantDrawer } from "@/components/console/AssistantDrawer";
import { DensityBridge } from "@/components/console/Density";
import { RequireStaff } from "@/components/console/RequireStaff";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <DensityBridge />
      <RequireStaff>{children}</RequireStaff>
      {/* Here rather than inside the rail, which every console screen mounts for
       *  itself — a per-page mount unmounts on navigation, and the whole point
       *  of the assistant is looking at the agenda while asking about it. In the
       *  layout the drawer and its transcript survive the route change. */}
      <AssistantDrawer />
    </Suspense>
  );
}
