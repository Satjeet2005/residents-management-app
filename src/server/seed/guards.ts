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

/** The host and database name of a connection URL; never the user, the password or the rest of the URL. */
export function describeTarget(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return `host ${url.host}, database ${name}`;
}
