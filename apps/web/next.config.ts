import type { NextConfig } from "next";

/** Where the FastAPI service actually listens. Only the Next server talks to it
 *  directly; the browser always goes through the rewrite below. */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:8051";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Standalone output keeps the deploy image small.
  output: "standalone",
  typedRoutes: true,
  // The API is served under the app's own origin. That is not cosmetic: the
  // refresh token is an httpOnly SameSite=Lax cookie, which a browser will not
  // send to a different site — so a split-origin setup silently loses the
  // session after the access token expires. Same origin also means no CORS.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API_ORIGIN}/v1/:path*` }];
  },
};

export default nextConfig;
