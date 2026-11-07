import { PrismaPg } from "@prisma/adapter-pg";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { inject } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";
import { onRequestError } from "@/instrumentation";
import { createGuards } from "@/server/auth/guard";
import { mockOtpSender } from "@/server/auth/otp-service";
import { createSession } from "@/server/auth/session-service";
import { dbPoolOptions } from "@/server/db-options";
import { createAppRole, type TestAppRole } from "./app-role-helpers";
import { T0, makeUser, newPrisma } from "./auth-helpers";
import { connect } from "./db";

/**
 * D135: unexpected errors are stored with a reference. The guard and the hook write through the REAL app role (insert only); the rows are read back as
 * the owner. Every failing request below has a different route, so the per-fingerprint flood limit does not hide any of them.
 */

const SECRETS = {
  DATABASE_URL: "postgresql://township_app:Rec0rding-Pw-77@db.example.test/neondb",
  OTP_PEPPER: "recording-pepper-0123456789abcdef-xyz",
  PAYMENT_WEBHOOK_SECRET: "recording-webhook-0123456789abcdef-xyz",
  SESSION_SECRET: "recording-session-secret",
  LLM_API_KEY: "recording-llm-key",
  OPS_TEST_TOKEN: "recording-ops-token-0123456789abcdef-xyz",
};

let owner: Client;
let role: TestAppRole;
let prisma: PrismaClient;
let ownerPrisma: PrismaClient;

beforeAll(async () => {
  owner = await connect();
  ownerPrisma = newPrisma();
  role = await createAppRole(owner);
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: role.url, ...dbPoolOptions({ DB_POOL_MAX: "2" }) }) });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await prisma?.$disconnect();
  await ownerPrisma?.$disconnect();
  if (role) await role.drop();
  await owner?.end();
});
afterEach(() => {
  vi.unstubAllEnvs();
  (globalThis as { townshipDb?: PrismaClient }).townshipDb = undefined;
});

const guards = createGuards(() => ({ db: prisma, sender: mockOtpSender, now: () => T0 }));
const rowFor = async (ref: string) => (await owner.query("SELECT * FROM error_events WHERE ref = $1", [ref])).rows[0];

describe("D135 the guard's 500", () => {
  it("D135 a public route that throws answers { error, ref } and stores a row with that reference", async () => {
    const route = guards.publicRoute(() => {
      throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    });
    const response = await route(new Request("http://localhost/api/boom-public", { method: "POST", headers: { "x-vercel-id": "bom1::abcde-123" } }));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string; ref: string };
    expect(body).toEqual({ error: "SERVER_ERROR", ref: expect.stringMatching(/^E-[0-9A-HJKMNP-TV-Z]{6}$/) });
    expect(await rowFor(body.ref)).toMatchObject({
      level: "ERROR", source: "ROUTE", route: "/api/boom-public", method: "POST", status: 500, error_name: "Error", error_code: "42P01", message: "relation does not exist", user_id: null,
    });
    expect((await rowFor(body.ref)).request_id).toBe("bom1::abcde-123");
  });

  it("D135 a guarded route that throws also records who: the user id and the role, never a name or a phone", async () => {
    const user = await makeUser(ownerPrisma, { role: "STAFF", permissions: [] });
    const { token } = await createSession(ownerPrisma, { id: user.id, role: "STAFF" }, T0);
    const route = guards.withPermission("STAFF", () => {
      throw new TypeError("handler bug");
    });
    const response = await route(new Request("http://localhost/api/boom-staff", { headers: { cookie: `session=${token}` } }));
    const { ref } = (await response.json()) as { ref: string };
    expect(await rowFor(ref)).toMatchObject({ route: "/api/boom-staff", user_id: user.id, role: "STAFF", error_name: "TypeError", message: "handler bug" });
  });

  it("D135 a 4xx, a 401 and a 403 are not recorded", async () => {
    const before = (await owner.query("SELECT count(*)::int AS n FROM error_events")).rows[0].n;
    const unauthorised = await guards.withPermission("STAFF", () => Response.json({}))(new Request("http://localhost/api/never-recorded"));
    expect(unauthorised.status).toBe(401);
    const validation = await guards.publicRoute(() => Response.json({ error: "VALIDATION" }, { status: 400 }))(new Request("http://localhost/api/never-recorded-2"));
    expect(validation.status).toBe(400);
    expect((await owner.query("SELECT count(*)::int AS n FROM error_events")).rows[0].n).toBe(before);
  });
});

describe("D135 Next's onRequestError hook", () => {
  const request = { path: "/staff/reports?month=2026-10", method: "GET", headers: { cookie: "session=SECRET-COOKIE", "x-secret": "HEADER-VALUE" } };
  const context = (routeType: "render" | "action" | "route", routePath: string) => ({
    routerKind: "App Router" as const, routePath, routeType, renderSource: "react-server-components" as const, revalidateReason: undefined, renderType: "dynamic" as const,
  });

  it("D135 a server component error is stored as PAGE with the digest the browser shows, and no header or query", async () => {
    vi.stubEnv("DATABASE_URL", inject("testDatabaseUrl"));
    const error = Object.assign(new Error("render failed"), { digest: "3175611538" });
    await onRequestError(error, request, context("render", "/app/(staff)/staff/reports/page"));
    const { rows } = await owner.query("SELECT * FROM error_events WHERE digest = '3175611538'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "PAGE", route: "/app/(staff)/staff/reports/page", method: "GET", status: 500, message: "render failed", level: "ERROR" });
    expect(JSON.stringify(rows[0])).not.toMatch(/SECRET-COOKIE|HEADER-VALUE|month=2026/);
  });

  it("D135 a server action error is stored as ACTION with its digest", async () => {
    vi.stubEnv("DATABASE_URL", inject("testDatabaseUrl"));
    await onRequestError(Object.assign(new Error("action failed"), { digest: "2718281828" }), { ...request, method: "POST", path: "/staff/complaints" }, context("action", "/app/(staff)/staff/complaints/page"));
    const { rows } = await owner.query("SELECT * FROM error_events WHERE digest = '2718281828'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "ACTION", method: "POST", message: "action failed" });
  });

  it("D135 the hook never throws, even with no database and an error that is not an Error", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(onRequestError("a string", request, context("route", "/app/api/x/route"))).resolves.toBeUndefined();
    await expect(onRequestError(null, request, context("render", "/app/x/page"))).resolves.toBeUndefined();
  });
});

describe("D135 nothing secret is stored", () => {
  it("D135 after failing requests whose errors contain every secret of the environment, no row of the table holds any of them", async () => {
    for (const [name, value] of Object.entries(SECRETS)) vi.stubEnv(name, value);
    const everything = Object.values(SECRETS).join(" | ");
    let n = 0;
    for (const value of Object.values(SECRETS)) {
      const route = guards.publicRoute(() => {
        throw Object.assign(new Error(`failed with ${value} and ${everything} for 9876543210 at a@b.com`), { stack: `Error: x\n    at run (${value}:1:1)` });
      });
      await route(new Request(`http://localhost/api/leak-${n++}/${value}`, { method: "POST", headers: { cookie: `session=${value}`, authorization: `Bearer ${value}` }, body: value }));
    }
    const { rows } = await owner.query("SELECT * FROM error_events WHERE route LIKE '/api/leak-%'");
    expect(rows).toHaveLength(Object.keys(SECRETS).length);
    const stored = JSON.stringify(rows);
    for (const value of [...Object.values(SECRETS), "Rec0rding-Pw-77", "9876543210", "a@b.com"]) expect(stored).not.toContain(value);
    expect(stored).toContain("[secret]");
  });
});
