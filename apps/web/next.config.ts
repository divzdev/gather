import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Standalone output keeps the deploy image small; see docs/ARCHITECTURE.md.
  output: "standalone",
  typedRoutes: true,
};

export default nextConfig;
