import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The offline page is a self-contained file (public/offline.html) that the service worker keeps; /offline is its friendly address.
  async rewrites() {
    return [{ source: "/offline", destination: "/offline.html" }];
  },
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
