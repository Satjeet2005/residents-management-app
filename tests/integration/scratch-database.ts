import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Client } from "pg";

export type ScratchDatabase = { name: string; url: string; drop: () => Promise<void> };

/**
 * A new, empty, fully migrated database named township_test_*, for a test that needs a database no other test has written to.
 * It is made and dropped like the one in global-setup.ts, and it refuses to drop anything that is not named township_test_*.
 */
export async function createScratchDatabase(): Promise<ScratchDatabase> {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error("DATABASE_URL is not set");
  const name = `township_test_${randomBytes(4).toString("hex")}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
  return {
    name,
    url: url.toString(),
    drop: async () => {
      if (!/^township_test_[0-9a-f]{8}$/.test(name)) throw new Error("refusing to drop a database that is not township_test_*");
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
