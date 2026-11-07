import { Client } from "pg";
import { checkPrune, parsePruneArgs } from "../src/server/error-prune";

/**
 * `npm run db:prune-errors -- --days=30 --yes --confirm-database=<name>` (D135) deletes error_events rows older than N days, with the owner URL in
 * DATABASE_URL of the caller's shell (the app role cannot delete). It has the seed command's guards, and it prints only the number of rows deleted.
 */
function stop(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const parsed = parsePruneArgs(process.argv.slice(2));
  if (!parsed.ok) stop(parsed.message);
  const url = process.env.DATABASE_URL;
  const guard = checkPrune(url, parsed.flags);
  if (!guard.ok || url === undefined) stop(guard.ok ? "DATABASE_URL is not set." : guard.reason);
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const result = await client.query("DELETE FROM error_events WHERE occurred_at < now() - make_interval(days => $1)", [parsed.days]);
    console.log(`Deleted ${result.rowCount ?? 0} rows.`);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "none";
    stop(`The error events could not be pruned (code ${code}). Nothing else was changed.`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch(() => stop("The prune failed unexpectedly."));
