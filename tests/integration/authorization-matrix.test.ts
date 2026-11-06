import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, inject, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { createGuards, type Need } from "@/server/auth/guard";
import { buildMe } from "@/server/auth/me";
import { mockOtpSender } from "@/server/auth/otp-service";
import { createSession, revokeSession } from "@/server/auth/session-service";
import { T0, addMember, dumpTables, makeFlat, makeUser, newPrisma, useAuthEnv } from "./auth-helpers";

let prisma: PrismaClient;
let clock = T0;
beforeAll(() => {
  prisma = newPrisma();
});
afterAll(async () => {
  await prisma.$disconnect();
  await (globalThis as { townshipDb?: PrismaClient }).townshipDb?.$disconnect();
});
beforeEach(() => {
  useAuthEnv();
  clock = T0;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const guards = createGuards(() => ({ db: prisma, sender: mockOtpSender, now: () => clock }));
const URL_ = "http://localhost/api/thing";

/** Every response from every case passes through here, so Cache-Control is asserted on all of them. */
async function hit(route: (r: Request) => Promise<Response>, init: { method?: string; cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin) headers.origin = init.origin;
  const response = await route(new Request(URL_, { method: init.method ?? "GET", headers }));
  expect(response.headers.get("cache-control"), "Cache-Control").toBe("no-store");
  return response;
}

const route = (need: Need) => guards.withPermission(need, ({ user }) => Response.json({ id: user.id }));

async function signIn(role: "RESIDENT" | "STAFF", permissions: string[] = [], active = true) {
  const user = await makeUser(prisma, { role, permissions, active });
  const session = await createSession(prisma, { id: user.id, role }, T0);
  return { user, cookie: `session=${session.token}`, token: session.token, sessionId: session.sessionId };
}
const denied = (userId: string) => prisma.auditLog.count({ where: { action: "ACCESS_DENIED", actorId: userId } });

describe("D81 no session", () => {
  it("no cookie and a garbage cookie are 401, and write no ACCESS_DENIED row", async () => {
    const before = await prisma.auditLog.count({ where: { action: "ACCESS_DENIED" } });
    for (const cookie of [undefined, "session=garbage", `session=${"B".repeat(43)}`, "session=%00", "x=y; session"]) {
      const response = await hit(route("ANY_USER"), { cookie });
      expect(response.status, String(cookie)).toBe(401);
      expect(await response.json()).toEqual({ error: "UNAUTHENTICATED" });
    }
    expect(await prisma.auditLog.count({ where: { action: "ACCESS_DENIED" } })).toBe(before);
  });
});

describe("D81 staff sessions expire (30 minutes idle, 12 hours overall) on the injected clock", () => {
  it("idle: valid one millisecond before 30 minutes, 401 at 30 minutes", async () => {
    const { cookie } = await signIn("STAFF");
    clock = T0 + 30 * MINUTE - 1;
    expect((await hit(route("STAFF"), { cookie })).status).toBe(200);
    const second = await signIn("STAFF");
    clock = T0 + 30 * MINUTE;
    expect((await hit(route("STAFF"), { cookie: second.cookie })).status).toBe(401);
  });

  it("absolute: a session kept busy is still 401 at 12 hours", async () => {
    const { cookie, sessionId } = await signIn("STAFF");
    await prisma.session.update({ where: { id: sessionId }, data: { lastSeenAt: new Date(T0 + 12 * HOUR - 1) } });
    clock = T0 + 12 * HOUR - 1;
    expect((await hit(route("STAFF"), { cookie })).status).toBe(200);
    clock = T0 + 12 * HOUR;
    const response = await hit(route("STAFF"), { cookie });
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
});

describe("D81 revoked and inactive", () => {
  it("a revoked session is rejected on the very next request", async () => {
    const { cookie, sessionId } = await signIn("STAFF");
    expect((await hit(route("STAFF"), { cookie })).status).toBe(200);
    await revokeSession(prisma, sessionId, T0 + 1);
    expect((await hit(route("STAFF"), { cookie })).status).toBe(401);
  });

  it("a user who is set inactive is rejected on the very next request, and 401, not 403", async () => {
    const { cookie, user } = await signIn("STAFF", ["payments:match"]);
    expect((await hit(route("payments:match"), { cookie })).status).toBe(200);
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    expect((await hit(route("payments:match"), { cookie })).status).toBe(401);
    expect(await denied(user.id)).toBe(0);
  });

  it("a session made for an inactive user never passes", async () => {
    const { cookie } = await signIn("STAFF", ["payments:match"], false);
    expect((await hit(route("ANY_USER"), { cookie })).status).toBe(401);
  });
});

describe("D81 roles and permissions: 401 is no session, 403 is a person who may not", () => {
  const needs: Need[] = ["payments:match", "payments:approve", "reports:view", "complaints:manage", "complaints:duty_manager", "STAFF", "RESIDENT", "ANY_USER"];
  const expected = (who: "resident" | "staff-none" | "staff-match", need: Need): number => {
    if (need === "ANY_USER") return 200;
    if (need === "RESIDENT") return who === "resident" ? 200 : 403;
    if (need === "STAFF") return who === "resident" ? 403 : 200;
    return who === "staff-match" && need === "payments:match" ? 200 : 403;
  };

  it.each(needs)("need %s: resident, staff with no permission, staff with payments:match", async (need) => {
    const resident = await signIn("RESIDENT", ["payments:match"]);
    const none = await signIn("STAFF");
    const match = await signIn("STAFF", ["payments:match"]);
    for (const [who, person] of [["resident", resident], ["staff-none", none], ["staff-match", match]] as const) {
      const status = (await hit(route(need), { cookie: person.cookie })).status;
      expect(status, `${who} on ${need}`).toBe(expected(who, need));
      expect(await denied(person.user.id), `${who} audit rows`).toBe(status === 403 ? 1 : 0);
    }
  });

  it("a resident with every permission string is still 403 on a permission route", async () => {
    const resident = await signIn("RESIDENT", ["payments:match", "payments:approve", "reports:view", "complaints:manage", "complaints:duty_manager"]);
    for (const need of needs.slice(0, 5)) expect((await hit(route(need), { cookie: resident.cookie })).status, need).toBe(403);
  });

  it("a 403 sets no cookie, and the audit rows never contain the token or the cookie", async () => {
    const { cookie, token, user } = await signIn("RESIDENT");
    const response = await hit(route("STAFF"), { cookie });
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await denied(user.id)).toBe(1);
    const table = await dumpTables(prisma, ["audit_log"]);
    expect(table).not.toContain(token);
    expect(table).not.toContain(cookie);
  });
});

describe("D83 CSRF on unsafe methods", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s with a foreign Origin is 403 CSRF_BLOCKED, with and without a session; same Origin or none passes", async (method) => {
    const { cookie } = await signIn("STAFF");
    const guarded = route("STAFF");
    for (const withCookie of [cookie, undefined]) {
      const blocked = await hit(guarded, { method, cookie: withCookie, origin: "https://evil.example" });
      expect(blocked.status).toBe(403);
      expect(await blocked.json()).toEqual({ error: "CSRF_BLOCKED" });
    }
    expect((await hit(guarded, { method, cookie, origin: "http://localhost" })).status).toBe(200);
    expect((await hit(guarded, { method, cookie })).status).toBe(200);
  });

  it("a foreign Origin on GET is not a CSRF case", async () => {
    const { cookie } = await signIn("STAFF");
    expect((await hit(route("STAFF"), { cookie, origin: "https://evil.example" })).status).toBe(200);
  });

  it("a blocked CSRF request writes no ACCESS_DENIED row", async () => {
    const { cookie, user } = await signIn("RESIDENT");
    await hit(route("STAFF"), { method: "POST", cookie, origin: "https://evil.example" });
    expect(await denied(user.id)).toBe(0);
  });
});

