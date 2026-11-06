import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { createGuards } from "@/server/auth/guard";
import { handleLogout, handleOtpRequest, handleOtpVerify, type AuthRouteDeps } from "@/server/auth/handlers";
import { mockOtpSender } from "@/server/auth/otp-service";
import { T0, freshIp, freshPhone, makeUser, newPrisma, useAuthEnv } from "./auth-helpers";

let prisma: PrismaClient;
beforeAll(() => {
  prisma = newPrisma();
});
afterAll(() => prisma.$disconnect());
beforeEach(() => {
  useAuthEnv("true");
  // NODE_ENV is production on purpose: it must make no difference to the cookie (D94).
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => vi.unstubAllEnvs());

const deps = (): AuthRouteDeps => ({ db: prisma, sender: mockOtpSender, now: () => T0 });
const guards = createGuards(() => deps());
const me = guards.withPermission("ANY_USER", ({ user }) => Response.json({ id: user.id }));

type Where = { base: string; headers?: Record<string, string> };
const post = (where: Where, path: string, body?: unknown, cookie?: string) =>
  new Request(`${where.base}/api/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-vercel-forwarded-for": freshIp(), ...where.headers, ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const get = (where: Where, cookie: string) => new Request(`${where.base}/api/me`, { headers: { cookie, ...where.headers } });

/** Request a code and log in over the given scheme. Returns the Set-Cookie line. */
async function login(where: Where) {
  const user = await makeUser(prisma, { phone: freshPhone(5) });
  const asked = await (await handleOtpRequest(deps(), post(where, "otp/request", { phone: user.phone }))).json();
  const verified = await handleOtpVerify(deps(), post(where, "otp/verify", { phone: user.phone, code: asked.demoCode }));
  expect(verified.status).toBe(200);
  const lines = verified.headers.getSetCookie();
  expect(lines).toHaveLength(1);
  return { line: lines[0], cookie: lines[0].split(";")[0], user };
}

const HTTPS: Where = { base: "https://app.example.com" };
const HTTP: Where = { base: "http://localhost:3000" };
const PROXIED: Where = { base: "http://app.example.com", headers: { "x-forwarded-proto": "https" } };

describe("D94 login and use over https, http and a TLS proxy", () => {
  it("over https: the cookie is __Host-session and Secure, and it works", async () => {
    const { line, cookie } = await login(HTTPS);
    expect(line).toMatch(/^__Host-session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
    expect((await me(get(HTTPS, cookie))).status).toBe(200);
  });

  it("over http (NODE_ENV production): the cookie is session, not Secure, and it works", async () => {
    const { line, cookie } = await login(HTTP);
    expect(line).toMatch(/^session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
    expect(line).not.toContain("Secure");
    expect((await me(get(HTTP, cookie))).status).toBe(200);
  });

  it("behind a proxy that says https: the secure cookie, and it works on the same kind of request", async () => {
    const { line, cookie } = await login(PROXIED);
    expect(line.startsWith("__Host-session=")).toBe(true);
    expect(line).toContain("Secure");
    expect((await me(get(PROXIED, cookie))).status).toBe(200);
  });

  it("a cookie is read only under its own scheme: the plain cookie over https is a 401 and both names are cleared", async () => {
    const { cookie } = await login(HTTP);
    const response = await me(get(HTTPS, cookie));
    expect(response.status).toBe(401);
    const cleared = response.headers.getSetCookie();
    expect(cleared).toHaveLength(2);
    expect(cleared.every((line) => line.includes("Max-Age=0"))).toBe(true);
  });

  it("the secure cookie over http is a 401", async () => {
    const { cookie } = await login(HTTPS);
    expect((await me(get(HTTP, cookie))).status).toBe(401);
  });
});

describe("D94 logout clears both names", () => {
  it.each([["https", HTTPS], ["http", HTTP]] as const)("over %s: the session ends and both cookies are cleared", async (_label, where) => {
    const { cookie } = await login(where);
    const out = await handleLogout(deps(), post(where, "logout", undefined, cookie));
    expect(out.status).toBe(204);
    const lines = out.headers.getSetCookie();
    expect(lines.map((l) => l.split("=")[0]).sort()).toEqual(["__Host-session", "session"]);
    expect(lines.every((l) => l.includes("Max-Age=0") && l.includes("HttpOnly") && l.includes("SameSite=Lax"))).toBe(true);
    expect((await me(get(where, cookie))).status).toBe(401);
  });

  it("logout with no session still clears both", async () => {
    const out = await handleLogout(deps(), post(HTTP, "logout"));
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie()).toHaveLength(2);
  });
});
