import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { inject } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";
import { generateDemoDataset } from "@/domain/seed/generate";
import type { Actor } from "@/server/complaints/context";
import { dbPoolOptions } from "@/server/db-options";
import { seedDemoDatabase } from "@/server/seed/run";
import { type TestAppRole, createAppRole } from "./app-role-helpers";
import { connect } from "./db";
import { actorOf } from "./complaints-helpers";

export type SeededWorld = { ownerPrisma: PrismaClient; appPrisma: PrismaClient; databaseName: string; kavita: Actor; sanjay: Actor; close: () => Promise<void> };

/**
 * A scratch database `township_test_seeded_<hex>` (its name is printed by SELECT current_database() and checked before anything is written) with the whole
 * demo dataset (3,450 complaints, 31 of them safety), the app role, and Kavita Rao (manage) and Sanjay Pawar (manage and duty manager) from the seed.
 */
export async function setupSeededWorld(): Promise<SeededWorld> {
  const admin = await connect();
  const databaseName = `township_test_seeded_${randomBytes(4).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(inject("testDatabaseUrl"));
  url.pathname = `/${databaseName}`;
  const databaseUrl = url.toString();
  const dropDatabase = async () => {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  };
  let role: TestAppRole | null = null;
  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    const owner = new Client({ connectionString: databaseUrl });
    await owner.connect();
    const current = (await owner.query<{ current_database: string }>("SELECT current_database()")).rows[0].current_database;
    if (!/^township_test_seeded_/.test(current)) throw new Error(`refusing to continue on database ${current}`);
    const seeded = await seedDemoDatabase(owner, generateDemoDataset());
    if (!seeded.ok) throw new Error("the seed was refused");
    role = await createAppRole(owner, databaseUrl);
    await owner.end();
    const ownerPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const appPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: role.url, ...dbPoolOptions({ DB_POOL_MAX: "6" }) }) });
    const idOf = async (name: string) => (await ownerPrisma.user.findFirstOrThrow({ where: { name, role: "STAFF" }, select: { id: true } })).id;
    const ready = role;
    return {
      ownerPrisma,
      appPrisma,
      databaseName,
      kavita: await actorOf(ownerPrisma, await idOf("Kavita Rao")),
      sanjay: await actorOf(ownerPrisma, await idOf("Sanjay Pawar")),
      close: async () => {
        await appPrisma.$disconnect();
        await ownerPrisma.$disconnect();
        await dropDatabase();
        await ready.drop();
      },
    };
  } catch (error) {
    await dropDatabase();
    if (role !== null) await role.drop();
    throw error;
  }
}
