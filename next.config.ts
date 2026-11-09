import type { NextConfig } from "next";

/**
 * The headers every response carries (A-003, D241). Clickjacking is refused twice (X-Frame-Options and the CSP directive frame-ancestors, which is the only CSP
 * directive: a script or style policy needs a nonce set-up for the framework's inline scripts and is NOT added, see docs/security.md). There is no HSTS here:
 * the hosting platform sends it on HTTPS.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
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
