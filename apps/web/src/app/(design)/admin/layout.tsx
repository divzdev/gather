import { Suspense } from "react";

import { DensityBridge } from "@/components/console/Density";
import { RequireStaff } from "@/components/console/RequireStaff";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <DensityBridge />
      <RequireStaff>{children}</RequireStaff>
    </Suspense>
  );
}
