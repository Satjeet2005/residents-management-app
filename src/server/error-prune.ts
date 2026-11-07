/**
 * The pure part of `npm run db:prune-errors` (D135): reads the arguments and applies the SAME guards as the seed command (src/server/seed/guards.ts).
 * The command deletes, so it is stricter than the seed in one way: it always needs `--yes` and `--confirm-database=<the exact database name>`, on a
 * local database too. A hosted database also needs `--allow-remote`. Messages never contain the user, the password or the URL.
 */
import { type GuardResult, assertSafeTarget, checkConfirmed, parseTarget } from "./seed/guards";

export const DEFAULT_DAYS = 30;
export const MIN_DAYS = 1;
export const MAX_DAYS = 365;

export type PruneArgs = { ok: true; days: number; flags: string[] } | { ok: false; message: string };

const USAGE = `Usage: npm run db:prune-errors -- [--days=${MIN_DAYS}..${MAX_DAYS}, default ${DEFAULT_DAYS}] --yes --confirm-database=<database name> [--allow-remote]`;

/** Reads the arguments strictly: an unknown or repeated option and a number of days that is not a whole number from 1 to 365 are refused. */
export function parsePruneArgs(argv: readonly string[]): PruneArgs {
  let days = DEFAULT_DAYS;
  let seenDays = false;
  const seen = new Set<string>();
  for (const arg of argv) {
    if (arg === "--yes" || arg === "--allow-remote") {
      if (seen.has(arg)) return { ok: false, message: `${arg} was given twice.` };
      seen.add(arg);
    } else if (arg.startsWith("--confirm-database=")) {
      if (seen.has("--confirm-database")) return { ok: false, message: "--confirm-database was given twice." };
      seen.add("--confirm-database");
    } else if (arg.startsWith("--days=")) {
      if (seenDays) return { ok: false, message: "--days was given twice." };
      seenDays = true;
      const text = arg.slice("--days=".length);
      days = /^[0-9]{1,4}$/.test(text) ? Number(text) : Number.NaN;
      if (!(days >= MIN_DAYS && days <= MAX_DAYS)) return { ok: false, message: `--days must be a whole number from ${MIN_DAYS} to ${MAX_DAYS}.` };
    } else {
      return { ok: false, message: `Unknown argument "${arg.split("=")[0]}". ${USAGE}` };
    }
  }
  return { ok: true, days, flags: [...argv] };
}

/** May this command delete from this database? Nothing is changed when it says no. */
export function checkPrune(databaseUrl: string | undefined, flags: readonly string[]): GuardResult {
  if (!databaseUrl) return { ok: false, reason: "DATABASE_URL is not set in this shell. It must be the owner URL of the database to prune. Nothing was changed." };
  let target;
  try {
    target = parseTarget(databaseUrl);
  } catch {
    return { ok: false, reason: "DATABASE_URL is not a valid connection string. Nothing was changed." };
  }
  const confirmed = checkConfirmed(flags);
  if (!confirmed.ok) return confirmed;
  if (!flags.includes(`--confirm-database=${target.database}`)) {
    return { ok: false, reason: `Type --confirm-database=${target.database} to confirm which database will lose its old error events. Nothing was changed.` };
  }
  return assertSafeTarget({ ...target, flags });
}
