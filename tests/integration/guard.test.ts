import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { createGuards, type Need } from "@/server/auth/guard";
import { mockOtpSender } from "@/server/auth/otp-service";
import { createSession } from "@/server/auth/session-service";
import { T0, makeUser, newPrisma, useAuthEnv } from "./auth-helpers";

let prisma: PrismaClient;
let clock = T0;
beforeAll(() => {
  prisma = newPrisma();
});
afterAll(() => prisma.$disconnect());
beforeEach(() => {
  useAuthEnv();
  clock = T0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const guards = createGuards(() => ({ db: prisma, sender: mockOtpSender, now: () => clock }));
const URL_ = "http://localhost/api/thing";

const request = (method = "GET", headers: Record<string, string> = {}) => new Request(URL_, { method, headers });

async function signIn(options: { role?: "RESIDENT" | "STAFF"; permissions?: string[] } = {}) {
  const role = options.role ?? "STAFF";
  const user = await makeUser(prisma, { role, permissions: options.permissions });
  const { token } = await createSession(prisma, { id: user.id, role }, T0);
  return { user, cookie: `session=${token}`, token };
}

const echo = (need: Need) => guards.withPermission(need, ({ user }) => Response.json({ id: user.id }));
const deniedRows = (userId: string) => prisma.auditLog.findMany({ where: { action: "ACCESS_DENIED", actorId: userId } });

describe("D81 withPermission", () => {
  it("D81 no cookie is 401 UNAUTHENTICATED, with no-store, no Set-Cookie and no audit row", async () => {
    const before = await prisma.auditLog.count({ where: { action: "ACCESS_DENIED" } });
    const response = await echo("ANY_USER")(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHENTICATED" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "ACCESS_DENIED" } })).toBe(before);
  });

  it.each([`session=${"A".repeat(43)}`, "session=garbage", "session="])("D81 a stale or garbled session cookie (%s) is 401 and is cleared", async (cookie) => {
    const response = await echo("ANY_USER")(request("GET", { cookie }));
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toMatch(/^session=; .*Max-Age=0/);
  });

  it("D81 a cookie of another name is not a session cookie and is not cleared", async () => {
    const response = await echo("ANY_USER")(request("GET", { cookie: "other=1" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("D81 a signed-in person with the right need reaches the handler, with the user, session, time and request", async () => {
    const { user, cookie } = await signIn({ permissions: ["payments:match"] });
    const seen: unknown[] = [];
    const route = guards.withPermission("payments:match", (ctx) => {
      seen.push(ctx.user.id, ctx.now, typeof ctx.sessionId, ctx.request.url);
      return Response.json({ ok: true });
    });
    const response = await route(request("GET", { cookie }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(seen).toEqual([user.id, T0, "string", URL_]);
  });

  it("D81 a resident on a permission route is 403 FORBIDDEN and audited with the need, method and path", async () => {
    const { user, cookie } = await signIn({ role: "RESIDENT" });
    const response = await echo("payments:match")(request("GET", { cookie, "x-vercel-forwarded-for": "203.0.113.7" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "FORBIDDEN" });
    expect(response.headers.get("set-cookie")).toBeNull();
    const rows = await deniedRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].entityId).toBe(user.id);
    expect(rows[0].detail).toMatchObject({ need: "payments:match", method: "GET", path: "/api/thing" });
    expect(JSON.stringify(rows)).not.toContain("203.0.113.7");
  });

  it("D81 the audited path leaves out the query string", async () => {
    const { user, cookie } = await signIn({ role: "RESIDENT" });
    await echo("STAFF")(new Request(`${URL_}?token=secret-value`, { headers: { cookie } }));
    expect(JSON.stringify(await deniedRows(user.id))).not.toContain("secret-value");
  });

  it("D81 staff without the permission are 403; with it, 200", async () => {
    const without = await signIn({ permissions: ["reports:view"] });
    expect((await echo("payments:approve")(request("GET", { cookie: without.cookie }))).status).toBe(403);
    expect(await deniedRows(without.user.id)).toHaveLength(1);
    const withIt = await signIn({ permissions: ["payments:approve"] });
    expect((await echo("payments:approve")(request("GET", { cookie: withIt.cookie }))).status).toBe(200);
    expect(await deniedRows(withIt.user.id)).toHaveLength(0);
  });

  it("D81 a failed audit write still gives 403, not 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cookie } = await signIn({ role: "RESIDENT" });
    const broken = new Proxy(prisma, {
      get: (target, key) => (key === "auditLog" ? { create: () => Promise.reject(new Error("down")) } : Reflect.get(target, key)),
    });
    const route = createGuards(() => ({ db: broken, sender: mockOtpSender, now: () => clock })).withPermission("STAFF", () => Response.json({}));
    expect((await route(request("GET", { cookie }))).status).toBe(403);
  });

  it("D81 an unexpected error is a 500 with no detail and no-store", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cookie } = await signIn();
    const route = guards.withPermission("ANY_USER", () => {
      throw new Error("secret detail");
    });
    const response = await route(request("GET", { cookie }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "SERVER_ERROR" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("D83 the CSRF check comes before the session: a foreign POST with no cookie is 403 CSRF_BLOCKED, not 401", async () => {
    const response = await echo("ANY_USER")(request("POST", { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "CSRF_BLOCKED" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("D83 a foreign POST with a valid session never reaches the handler", async () => {
    const { cookie } = await signIn();
    let ran = false;
    const route = guards.withPermission("ANY_USER", () => {
      ran = true;
      return Response.json({});
    });
    expect((await route(request("POST", { cookie, origin: "https://evil.example" }))).status).toBe(403);
    expect(ran).toBe(false);
    expect((await route(request("POST", { cookie, origin: "http://localhost" }))).status).toBe(200);
    expect((await route(request("POST", { cookie }))).status).toBe(200);
  });
});

describe("D81 publicRoute", () => {
  const open = guards.publicRoute(({ now }) => Response.json({ now }));

  it("D81 runs the handler with no session, adds no-store and sets no cookie", async () => {
    const response = await open(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ now: T0 });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("D83 blocks a foreign unsafe request, and lets a same-origin or origin-less one pass", async () => {
    expect((await open(request("POST", { origin: "https://evil.example" }))).status).toBe(403);
    expect((await open(request("POST", { origin: "http://localhost" }))).status).toBe(200);
    expect((await open(request("POST"))).status).toBe(200);
    expect((await open(request("GET", { origin: "https://evil.example" }))).status).toBe(200);
  });

  it("D81 does not look at the session at all", async () => {
    const response = await open(request("GET", { cookie: `session=${"A".repeat(43)}` }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("D81 an unexpected error is a 500 with no detail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = guards.publicRoute(() => {
      throw new Error("secret detail");
    });
    const response = await bad(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
