"use client";

/** The gate on the console.
 *
 *  Without this, a signed-out visitor reached every admin screen and simply saw
 *  it empty — every request 401'd and the UI rendered zeros. That reads as "this
 *  event has no submissions", which is a worse lie than a login page.
 *
 *  Client-side because the staff token lives in localStorage; the API is the
 *  real authority and refuses every request regardless. This is about not
 *  showing someone a console they cannot use.
 */

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { authed, getEventId, getToken, setEventId } from "@/lib/session";

/** The token is read through an external store rather than an effect, matching
 *  the rail: the server renders signed-out and the client corrects on hydration
 *  in one pass, with no setState-in-effect. */
function subscribe(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

export function RequireStaff({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  const signedIn = useSyncExternalStore(
    subscribe,
    () => getToken() !== null,
    () => false,
  );

  // A brand-new owner has no event, because registering no longer invents one.
  // Every console screen reads an event id, so without this they would land on
  // a console wired to nothing.
  const { data: events } = useQuery({
    queryKey: ["my-events"],
    queryFn: () => authed<{ id: string }[]>("/events"),
    enabled: signedIn,
  });

  useEffect(() => {
    // Read the token here rather than trusting `signedIn`: on the hydration
    // pass the store still holds the server snapshot (signed out), and acting
    // on it bounced signed-in staff straight back to the login screen.
    if (getToken() === null) {
      const wanted = search === "" ? pathname : `${pathname}?${search}`;
      router.replace(`/login?next=${encodeURIComponent(wanted)}`);
      return;
    }
    if (events === undefined || pathname === "/admin/welcome") return;
    if (events.length === 0) {
      router.replace("/admin/welcome");
      return;
    }
    // Remember one, so a screen that reads the id has something to read.
    if (getEventId() === null) setEventId(events[0]!.id);
  }, [signedIn, events, router, pathname, search]);

  // Nothing rather than a skeleton: the redirect lands within a frame, and a
  // flash of empty console furniture is exactly what this exists to prevent.
  if (!signedIn) return null;
  return <>{children}</>;
}
