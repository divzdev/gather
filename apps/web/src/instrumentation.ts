/**
 * Server-side error reporting for the Next process.
 *
 * Distinct from the API's: this catches what breaks inside Server Components,
 * route handlers and the rewrite proxy — the tier that renders the console, not
 * the tier that owns the business rules. It reports into the web project, since
 * that is the codebase it is running.
 *
 * Absent DSN, no init. The stack has to run credential-free.
 */
import * as Sentry from "@sentry/nextjs";

export async function register(): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn === undefined || dsn === "") return;

  // Both runtimes init the same way; the guard is here because `register` also
  // runs during the build, where there is no runtime to report from.
  if (process.env.NEXT_RUNTIME !== "nodejs" && process.env.NEXT_RUNTIME !== "edge") return;

  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "local",
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
}

/** Next hands every server-side render error here. Without this export a failed
 *  Server Component is logged to the container and reported nowhere, which is
 *  the same invisible-failure shape as the worker's swallowed sweep. */
export const onRequestError = Sentry.captureRequestError;
