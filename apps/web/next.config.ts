import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

/** Where the FastAPI service actually listens. Only the Next server talks to it
 *  directly; the browser always goes through the rewrite below. */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:8051";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The E2E stack runs a second dev server against its own database. Next
  // refuses to start two for one project — it finds the first through its build
  // directory — so the isolated one is given a directory of its own rather than
  // the suite being pointed back at the developer's server and its data.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Standalone output keeps the deploy image small.
  output: "standalone",
  typedRoutes: true,
  // Dev only. Next allows "localhost" out of the box and nothing else, so a
  // browser pointed at 127.0.0.1 — which is what the terminal prints, what the
  // API uses, and what Playwright defaults to — gets 403 on every /_next chunk
  // and renders a page that never hydrates. The two are the same machine here.
  allowedDevOrigins: ["127.0.0.1"],
  // The API is served under the app's own origin. That is not cosmetic: the
  // refresh token is an httpOnly SameSite=Lax cookie, which a browser will not
  // send to a different site — so a split-origin setup silently loses the
  // session after the access token expires. Same origin also means no CORS.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API_ORIGIN}/v1/:path*` }];
  },
};

/** The build-time half of Sentry: it instruments server code and, given a token,
 *  uploads source maps so a stack trace names a line of ours instead of column
 *  8000 of a minified chunk.
 *
 *  Upload is off unless `SENTRY_AUTH_TOKEN` is set, and that is the load-bearing
 *  part: `npm run build` has to succeed on a machine with no credentials, so the
 *  token's absence disables the upload rather than failing the build. */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: process.env.SENTRY_AUTH_TOKEN === undefined },
  // Nothing about a local build should be chatty, but CI is where a failed
  // upload needs to be visible rather than swallowed.
  silent: process.env.CI === undefined,
  telemetry: false,
});
