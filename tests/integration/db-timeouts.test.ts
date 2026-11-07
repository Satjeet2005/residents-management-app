import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";
import { dbPoolOptions } from "@/server/db-options";
import { type SilentServer, startSilentServer } from "./silent-server";

let silent: SilentServer;
beforeAll(async () => {
  silent = await startSilentServer();
});
afterAll(() => silent.close());

const silentUrl = () => silent.url();

async function timeIt(work: Promise<unknown>): Promise<{ ms: number; error: Error | null }> {
  const started = performance.now();
  const error = await work.then(() => null, (e: unknown) => e as Error);
  return { ms: performance.now() - started, error };
}

describe("D91 bounded connection and query timeouts", () => {
  it("a pool built from dbPoolOptions gives up on a server that never answers, within 5,000 ms for a 500 ms timeout", async () => {
    const pool = new Pool({ connectionString: silentUrl(), ...dbPoolOptions({}, { connectionTimeoutMillis: 500 }) });
    const { ms, error } = await timeIt(pool.connect());
    await pool.end().catch(() => {});
    expect(error).not.toBeNull();
    expect(ms).toBeGreaterThanOrEqual(400);
    expect(ms).toBeLessThan(5000); // 500 ms timeout; slowest seen 0.65 s alone, so the bound is far above load noise and far below a hang
  });

  it("PrismaClient through the pg adapter rejects a query within 5,000 ms for a 500 ms timeout, and does not hang", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: silentUrl(), ...dbPoolOptions({}, { connectionTimeoutMillis: 500 }) }) });
    const { ms, error } = await timeIt(prisma.$queryRaw`SELECT 1`);
    await prisma.$disconnect().catch(() => {});
    expect(error).not.toBeNull();
    expect(ms).toBeLessThan(5000);
  });

  it("the default connect timeout is not zero: the default options set 8,000 ms", () => {
    expect(dbPoolOptions({}).connectionTimeoutMillis).toBe(8000);
  });

  it("a slow query is abandoned after query_timeout (300 ms here), and the pool still works afterwards", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: inject("testDatabaseUrl"), ...dbPoolOptions({ DB_POOL_MAX: "2" }, { query_timeout: 300 }) }) });
    try {
      const { ms, error } = await timeIt(prisma.$queryRaw`SELECT pg_sleep(2)`);
      expect(error).not.toBeNull();
      expect(ms).toBeLessThan(1500);
      expect(await prisma.$queryRaw`SELECT 1 AS one`).toEqual([{ one: 1 }]);
    } finally {
      await prisma.$disconnect();
    }
  });
});
