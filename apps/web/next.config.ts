import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Standalone output keeps the deploy image small.
  output: "standalone",
  typedRoutes: true,
};

export default nextConfig;
