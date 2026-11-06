import net from "node:net";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";
import { dbPoolOptions } from "@/server/db-options";

/** A server that accepts a connection and then never says a word: a database that is waking up, or unreachable. */
let silent: net.Server;
let port = 0;
const sockets = new Set<net.Socket>();

beforeAll(async () => {
  silent = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  port = (silent.address() as net.AddressInfo).port;
});
afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => silent.close(() => resolve()));
});

const silentUrl = () => `postgresql://app:secret@127.0.0.1:${port}/none`;

async function timeIt(work: Promise<unknown>): Promise<{ ms: number; error: Error | null }> {
  const started = performance.now();
  const error = await work.then(() => null, (e: unknown) => e as Error);
  return { ms: performance.now() - started, error };
}

describe("D91 bounded connection and query timeouts", () => {
  it("a pool built from dbPoolOptions gives up on a server that never answers, within 1,500 ms for a 500 ms timeout", async () => {
    const pool = new Pool({ connectionString: silentUrl(), ...dbPoolOptions({}, { connectionTimeoutMillis: 500 }) });
    const { ms, error } = await timeIt(pool.connect());
    await pool.end().catch(() => {});
    expect(error).not.toBeNull();
    expect(ms).toBeGreaterThanOrEqual(400);
    expect(ms).toBeLessThan(1500);
  });

  it("PrismaClient through the pg adapter rejects a query within 1,500 ms for a 500 ms timeout, and does not hang", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: silentUrl(), ...dbPoolOptions({}, { connectionTimeoutMillis: 500 }) }) });
    const { ms, error } = await timeIt(prisma.$queryRaw`SELECT 1`);
    await prisma.$disconnect().catch(() => {});
    expect(error).not.toBeNull();
    expect(ms).toBeLessThan(1500);
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
