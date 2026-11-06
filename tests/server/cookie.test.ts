import { describe, expect, it } from "vitest";
import {
  PLAIN_COOKIE_NAME,
  SECURE_COOKIE_NAME,
  appendClearedCookies,
  buildSessionCookie,
  clearCookie,
  clearSessionCookies,
  hasSessionCookie,
  isHttps,
  isHttpsFromHeaders,
  isHttpsRequest,
  readSessionToken,
  sessionCookieName,
} from "@/server/auth/cookie";

const TOKEN = "A".repeat(43);
const NOW = 1_800_000_000_000;
const attrs = (cookie: string) => cookie.split("; ").slice(1);
const request = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe("D94 isHttps: the scheme of the request decides, not NODE_ENV", () => {
  it.each<[string, string, Record<string, string>, boolean]>([
    ["an https URL", "https://app.example.com/x", {}, true],
    ["an https URL, uppercase scheme in the URL", "HTTPS://app.example.com/x", {}, true],
    ["an http URL with no forwarded header", "http://localhost:3000/x", {}, false],
    ["an http URL and x-forwarded-proto https", "http://app.example.com/x", { "x-forwarded-proto": "https" }, true],
    ["an http URL and x-forwarded-proto http", "http://app.example.com/x", { "x-forwarded-proto": "http" }, false],
    ["a list that starts with https", "http://app.example.com/x", { "x-forwarded-proto": "https, http" }, true],
    ["a list that starts with http", "http://app.example.com/x", { "x-forwarded-proto": "http, https" }, false],
    ["uppercase HTTPS in the header", "http://app.example.com/x", { "x-forwarded-proto": "HTTPS" }, true],
    ["spaces around the header value", "http://app.example.com/x", { "x-forwarded-proto": "  https  " }, true],
    ["an empty header", "http://app.example.com/x", { "x-forwarded-proto": "" }, false],
    ["a header that only contains https as text", "http://app.example.com/x", { "x-forwarded-proto": "nothttps" }, false],
    ["a header with another scheme", "http://app.example.com/x", { "x-forwarded-proto": "wss" }, false],
    ["an https URL with x-forwarded-proto http (the URL wins)", "https://app.example.com/x", { "x-forwarded-proto": "http" }, true],
    ["localhost with x-forwarded-proto https (a client can claim it)", "http://localhost:3000/x", { "x-forwarded-proto": "https" }, true],
  ])("%s -> %s", (_label, url, headers, expected) => {
    expect(isHttps(request(url, headers))).toBe(expected);
  });

  it("isHttpsRequest with no URL and no header is false; a bad URL is false", () => {
    expect(isHttpsRequest({})).toBe(false);
    expect(isHttpsRequest({ url: "not a url" })).toBe(false);
    expect(isHttpsRequest({ url: null, forwardedProto: null })).toBe(false);
  });

  it.each<[string, Record<string, string>, boolean]>([
    ["no headers", {}, false],
    ["x-forwarded-proto https", { "x-forwarded-proto": "https" }, true],
    ["an https Referer", { referer: "https://app.example.com/page" }, true],
    ["an https Origin", { origin: "https://app.example.com" }, true],
    ["an http Referer", { referer: "http://localhost:3000/page" }, false],
  ])("isHttpsFromHeaders (a page or action without a URL): %s -> %s", (_label, headers, expected) => {
    expect(isHttpsFromHeaders(new Headers(headers))).toBe(expected);
  });
});

