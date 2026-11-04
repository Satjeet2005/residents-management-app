import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { generateDemoDataset } from "@/domain/seed/generate";
import { type GuardResult, assertSafeTarget, checkConfirmed, checkDemoMode, describeTarget, parseTarget } from "./guards";
import { seedDemoDatabase } from "./run";
import { SeedWriteError } from "./writer";

/**
 * `npm run db:seed -- --yes` writes the demo dataset into an empty database.
 * `npm run db:reset-demo -- --yes --confirm-database=<name>` recreates the schema
 * first (the append-only triggers forbid DELETE and TRUNCATE, so a reset must drop
 * and migrate). See assertSafeTarget for which databases each command may touch.
 */
function stop(message: string): never {
  console.error(message);
  process.exit(1);
}

function ensure(result: GuardResult): void {
  if (!result.ok) stop(result.reason);
}

function printSummary(counts: Record<string, number>, seconds: number, sizeBytes: number): void {
  const width = Math.max(...Object.keys(counts).map((t) => t.length));
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(width)}  ${String(n).padStart(7)}`);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`  ${"total".padEnd(width)}  ${String(total).padStart(7)}`);
  console.log(`Time: ${seconds.toFixed(1)} s. Database size: ${(sizeBytes / 1024 / 1024).toFixed(1)} MB.`);
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: the variables may come from the shell.
  }
  const args = process.argv.slice(2);
  const reset = args.includes("--reset");

  ensure(checkDemoMode(process.env.DEMO_MODE));
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") stop("DATABASE_URL is not set, so nothing was changed.");
  console.log(`Target: ${describeTarget(databaseUrl)}`);
  ensure(assertSafeTarget({ ...parseTarget(databaseUrl), flags: args }));
  ensure(checkConfirmed(args));

  if (reset) {
    console.log("Resetting the schema (prisma migrate reset --force)...");
    execFileSync("npx", ["prisma", "migrate", "reset", "--force"], { stdio: "inherit" });
  }

  const started = performance.now();
  const dataset = generateDemoDataset();
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const outcome = await seedDemoDatabase(db, dataset);
    if (!outcome.ok) stop(outcome.reason);
    const { rows } = await db.query<{ bytes: string }>("SELECT pg_database_size(current_database())::text AS bytes");
    printSummary(outcome.counts, (performance.now() - started) / 1000, Number(rows[0].bytes));
  } catch (error) {
    if (error instanceof SeedWriteError) stop(`${error.message}\nEverything was rolled back.`);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "The seed failed.");
  process.exit(1);
});
