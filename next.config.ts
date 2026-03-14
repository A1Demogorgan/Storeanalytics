import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["duckdb", "@mapbox/node-pre-gyp"],
};

export default nextConfig;
