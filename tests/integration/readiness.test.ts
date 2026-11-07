import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";
import { dbPoolOptions } from "@/server/db-options";
import { REQUIRED_COLUMN, REQUIRED_TABLES, checkReadiness } from "@/server/health/readiness";
import { createAppRole, type TestAppRole } from "./app-role-helpers";
import { insertBill, insertFlat, insertUser } from "./db";
import { closedPortUrl, startSilentServer, type SilentServer } from "./silent-server";
import { createScratchDatabase, type ScratchDatabase } from "./scratch-database";

/**
 * D112: the readiness report, read through the APP role on a database of its own (empty at first, then seeded). Each failure
 * mode must show as the right degraded check, and no body may hold a value (a connection string, a host, a user, the pepper).
 */
const PEPPER = "readiness-test-pepper-0123456789abcdef";
const WEBHOOK = "readiness-test-webhook-0123456789abcdef";
const GOOD_ENV = { OTP_PEPPER: PEPPER, PAYMENT_WEBHOOK_SECRET: WEBHOOK, NODE_ENV: "production", DEMO_MODE: "true", VERCEL: "1" };

let scratch: ScratchDatabase;
let owner: Client;
let silent: SilentServer;
const roles: TestAppRole[] = [];
const prismas: PrismaClient[] = [];
let seededOnce = false;

beforeAll(async () => {
  scratch = await createScratchDatabase();
  owner = new Client({ connectionString: scratch.url });
  await owner.connect();
  expect((await owner.query("SELECT current_database() AS name")).rows[0].name).toBe(scratch.name);
  silent = await startSilentServer();
}, 60_000);
afterAll(async () => {
  for (const prisma of prismas) await prisma.$disconnect().catch(() => {});
  await silent?.close();
  await owner?.end();
  // The grants live in the scratch database, so it goes first; only then can the roles be dropped.
  await scratch?.drop();
  for (const role of roles) await role.drop();
});
afterEach(() => vi.unstubAllEnvs());

async function newRole(): Promise<TestAppRole> {
  const role = await createAppRole(owner, scratch.url);
  roles.push(role);
  return role;
}
function prismaFor(url: string, connectionTimeoutMillis = 2000): PrismaClient {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, ...dbPoolOptions({ DB_POOL_MAX: "2" }, { connectionTimeoutMillis }) }) });
  prismas.push(prisma);
  return prisma;
}
async function seed(): Promise<void> {
  if (seededOnce) return;
  const flat = await insertFlat(owner);
  await insertUser(owner);
  await insertBill(owner, flat);
  seededOnce = true;
}
const ready = (prisma: PrismaClient, env: Record<string, string | undefined> = GOOD_ENV) => checkReadiness({ getDb: () => prisma, env, nodeVersion: "24.1.0" });

