import { describe, expect, it } from "vitest";
import { csrfBlocked, isCrossSiteRequest, isUnsafeMethod } from "@/server/auth/csrf";

const URL_ = "http://localhost:3000/api/auth/logout";
const check = (headers: Record<string, string>, url = URL_) => isCrossSiteRequest(new Headers(headers), url);

describe("D83 isCrossSiteRequest", () => {
  it.each<[string, Record<string, string>, boolean]>([
    ["no Origin (curl, a script)", {}, false],
    ["same origin, Host header", { origin: "http://localhost:3000", host: "localhost:3000" }, false],
    ["same origin, Host taken from the URL", { origin: "http://localhost:3000" }, false],
    ["a different host", { origin: "https://evil.example", host: "localhost:3000" }, true],
    ["a look-alike host that ends with the real one", { origin: "http://notlocalhost:3000", host: "localhost:3000" }, true],
    ["a look-alike host that starts with the real one", { origin: "http://localhost.evil.com:3000", host: "localhost:3000" }, true],
    ["a subdomain of the real host", { origin: "https://evil.example.com", host: "example.com" }, true],
    ["userinfo that spells the real host", { origin: "http://localhost:3000@evil.example", host: "localhost:3000" }, true],
    ["same host, other port", { origin: "http://localhost:3001", host: "localhost:3000" }, true],
    ["same host, port missing from Origin", { origin: "http://localhost", host: "localhost:3000" }, true],
    ["uppercase Host and Origin", { origin: "HTTPS://Example.COM", host: "EXAMPLE.com" }, false],
    ["https Origin behind a proxy that sends http to the app", { origin: "https://app.example.com", host: "app.example.com" }, false],
    ["http Origin, https site (same Host)", { origin: "http://app.example.com", host: "app.example.com" }, false],
    ["default port 443 written out", { origin: "https://app.example.com:443", host: "app.example.com" }, false],
    ["default port 443 written out in Host", { origin: "https://app.example.com", host: "app.example.com:443" }, false],
    ["the literal Origin null", { origin: "null", host: "localhost:3000" }, true],
    ["an Origin that is not a URL", { origin: "not a url", host: "localhost:3000" }, true],
    ["an empty Origin", { origin: "", host: "localhost:3000" }, true],
    ["a file Origin", { origin: "file://", host: "localhost:3000" }, true],
    ["Sec-Fetch-Site cross-site, no Origin", { "sec-fetch-site": "cross-site" }, true],
    ["Sec-Fetch-Site cross-site, same Origin", { "sec-fetch-site": "cross-site", origin: "http://localhost:3000", host: "localhost:3000" }, true],
    ["Sec-Fetch-Site Cross-Site in capitals", { "sec-fetch-site": "Cross-Site" }, true],
    ["Sec-Fetch-Site same-origin", { "sec-fetch-site": "same-origin", origin: "http://localhost:3000", host: "localhost:3000" }, false],
    ["Sec-Fetch-Site none (typed address)", { "sec-fetch-site": "none" }, false],
    ["Sec-Fetch-Site same-site, same host", { "sec-fetch-site": "same-site", origin: "http://localhost:3000", host: "localhost:3000" }, false],
    ["Sec-Fetch-Site same-site, other host", { "sec-fetch-site": "same-site", origin: "https://other.example.com", host: "app.example.com" }, true],
  ])("%s -> blocked: %s", (_label, headers, blocked) => {
    expect(check(headers)).toBe(blocked);
  });
});

describe("D83 csrfBlocked applies to unsafe methods only", () => {
  const build = (method: string, origin?: string) => new Request(URL_, { method, headers: origin ? { origin } : {} });

  it.each(["POST", "PUT", "PATCH", "DELETE", "post"])("%s with a foreign Origin is blocked", (method) => {
    expect(csrfBlocked(build(method, "https://evil.example"))).toBe(true);
  });

  it.each(["GET", "HEAD", "OPTIONS"])("%s with a foreign Origin is not checked", (method) => {
    expect(csrfBlocked(build(method, "https://evil.example"))).toBe(false);
  });

  it("an unsafe request from the same origin or with no Origin passes", () => {
    expect(csrfBlocked(build("POST", "http://localhost:3000"))).toBe(false);
    expect(csrfBlocked(build("POST"))).toBe(false);
  });

  it("isUnsafeMethod knows the four methods", () => {
    expect(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].filter(isUnsafeMethod)).toEqual(["POST", "PUT", "PATCH", "DELETE"]);
  });
});
