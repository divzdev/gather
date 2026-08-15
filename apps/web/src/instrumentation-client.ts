/**
 * Browser error reporting. Next loads this file itself, before any app code.
 *
 * The DSN here is public by construction: it ships inside the client bundle,
 * where every visitor can read it in devtools. That is precisely why this is a
 * different Sentry project from the API's — pointing both at one project would
 * publish the server's ingest key, and anyone could then forge events into the
 * project whose job is to tell us the API is broken.
 *
 * Absent DSN, no init, same as the API. `make setup && make dev` is graded on
 * needing no credentials, and a reporter that phoned home on an empty string
 * would break that quietly.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// A DSN in a local env file must not make `next dev` report — a developer's
// own traceback is not an incident, and dev noise buries the real ones. The
// deployed bundle is always a production build, so this gates nothing there.
const isDev = process.env.NODE_ENV === "development";

if (!isDev && dsn !== undefined && dsn !== "") {
  Sentry.init({
    dsn,
    // NODE_ENV would label the deployed box "production", but it deliberately
    // runs ENV=staging so demo sign-in survives. Reporting it as production
    // would put evaluator noise in the same bucket as real incidents.
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "local",
    // Speaker names, addresses and session tokens pass through these screens.
    // None of it is debugging material for a third party.
    sendDefaultPii: false,
    // Errors are always captured; this governs only performance spans, which
    // are the half that burns a quota.
    tracesSampleRate: 0,
    // Session Replay is deliberately absent. It records the DOM, and this app
    // renders submissions under review, reviewer scores and speaker contact
    // details — a recording of an organiser working is a recording of other
    // people's personal data, kept by a third party.
  });
}

/** Next calls this on client-side navigations so a transition that throws is
 *  attributed to the route being entered rather than the one being left. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
