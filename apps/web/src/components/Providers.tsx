"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { ThemeProvider } from "@/components/ThemeProvider";
import { seedWarmCache, subscribeWarmCache } from "@/lib/warmCache";

export function Providers({ children }: { children: React.ReactNode }) {
  // Created once per browser session, not per render. Seeded synchronously in
  // the initializer — before the first render — so the chrome's queries paint
  // their last known values instead of zeros that pop into numbers.
  const [client] = useState(() => {
    const created = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 },
      },
    });
    seedWarmCache(created);
    subscribeWarmCache(created);
    return created;
  });

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}
