import { Suspense } from "react";

import { RequireStaff } from "@/components/console/RequireStaff";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <RequireStaff>{children}</RequireStaff>
    </Suspense>
  );
}