/** Every leaf of the report is a boolean, the Node major number, or a string from this fixed list. No value can be in it. */
const ALLOWED_WORDS = new Set<string>(["ok", "unreachable", "timeout", "skipped", ...REQUIRED_TABLES, REQUIRED_COLUMN]);
function leavesOf(value: unknown, path = ""): string[] {
  if (typeof value === "boolean") return [];
  if (typeof value === "number") return path === "checks.config.nodeMajor" ? [] : [`${path}: a number`];
  if (typeof value === "string") return path === "status" ? (value === "ok" || value === "degraded" ? [] : [path]) : ALLOWED_WORDS.has(value) ? [] : [`${path}: ${value}`];
  if (Array.isArray(value)) return value.flatMap((item) => leavesOf(item, `${path}[]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => leavesOf(item, path === "" ? key : `${path}.${key}`));
  return [`${path}: unexpected`];
}
function expectValueFree(body: string, secrets: string[]): void {
  expect(leavesOf(JSON.parse(body))).toEqual([]);
  for (const secret of secrets) expect(body).not.toContain(secret);
}
const secretsOf = (url: string): string[] => {
  const parsed = new URL(url);
  return [url, parsed.hostname, parsed.username, parsed.password, parsed.pathname.slice(1), PEPPER, WEBHOOK].filter((s) => s !== "");
};

describe("D112 readiness on a correctly migrated database", () => {
  it("an empty database (migrated, not seeded) is degraded with only data.seeded false", async () => {
    const role = await newRole();
    const report = await ready(prismaFor(role.url));
    expect(report.status).toBe("degraded");
    expect(report.checks).toEqual({
      config: { otpPepper: true, webhookSecret: true, demoMode: true, vercelSystemVars: true, nodeMajor: 24 },
      database: "ok",
      schema: { missingTables: [] },
      appRole: { isSuperuser: false, canInsertOtp: true, canUpdateLedger: false, canDeleteAuditLog: false },
      data: { seeded: false },
    });
  });

  it("a migrated and seeded database, read as the app role, is ok", async () => {
    await seed();
    const role = await newRole();
    const report = await ready(prismaFor(role.url));
    expect(report.status).toBe("ok");
    expect(report.checks.schema).toEqual({ missingTables: [] });
    expect(report.checks.appRole).toEqual({ isSuperuser: false, canInsertOtp: true, canUpdateLedger: false, canDeleteAuditLog: false });
    expect(report.checks.data).toEqual({ seeded: true });
    expectValueFree(JSON.stringify(report), secretsOf(role.url));
  });

  it("every table the report asks about is in the schema (a renamed table cannot make the list stale)", async () => {
    const { rows } = await owner.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    const existing = new Set(rows.map((row) => row.tablename));
    expect(REQUIRED_TABLES.filter((table) => !existing.has(table))).toEqual([]);
  });
});

describe("D112 each failure mode shows as the right degraded check", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["31 characters", "p".repeat(31)],
    ["the placeholder", "replace-with-another-long-random-string"],
  ])("an OTP_PEPPER that is %s, in production mode, makes config.otpPepper false and the status degraded", async (_name, value) => {
    await seed();
    const role = await newRole();
    const report = await ready(prismaFor(role.url), { ...GOOD_ENV, OTP_PEPPER: value });
    expect(report.status).toBe("degraded");
    expect(report.checks.config.otpPepper).toBe(false);
    expect(report.checks.config.webhookSecret).toBe(true);
    expect(report.checks.database).toBe("ok");
  });

  it("a webhook secret that is the placeholder makes config.webhookSecret false and the status degraded", async () => {
    await seed();
    const role = await newRole();
    const report = await ready(prismaFor(role.url), { ...GOOD_ENV, PAYMENT_WEBHOOK_SECRET: "replace-with-a-long-random-string-of-32-or-more-characters" });
    expect(report.checks.config.webhookSecret).toBe(false);
    expect(report.status).toBe("degraded");
  });

  it("a role that lacks INSERT on otp_codes: canInsertOtp false, degraded", async () => {
    await seed();
    const role = await newRole();
    await owner.query(`REVOKE INSERT ON "otp_codes" FROM "${role.name}"`);
    const report = await ready(prismaFor(role.url));
    expect(report.checks.appRole).toMatchObject({ canInsertOtp: false, canUpdateLedger: false });
    expect(report.status).toBe("degraded");
  });

  it("a role that CAN update the ledger (a whole-table grant): canUpdateLedger true, degraded", async () => {
    await seed();
    const role = await newRole();
    await owner.query(`GRANT UPDATE ON "ledger_entries" TO "${role.name}"`);
    const report = await ready(prismaFor(role.url));
    expect(report.checks.appRole).toMatchObject({ canUpdateLedger: true, canInsertOtp: true });
    expect(report.status).toBe("degraded");
  });

  it("a role that can update only one ledger column is caught too (a column grant counts)", async () => {
    await seed();
    const role = await newRole();
    await owner.query(`GRANT UPDATE ("note") ON "ledger_entries" TO "${role.name}"`);
    const report = await ready(prismaFor(role.url));
    expect(report.checks.appRole).toMatchObject({ canUpdateLedger: true });
    expect(report.status).toBe("degraded");
  });

  it("a role that can DELETE from the audit log: canDeleteAuditLog true, degraded", async () => {
    await seed();
    const role = await newRole();
    await owner.query(`GRANT DELETE ON "audit_log" TO "${role.name}"`);
    const report = await ready(prismaFor(role.url));
    expect(report.checks.appRole).toMatchObject({ canDeleteAuditLog: true });
    expect(report.status).toBe("degraded");
  });

  it("the owner connection is degraded: it can update the ledger and delete from the audit log", async () => {
    await seed();
    const report = await ready(prismaFor(scratch.url));
    expect(report.checks.appRole).toMatchObject({ canUpdateLedger: true, canDeleteAuditLog: true });
    expect(report.status).toBe("degraded");
  });

  it("a missing table is named, the data check cannot pass, and the status is degraded", async () => {
    await seed();
    const role = await newRole();
    await owner.query('ALTER TABLE "complaint_categories" RENAME TO "complaint_categories_gone"');
    try {
      const report = await ready(prismaFor(role.url));
      expect(report.checks.schema).toEqual({ missingTables: ["complaint_categories"] });
      expect(report.checks.data).toEqual({ seeded: false });
      expect(report.status).toBe("degraded");
    } finally {
      await owner.query('ALTER TABLE "complaint_categories_gone" RENAME TO "complaint_categories"');
    }
  });

  it("a missing otp_codes.requested_ip_hash column is named", async () => {
    await seed();
    const role = await newRole();
    await owner.query('ALTER TABLE "otp_codes" RENAME COLUMN "requested_ip_hash" TO "requested_ip_hash_gone"');
    try {
      const report = await ready(prismaFor(role.url));
      expect(report.checks.schema).toEqual({ missingTables: ["otp_codes.requested_ip_hash"] });
      expect(report.status).toBe("degraded");
    } finally {
      await owner.query('ALTER TABLE "otp_codes" RENAME COLUMN "requested_ip_hash_gone" TO "requested_ip_hash"');
    }
  });

  it("a database that refuses the connection: database 'unreachable', the other database checks 'skipped', degraded", async () => {
    const url = await closedPortUrl();
    const report = await ready(prismaFor(url));
    expect(report.status).toBe("degraded");
    expect(report.checks).toMatchObject({ database: "unreachable", schema: "skipped", appRole: "skipped", data: "skipped" });
    expectValueFree(JSON.stringify(report), secretsOf(url));
  });

  it("a database that never answers (the silent server): database 'timeout' at the deadline, the rest 'skipped', degraded", async () => {
    const started = performance.now();
    const report = await checkReadiness({ getDb: () => prismaFor(silent.url()), env: GOOD_ENV, nodeVersion: "24.1.0", timeoutMs: 300 });
    const ms = performance.now() - started;
    expect(report.checks).toMatchObject({ database: "timeout", schema: "skipped", appRole: "skipped", data: "skipped" });
    expect(report.status).toBe("degraded");
    expect(ms).toBeGreaterThanOrEqual(250);
    expect(ms).toBeLessThan(1500);
    expectValueFree(JSON.stringify(report), secretsOf(silent.url()));
  });

  it("getDb that throws (DATABASE_URL not set) is 'unreachable', not an exception", async () => {
    const report = await checkReadiness({
      getDb: () => {
        throw new Error("DATABASE_URL is not set");
      },
      env: GOOD_ENV,
    });
    expect(report.checks).toMatchObject({ database: "unreachable", schema: "skipped" });
  });
});

describe("D112 the route: status codes, headers, and no value in the body", () => {
  async function callRoute(databaseUrl: string): Promise<{ status: number; cache: string | null; body: string }> {
    vi.stubEnv("DATABASE_URL", databaseUrl);
    vi.stubEnv("OTP_PEPPER", PEPPER);
    vi.stubEnv("PAYMENT_WEBHOOK_SECRET", WEBHOOK);
    const holder = globalThis as unknown as { townshipDb: PrismaClient | undefined };
    holder.townshipDb = undefined;
    const { GET } = await import("@/app/api/health/ready/route");
    try {
      const response = await GET(new Request("http://localhost/api/health/ready"));
      return { status: response.status, cache: response.headers.get("cache-control"), body: await response.text() };
    } finally {
      const opened = holder.townshipDb as PrismaClient | undefined; // set by getDb() during the call
      await opened?.$disconnect().catch(() => {});
      holder.townshipDb = undefined;
    }
  }

  it("ready: 200, no-store, and the body holds none of the connection's values", async () => {
    await seed();
    const role = await newRole();
    const { status, cache, body } = await callRoute(role.url);
    expect(JSON.parse(body).status).toBe("ok");
    expect(status).toBe(200);
    expect(cache).toBe("no-store");
    expectValueFree(body, secretsOf(role.url));
  });

  it("not ready (a role that can update the ledger): 503, no-store, and still no value", async () => {
    await seed();
    const role = await newRole();
    await owner.query(`GRANT UPDATE ON "ledger_entries" TO "${role.name}"`);
    const { status, cache, body } = await callRoute(role.url);
    expect(JSON.parse(body).status).toBe("degraded");
    expect(status).toBe(503);
    expect(cache).toBe("no-store");
    expectValueFree(body, [...secretsOf(role.url), role.name]);
  });

  it("an unreachable database: 503 and the body names no host or port", async () => {
    const url = await closedPortUrl();
    const { status, body } = await callRoute(url);
    expect(status).toBe(503);
    expect(JSON.parse(body).checks.database).toBe("unreachable");
    expectValueFree(body, [...secretsOf(url), new URL(url).port]);
  });

  it("DATABASE_URL not set: the route still answers 503 (it never throws), with database 'unreachable'", async () => {
    const { status, body } = await callRoute("");
    expect(status).toBe(503);
    expect(JSON.parse(body).checks.database).toBe("unreachable");
    expectValueFree(body, [PEPPER, WEBHOOK]);
  });
});
