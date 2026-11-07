import { PrismaPg } from "@prisma/adapter-pg";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";
import { dbPoolOptions } from "@/server/db-options";
import { FloodGate, buildEvent, persistError, reportError } from "@/server/error-log";
import { createAppRole, type TestAppRole } from "./app-role-helpers";
import { connect } from "./db";

/** D135, D136: events are written through the REAL app role, which may only INSERT. The trap is that Prisma's create() uses RETURNING. */

let owner: Client;
let role: TestAppRole;
let prisma: PrismaClient;
const ENV = { NODE_ENV: "test", VERCEL_GIT_COMMIT_SHA: "0123456789abcdef" };

beforeAll(async () => {
  owner = await connect();
  role = await createAppRole(owner);
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: role.url, ...dbPoolOptions({ DB_POOL_MAX: "2" }) }) });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await prisma?.$disconnect();
  if (role) await role.drop();
  await owner?.end();
});

const row = async (ref: string) => (await owner.query("SELECT * FROM error_events WHERE ref = $1", [ref])).rows[0];

describe("D136 writing as the insert-only app role", () => {
  it("D136 the trap: Prisma create() uses INSERT ... RETURNING, so it is refused under the app role", async () => {
    const data = { ref: "E-TRAP01", level: "ERROR", source: "ROUTE", route: "/x", errorName: "Error", message: "m", environment: "test", fingerprint: "f" };
    await expect(prisma.errorEvent.create({ data })).rejects.toThrow();
    expect(await row("E-TRAP01")).toBeUndefined();
  });

  it("D136 $executeRaw without RETURNING works, and every column arrives as written", async () => {
    const event = buildEvent(
      { ref: "E-RAW001", level: "ERROR", source: "ACTION", route: "/staff/x", method: "POST", status: 500, digest: "98765", requestId: "req-1", userId: "3f2b9c1e-0a4d-4b7e-9d3a-5c6e7f8a9b0c", role: "STAFF", error: Object.assign(new Error("boom"), { code: "42P01" }) },
      ENV,
    );
    await persistError(event, prisma, { gate: new FloodGate() });
    const stored = await row("E-RAW001");
    expect(stored).toMatchObject({
      level: "ERROR", source: "ACTION", route: "/staff/x", method: "POST", status: 500, digest: "98765", request_id: "req-1", user_id: "3f2b9c1e-0a4d-4b7e-9d3a-5c6e7f8a9b0c",
      role: "STAFF", error_name: "Error", error_code: "42P01", message: "boom", deployment: "0123456", environment: "test", suppressed_count: 0,
    });
    expect(stored.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.stack).toContain("at ");
  });

  it("D136 a warning with no user, status or code stores nulls", async () => {
    await persistError(buildEvent({ ref: "E-WARN01", level: "WARN", source: "PROVIDER", route: "classifier", errorName: "BreakerOpened", message: "opened" }, ENV), prisma, { gate: new FloodGate() });
    expect(await row("E-WARN01")).toMatchObject({ level: "WARN", source: "PROVIDER", status: null, user_id: null, error_code: null, stack: null });
  });

  it("D135 a duplicate reference (a real 23505) is stored again under a new reference", async () => {
    const event = buildEvent({ ref: "E-DUP002", level: "ERROR", source: "ROUTE", route: "/dup", error: new Error("first") }, ENV);
    await persistError(event, prisma, { gate: new FloodGate() });
    await persistError({ ...event, message: "second" }, prisma, { gate: new FloodGate(), newRef: () => "E-DUP003" });
    expect((await row("E-DUP002")).message).toBe("first");
    expect((await row("E-DUP003")).message).toBe("second");
  });

  it("D135 suppressed_count arrives on the next row of the fingerprint", async () => {
    let t = 0;
    const gate = new FloodGate(() => t);
    const event = buildEvent({ ref: "E-SUP001", level: "ERROR", source: "ROUTE", route: "/flood", error: new Error("x") }, ENV);
    await persistError(event, prisma, { gate });
    await persistError({ ...event, ref: "E-SUP002" }, prisma, { gate });
    await persistError({ ...event, ref: "E-SUP003" }, prisma, { gate });
    t += 61_000;
    await persistError({ ...event, ref: "E-SUP004" }, prisma, { gate });
    expect(await row("E-SUP002")).toBeUndefined();
    expect((await row("E-SUP004")).suppressed_count).toBe(2);
  });

  it("D135 reportError stores the row with the reference it returns, as the app role", async () => {
    const ref = await reportError(new Error("through reportError"), { source: "PAGE", route: "/home", digest: "555" }, prisma, { gate: new FloodGate(), env: ENV });
    expect(await row(ref)).toMatchObject({ source: "PAGE", route: "/home", digest: "555", message: "through reportError" });
  });

  it("D135 a database that cannot be reached: the response data is unchanged and nothing throws", async () => {
    const unreachable = new PrismaClient({ adapter: new PrismaPg({ connectionString: "postgresql://nobody:x@127.0.0.1:1/none", ...dbPoolOptions({ DB_POOL_MAX: "1" }, { connectionTimeoutMillis: 300 }) }) });
    try {
      const ref = await reportError(new Error("db down"), { source: "ROUTE", route: "/a" }, unreachable, { gate: new FloodGate(), env: ENV });
      expect(ref).toMatch(/^E-/);
    } finally {
      await unreachable.$disconnect().catch(() => undefined);
    }
  });
});
