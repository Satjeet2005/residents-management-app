export type GuardResult = { ok: true } | { ok: false; reason: string };

const OK: GuardResult = { ok: true };

/** The seed writes demo data, so it runs only when DEMO_MODE is exactly "true". */
export function checkDemoMode(demoMode: string | undefined): GuardResult {
  return demoMode === "true" ? OK : { ok: false, reason: 'DEMO_MODE is not "true", so nothing was changed. Demo data is written only in demo mode.' };
}

/** The seed writes into an empty database only. */
export function checkEmpty(flatCount: number): GuardResult {
  return flatCount === 0
    ? OK
    : { ok: false, reason: `The database is not empty (flats has ${flatCount} rows), so nothing was changed. To start over run \`npm run db:reset-demo\`.` };
}

/** A human must confirm the target by passing --yes. */
export function checkConfirmed(args: readonly string[]): GuardResult {
  return args.includes("--yes") ? OK : { ok: false, reason: "Add --yes to confirm this target database, then run the command again. Nothing was changed." };
}

export type Target = { host: string; database: string };

/** The host name (no port) and database name of a connection URL; the user and password are dropped. */
export function parseTarget(databaseUrl: string): Target {
  const url = new URL(databaseUrl);
  return { host: url.hostname.replace(/^\[|\]$/g, "").toLowerCase(), database: decodeURIComponent(url.pathname.replace(/^\//, "")) };
}

/** The host and database name of a connection URL, for printing; never the user, the password or the rest of the URL. */
export function describeTarget(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return `host ${url.host}, database ${name}`;
}

const LOCAL_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "::1"];

/** Databases a reset may destroy: the test databases, the seed scratch database and the local development database. */
const RESETTABLE_DATABASES: readonly RegExp[] = [/^township_test_/, /^township_seed_scratch$/, /^township$/];

const CONFIRM_PREFIX = "--confirm-database=";

/** The value of `--confirm-database=<name>` if it is given exactly once, else null. */
function confirmedDatabase(flags: readonly string[]): string | null {
  const given = flags.filter((f) => f.startsWith(CONFIRM_PREFIX));
  return given.length === 1 ? given[0].slice(CONFIRM_PREFIX.length) : null;
}

const refuse = (reason: string): GuardResult => ({ ok: false, reason: `${reason} Nothing was changed.` });

/**
 * Stops a reset or a seed from hitting the wrong database. `flags` are the
 * command-line arguments; `--reset` marks db:reset-demo.
 *
 * - Reset: the host must be exactly localhost, 127.0.0.1 or ::1, the database must
 *   be township_test_*, township_seed_scratch or township, and the human must type
 *   `--confirm-database=<that exact name>`. `--yes` alone is not enough.
 * - Seed on a local host: allowed (the database must also be empty).
 * - Seed on any other host: only with `--allow-remote` and `--confirm-database=<name>`.
 * Messages never contain the user, the password or the URL.
 */
export function assertSafeTarget({ host, database, flags }: { host: string; database: string; flags: readonly string[] }): GuardResult {
  const local = LOCAL_HOSTS.includes(host);
  const confirmed = confirmedDatabase(flags);
  const confirmMatches = confirmed !== null && confirmed === database;
  if (flags.includes("--reset")) {
    if (!local) return refuse(`A reset is only allowed on localhost, 127.0.0.1 or ::1, and the host is ${host}.`);
    if (!RESETTABLE_DATABASES.some((pattern) => pattern.test(database))) {
      return refuse(`A reset is only allowed on township, township_seed_scratch or township_test_*, and the database is ${database}.`);
    }
    if (!confirmMatches) return refuse(`Type --confirm-database=${database} to confirm that this database will be destroyed and recreated.`);
    return OK;
  }
  if (local) return OK;
  if (!flags.includes("--allow-remote")) return refuse(`The host ${host} is not local. To seed a remote database add --allow-remote and --confirm-database=${database}.`);
  if (!confirmMatches) return refuse(`Type --confirm-database=${database} to confirm that you mean to seed this remote database.`);
  return OK;
}