describe("me: GET /api/me through the guard", () => {
  const me = guards.withPermission("ANY_USER", async ({ user, deps, now }) => Response.json(await buildMe(deps.db, user, now)));

  it("a resident with one flat", async () => {
    const { cookie, user } = await signIn("RESIDENT");
    const flat = await makeFlat(prisma);
    await addMember(prisma, flat.id, user.id, "2020-01-01");
    const response = await hit(me, { cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: user.id, name: "Test Person", role: "RESIDENT", permissions: [], flats: [flat.code] });
  });

  it("a resident whose membership ended yesterday has no flats", async () => {
    const { cookie, user } = await signIn("RESIDENT");
    const flat = await makeFlat(prisma);
    await addMember(prisma, flat.id, user.id, "2020-01-01", "2026-11-05");
    expect((await (await hit(me, { cookie })).json()).flats).toEqual([]);
  });

  it("staff get their permissions, and two memberships come back sorted", async () => {
    const staff = await signIn("STAFF", ["reports:view", "payments:match"]);
    expect(await (await hit(me, { cookie: staff.cookie })).json()).toMatchObject({ role: "STAFF", permissions: ["payments:match", "reports:view"], flats: [] });
    const { cookie, user } = await signIn("RESIDENT");
    const second = await makeFlat(prisma, `ZZ-${Date.now()}`);
    const first = await makeFlat(prisma, `ZA-${Date.now()}`);
    await addMember(prisma, second.id, user.id, "2020-01-01");
    await addMember(prisma, first.id, user.id, "2020-01-01");
    expect((await (await hit(me, { cookie })).json()).flats).toEqual([first.code, second.code]);
  });

  it("without a session it is 401", async () => {
    expect((await hit(me)).status).toBe(401);
  });
});

describe("D81 the real route files, wired to the real wrappers", () => {
  it("GET /api/me from src/app/api/me/route.ts: 401 without a cookie, 200 with one", async () => {
    vi.stubEnv("DATABASE_URL", inject("testDatabaseUrl"));
    const { GET } = await import("@/app/api/me/route");
    const none = await GET(new Request("http://localhost/api/me"));
    expect(none.status).toBe(401);
    expect(none.headers.get("cache-control")).toBe("no-store");
    const user = await makeUser(prisma, { role: "RESIDENT" });
    const flat = await makeFlat(prisma);
    await addMember(prisma, flat.id, user.id, "2020-01-01");
    const { token } = await createSession(prisma, { id: user.id, role: "RESIDENT" }, Date.now());
    const ok = await GET(new Request("http://localhost/api/me", { headers: { cookie: `session=${token}` } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ id: user.id, flats: [flat.code] });
  });

  it("POST /api/auth/logout-all from its route file: 401 without a session, 403 CSRF from another site", async () => {
    vi.stubEnv("DATABASE_URL", inject("testDatabaseUrl"));
    const { POST } = await import("@/app/api/auth/logout-all/route");
    expect((await POST(new Request("http://localhost/api/auth/logout-all", { method: "POST" }))).status).toBe(401);
    const foreign = await POST(new Request("http://localhost/api/auth/logout-all", { method: "POST", headers: { origin: "https://evil.example" } }));
    expect(foreign.status).toBe(403);
  });

  it("GET /api/health from its route file is public and no-store", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET(new Request("http://localhost/api/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