describe("D94 the cookie over https", () => {
  const cookie = buildSessionCookie(TOKEN, NOW + 12 * 3600 * 1000, NOW, true);

  it("is __Host-session, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain", () => {
    expect(sessionCookieName(true)).toBe("__Host-session");
    expect(cookie.startsWith(`__Host-session=${TOKEN};`)).toBe(true);
    expect(attrs(cookie)).toEqual(expect.arrayContaining(["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]));
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("Max-Age is the time left to the absolute end, never negative", () => {
    expect(cookie).toContain("Max-Age=43200");
    expect(buildSessionCookie(TOKEN, NOW + 1500, NOW, true)).toContain("Max-Age=2;");
    expect(buildSessionCookie(TOKEN, NOW - 5000, NOW, true)).toContain("Max-Age=0");
  });
});

describe("D94 the cookie over plain http", () => {
  const cookie = buildSessionCookie(TOKEN, NOW + 1800 * 1000, NOW, false);

  it("is session, not Secure, but still HttpOnly, SameSite=Lax, Path=/, no Domain", () => {
    expect(sessionCookieName(false)).toBe("session");
    expect(cookie.startsWith(`session=${TOKEN};`)).toBe(true);
    expect(attrs(cookie)).not.toContain("Secure");
    expect(attrs(cookie)).toEqual(expect.arrayContaining(["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=1800"]));
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("does not use the __Host- prefix, which a browser would refuse over http", () => {
    expect(cookie).not.toContain("__Host-");
  });
});

describe("D94 clearing removes both names", () => {
  it("clearCookie keeps each name's own attributes, with an empty value and Max-Age=0", () => {
    const plain = clearCookie(false);
    const secure = clearCookie(true);
    expect(plain.startsWith("session=;")).toBe(true);
    expect(attrs(plain)).not.toContain("Secure");
    expect(secure.startsWith("__Host-session=;")).toBe(true);
    expect(attrs(secure)).toEqual(expect.arrayContaining(["Secure", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"]));
    for (const value of [plain, secure]) {
      expect(value).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
      expect(value).not.toMatch(/Domain=/i);
    }
  });

  it("clearSessionCookies gives both, and appendClearedCookies writes both as separate Set-Cookie lines", () => {
    expect(clearSessionCookies()).toHaveLength(2);
    const lines = appendClearedCookies(new Headers()).getSetCookie();
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.split("=")[0]).sort()).toEqual([SECURE_COOKIE_NAME, PLAIN_COOKIE_NAME].sort());
  });
});

describe("D94 reading uses the name for the request's scheme", () => {
  it.each<[string, string, boolean, string | null]>([
    ["plain name over http", `session=${TOKEN}`, false, TOKEN],
    ["plain name among others", `a=b; session=${TOKEN}; c=d`, false, TOKEN],
    ["spaces around the name and value", `  session = ${TOKEN} `, false, TOKEN],
    ["secure name over https", `__Host-session=${TOKEN}`, true, TOKEN],
    ["plain name over https is not read (it could be planted by a sibling site)", `session=${TOKEN}`, true, null],
    ["secure name over http is not read", `__Host-session=${TOKEN}`, false, null],
    ["both names over https read the secure one", `session=${"B".repeat(43)}; __Host-session=${TOKEN}`, true, TOKEN],
    ["both names over http read the plain one", `__Host-session=${"B".repeat(43)}; session=${TOKEN}`, false, TOKEN],
    ["a token that is too short", "session=short", false, null],
    ["a token that is too long", `session=${"A".repeat(44)}`, false, null],
    ["a token with a bad character", `session=${"A".repeat(42)}!`, false, null],
    ["no equals sign", "session", false, null],
    ["another cookie only", "other=1", false, null],
    ["empty header", "", false, null],
  ])("%s", (_label, header, secure, expected) => {
    expect(readSessionToken(header, secure)).toBe(expected);
  });

  it("no Cookie header gives null", () => {
    expect(readSessionToken(null, false)).toBeNull();
    expect(readSessionToken(null, true)).toBeNull();
  });

  it("hasSessionCookie sees either name, whatever the value, and nothing else", () => {
    expect(hasSessionCookie("session=garbage")).toBe(true);
    expect(hasSessionCookie("__Host-session=")).toBe(true);
    expect(hasSessionCookie("a=b; session=x")).toBe(true);
    expect(hasSessionCookie("other=1")).toBe(false);
    expect(hasSessionCookie("session")).toBe(false);
    expect(hasSessionCookie(null)).toBe(false);
  });
});
