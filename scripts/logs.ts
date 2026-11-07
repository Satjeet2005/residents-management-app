import { Client } from "pg";
import { parseLogsArgs, readErrorEvents, render } from "../src/server/error-reader";
import { describeTarget } from "../src/server/seed/guards";

/**
 * `npm run logs:errors` (D135): the developer's reader for the durable error log. It reads ONLY LOGS_DATABASE_URL, the connection string of the
 * read-only logs role (SELECT on error_events and nothing else), and refuses to run without it. It prints the host and database name (never the
 * user or password) and reads inside a READ ONLY transaction. No page of the app and no permission reads this table.
 */
function stop(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const parsed = parseLogsArgs(process.argv.slice(2));
  if (!parsed.ok) stop(parsed.message);
  const url = process.env.LOGS_DATABASE_URL;
  if (!url) stop("LOGS_DATABASE_URL is not set. It is the connection string of the read-only logs role, on your machine only (see docs/observability.md). Nothing was read.");
  let target: string;
  try {
    target = describeTarget(url);
  } catch {
    stop("LOGS_DATABASE_URL is not a valid connection string. Nothing was read.");
  }
  console.error(`Reading error events from ${target} (read-only).`);
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    console.log(render(await readErrorEvents(client, parsed.filters, Date.now()), parsed.mode));
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "none";
    stop(`The error log could not be read (code ${code}). Check LOGS_DATABASE_URL and that the logs role has been granted SELECT on error_events.`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch(() => stop("The error log reader failed unexpectedly. Nothing was changed."));
