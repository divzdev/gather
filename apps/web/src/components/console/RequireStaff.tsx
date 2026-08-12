"use client";

/** The gate on the console.
 *
 *  Without this, a signed-out visitor reached every admin screen and simply saw
 *  it empty — every request 401'd and the UI rendered zeros. That reads as "this
 *  event has no submissions", which is a worse lie than a login page.
 *
 *  A **reviewer** hit the identical failure one role over. Signed in, so the
 *  signed-out check let them through; not staff, so every organizer request came
 *  back 403 ROLE_REQUIRED; and the console rendered the refusals as zeros. The
 *  screen said "0 In the pipeline" when the truth was "you are not allowed to
 *  see this" — the same lie, told to someone who really is logged in.
 *
 *  So reviewers are sent to the queue that is actually theirs. The API was never
 *  the weak point here (it refused correctly all along); what leaked was the
 *  *appearance* of organizer capability, which is its own kind of wrong.
 *
 *  Client-side because the staff token lives in localStorage; the API is the
 *  real authority and refuses every request regardless. This is about not
 *  showing someone a console they cannot use.
 */

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { VerifyBanner } from "@/components/console/VerifyBanner";
import { authed, clearToken, getEventId, getToken, setEventId } from "@/lib/session";

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
  const {
    data: events,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["my-events"],
    queryFn: () => authed<{ id: string }[]>("/events"),
    enabled: signedIn,
  });

  // Same query key the rail uses, so this is a cache read rather than a second
  // request on every console screen.
  const {
    data: me,
    isError: roleUnknown,
    refetch: retryMe,
  } = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      authed<{
        name: string;
        email: string;
        role: string;
        org_name: string | null;
        email_verified: boolean;
      }>("/auth/me"),
    staleTime: 5 * 60_000,
    enabled: signedIn,
  });
  const isReviewer = me?.role === "reviewer";

  useEffect(() => {
    // Read the token here rather than trusting `signedIn`: on the hydration
    // pass the store still holds the server snapshot (signed out), and acting
    // on it bounced signed-in staff straight back to the login screen.
    if (getToken() === null) {
      const wanted = search === "" ? pathname : `${pathname}?${search}`;
      router.replace(`/login?next=${encodeURIComponent(wanted)}`);
      return;
    }
    // Reviewers own /review and nothing under /admin. Checked before the event
    // lookup because a reviewer with no event would otherwise be routed to the
    // "create your first event" screen, which is the one place in the console
    // they have even less business being.
    if (isReviewer && pathname.startsWith("/admin")) {
      router.replace("/review");
      return;
    }
    if (events === undefined || pathname === "/admin/events/new") return;
    if (events.length === 0) {
      router.replace("/admin/events/new");
      return;
    }
    // Remember one, so a screen that reads the id has something to read.
    if (getEventId() === null) setEventId(events[0]!.id);
  }, [signedIn, events, router, pathname, search, isReviewer]);

  // Nothing rather than a skeleton: the redirect lands within a frame, and a
  // flash of empty console furniture is exactly what this exists to prevent.
  if (!signedIn) return null;

  // The signed-out check is synchronous, but "does this account have an event"
  // is a round trip — and rendering the console during it is what made a new
  // account paint a dashboard wired to nothing, fire a screenful of requests
  // with no event id, and then jump to the setup screen. Waiting is the whole
  // difference between a flicker and a load.
  //
  // The setup screen is exempt because it is where the redirect goes, and an
  // error is not: a failed /events call shows the console and lets each screen
  // report its own problem, rather than leaving a permanently blank page.
  // Under /admin, wait for the role before painting anything. Rendering while
  // `me` is in flight would show a reviewer one frame of the organizer console
  // — which is the precise thing this gate exists to stop, just briefer.
  const underAdmin = pathname.startsWith("/admin");
  // A failed /auth/me is not the same as a slow one, and `me === undefined`
  // cannot tell them apart: it held the whole console at null forever, with no
  // message and nothing to press. The /events remedy above does not transfer —
  // painting the console without a role is how a reviewer gets one frame of the
  // organizer's, and a permanent blank page is only marginally worse than
  // showing someone a console they are not allowed to use. So this is its own
  // branch: say what failed, offer the retry, and leave a way out.
  if (underAdmin && roleUnknown) {
    return <RoleUnavailable onRetry={() => void retryMe()} />;
  }
  if (underAdmin && me === undefined) return null;
  if (underAdmin && isReviewer) return null;

  const settingUp = pathname === "/admin/events/new";
  if (!settingUp && !isError && (isPending || events?.length === 0)) return null;
  return (
    <>
      {me !== undefined && !me.email_verified ? <VerifyBanner email={me.email} /> : null}
      {children}
    </>
  );
}

/** Shown when the console cannot find out who you are.
 *
 *  Deliberately not a spinner and not a blank page. The account is signed in —
 *  the token is valid, or the request would have 401'd and bounced to sign-in —
 *  so this is the server having a bad moment, and the only two useful things
 *  are trying again and getting out.
 */
function RoleUnavailable({ onRetry }: { onRetry: () => void }) {
  const router = useRouter();
  return (
    <main
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100vh",
        padding: 24,
        background: "var(--pp,#F4F6F7)",
      }}
    >
      <div
        style={{
          display: "grid",
          gap: 14,
          justifyItems: "start",
          maxWidth: 460,
          padding: 24,
          borderRadius: 14,
          border: "1px solid var(--ln,#E1E7E9)",
          background: "var(--cd,#FFFFFF)",
          font: "400 14px var(--font-plex-sans), sans-serif",
          color: "var(--i2,#3E4E58)",
          lineHeight: 1.55,
        }}
      >
        <b
          style={{ font: "600 16px var(--font-plex-sans), sans-serif", color: "var(--ik,#16232B)" }}
        >
          Could not load your account
        </b>
        <span>
          You are signed in, but the server did not say which event or role this account has, so the
          console cannot show you the right screens yet.
        </span>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onRetry}
            style={{
              minHeight: 36,
              padding: "0 18px",
              borderRadius: 999,
              border: "none",
              background: "var(--bt,#FF6B6B)",
              color: "var(--bf,#331313)",
              font: "500 13px var(--font-plex-sans), sans-serif",
            }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => {
              clearToken();
              router.replace("/login");
            }}
            style={{
              minHeight: 36,
              padding: "0 18px",
              borderRadius: 999,
              border: "1px solid var(--ls,#C8D2D5)",
              background: "transparent",
              color: "var(--i2,#3E4E58)",
              font: "500 13px var(--font-plex-sans), sans-serif",
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}
