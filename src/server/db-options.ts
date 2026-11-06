/**
 * Connection settings for the database pool, in one place (D91, docs/deployment-plan.md "Connection settings").
 *
 * Why these numbers: the app runs in serverless functions against Neon, whose compute sleeps after 5 idle minutes and
 * wakes "within a few hundred milliseconds" (https://neon.com/docs/introduction/scale-to-zero). In Prisma 7 the pg adapter
 * defaults to a connection timeout of 0, which means no timeout, so an unreachable database would hold a request until
 * the platform kills the function (https://www.prisma.io/docs/orm/overview/databases/postgresql). Each function instance
 * has its own pool, and Neon's pooler already shares real connections (10,000 clients), so a pool stays small.
 */
export type DbPoolOptions = {
  /** The most connections one instance opens. */
  max: number;
  /** How long to wait for a connection before giving up. Long enough for a cold Neon wake-up, short enough to answer. */
  connectionTimeoutMillis: number;
  /** An idle connection is closed after this long, before a suspended function would be frozen holding it. */
  idleTimeoutMillis: number;
  /** A query that has not answered after this long is abandoned by the client (client-side; the server is not told). */
  query_timeout: number;
};

export const DB_POOL_DEFAULT_MAX = 5;
export const DB_POOL_MIN = 1;
export const DB_POOL_MAX_LIMIT = 10;

const FIXED = { connectionTimeoutMillis: 8_000, idleTimeoutMillis: 10_000, query_timeout: 10_000 } as const;

/**
 * The pool options for `PrismaPg`. `DB_POOL_MAX` sets the pool size: unset or empty gives 5; a whole number from 1 to 10
 * is used; anything else (text, 0, 11, 2.5, a negative number) **throws a RangeError**, because a wrong setting should be
 * loud, not quietly different. `overrides` is for tests.
 */
export function dbPoolOptions(env: Readonly<Record<string, string | undefined>>, overrides: Partial<DbPoolOptions> = {}): DbPoolOptions {
  const raw = env.DB_POOL_MAX?.trim() ?? "";
  let max = DB_POOL_DEFAULT_MAX;
  if (raw !== "") {
    max = /^[0-9]{1,3}$/.test(raw) ? Number(raw) : Number.NaN;
    if (!(max >= DB_POOL_MIN && max <= DB_POOL_MAX_LIMIT)) {
      throw new RangeError(`DB_POOL_MAX must be a whole number from ${DB_POOL_MIN} to ${DB_POOL_MAX_LIMIT}`);
    }
  }
  return { max, ...FIXED, ...overrides };
}
