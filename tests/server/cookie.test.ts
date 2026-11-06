import { describe, expect, it } from "vitest";
import { buildSessionCookie, clearSessionCookie, readSessionToken, sessionCookieName } from "@/server/auth/cookie";

const TOKEN = "A".repeat(43);
const NOW = 1_800_000_000_000;
const PROD = { NODE_ENV: "production" };
const DEV = { NODE_ENV: "development" };

const attrs = (cookie: string) => cookie.split("; ").slice(1);

describe("V4 cookie in production", () => {
  const cookie = buildSessionCookie(TOKEN, NOW + 12 * 3600 * 1000, NOW, PROD);

  it("is named __Host-session and holds the token", () => {
    expect(sessionCookieName(PROD)).toBe("__Host-session");
    expect(cookie.startsWith(`__Host-session=${TOKEN};`)).toBe(true);
  });

  it("is Secure, HttpOnly, SameSite=Lax, Path=/ and has no Domain", () => {
    expect(attrs(cookie)).toEqual(expect.arrayContaining(["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]));
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("has Max-Age equal to the seconds until the absolute end", () => {
    expect(cookie).toContain("Max-Age=43200");
    expect(buildSessionCookie(TOKEN, NOW + 1500, NOW, PROD)).toContain("Max-Age=2;");
    expect(buildSessionCookie(TOKEN, NOW + 30 * 86400 * 1000, NOW, PROD)).toContain(`Max-Age=${30 * 86400}`);
  });

  it("never has a negative Max-Age", () => {
    expect(buildSessionCookie(TOKEN, NOW - 5000, NOW, PROD)).toContain("Max-Age=0");
  });

  it("the clearing cookie keeps the name and attributes, with an empty value and Max-Age=0", () => {
    const clear = clearSessionCookie(PROD);
    expect(clear.startsWith("__Host-session=;")).toBe(true);
    expect(attrs(clear)).toEqual(expect.arrayContaining(["Secure", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"]));
    expect(clear).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(clear).not.toMatch(/Domain=/i);
  });
});

describe("V4 cookie outside production", () => {
  const cookie = buildSessionCookie(TOKEN, NOW + 1800 * 1000, NOW, DEV);

  it("is named session, without the __Host- prefix, and is not Secure", () => {
    expect(sessionCookieName(DEV)).toBe("session");
    expect(sessionCookieName({})).toBe("session");
    expect(cookie.startsWith(`session=${TOKEN};`)).toBe(true);
    expect(attrs(cookie)).not.toContain("Secure");
  });

  it("is still HttpOnly, SameSite=Lax and Path=/, with no Domain, and has Max-Age", () => {
    expect(attrs(cookie)).toEqual(expect.arrayContaining(["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=1800"]));
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("the clearing cookie is not Secure and has Max-Age=0", () => {
    const clear = clearSessionCookie(DEV);
    expect(clear.startsWith("session=;")).toBe(true);
    expect(attrs(clear)).not.toContain("Secure");
    expect(attrs(clear)).toEqual(expect.arrayContaining(["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"]));
  });
});

describe("V4 readSessionToken", () => {
  it.each([
    [`session=${TOKEN}`, DEV, TOKEN],
    [`a=b; session=${TOKEN}; c=d`, DEV, TOKEN],
    [`  session = ${TOKEN} `, DEV, TOKEN],
    [`__Host-session=${TOKEN}`, PROD, TOKEN],
  ])("reads %s", (header, env, expected) => {
    expect(readSessionToken(header, env)).toBe(expected);
  });

  it.each([
    [null, DEV],
    ["", DEV],
    ["other=1", DEV],
    [`session=${TOKEN}`, PROD],
    [`__Host-session=${TOKEN}`, DEV],
    ["session=short", DEV],
    [`session=${"A".repeat(44)}`, DEV],
    [`session=${"A".repeat(42)}!`, DEV],
    ["session", DEV],
  ])("gives null for %j", (header, env) => {
    expect(readSessionToken(header, env)).toBeNull();
  });
});
