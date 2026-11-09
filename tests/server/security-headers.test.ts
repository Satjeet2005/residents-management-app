import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("SEC1 the response headers of next.config.ts (A-003, D241)", () => {
  it("every path gets the five headers, with exactly these values", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    expect(Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]))).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
  });

  it("the Content-Security-Policy holds only frame-ancestors, and there is no HSTS (the host sends it on HTTPS)", async () => {
    const headers = ((await nextConfig.headers?.()) ?? [])[0].headers;
    expect(headers.find((h) => h.key === "Content-Security-Policy")?.value.split(";").map((d) => d.trim().split(" ")[0])).toEqual(["frame-ancestors"]);
    expect(headers.map((h) => h.key.toLowerCase())).not.toContain("strict-transport-security");
  });

  it("the X-Powered-By header is off", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("the offline rewrite stays", async () => {
    expect(await nextConfig.rewrites?.()).toEqual([{ source: "/offline", destination: "/offline.html" }]);
  });
});
