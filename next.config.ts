import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets several dev servers run from one checkout: NEXT_DIST_DIR=.next-a next dev -p 3101
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
