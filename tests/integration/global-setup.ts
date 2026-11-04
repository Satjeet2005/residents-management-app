import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

function adminClient(connectionString: string) {
  return new Client({ connectionString });
}

export default async function setup(project: TestProject) {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) {
    // Throwing here crashes vitest while it formats the stack, hiding the message.
    console.error(
      "DATABASE_URL is not set. Copy .env.example to .env and start the database with `docker compose up -d`.",
    );
    process.exit(1);
  }

  const dbName = `township_test_${randomBytes(4).toString("hex")}`;
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${dbName}`;

  const admin = adminClient(adminUrl);
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: "pipe",
  });

  project.provide("testDatabaseUrl", testUrl.toString());

  return async () => {
    const cleanup = adminClient(adminUrl);
    await cleanup.connect();
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    } finally {
      await cleanup.end();
    }
  };
}
