import type { Db } from "@/server/auth/db";
import { isDemoMode } from "@/server/clock";
import { MIN_TOKEN_CHARS } from "@/server/ops/error-test";
import { isProductionGradeSecret } from "@/server/secret-rules";

/**
 * The readiness report (D112): can this deployment sign someone in and show the Home? Every field is a boolean, a fixed word, a number
 * or a table name from the list below. It never carries a value, a connection string, a host, a user name or an error message, because
 * the route is public.
 */
export const READINESS_TIMEOUT_MS = 3000;

/** The tables the sign-in and Home flows read or write, and the one column added by the latest auth migration. */
export const REQUIRED_TABLES = [
  "users", "user_permissions", "flats", "flat_members", "sessions", "otp_codes", "audit_log", "society_settings",
  "bills", "ledger_entries", "payment_attempts", "complaints", "complaint_events", "complaint_categories", "error_events",
] as const;
export const REQUIRED_COLUMN = "otp_codes.requested_ip_hash";

export type AppRoleCheck = {
  isSuperuser: boolean;
  canInsertOtp: boolean;
  canUpdateLedger: boolean;
  canDeleteAuditLog: boolean;
  /** D136: the app role must be able to INSERT error events ... */
  canInsertErrorEvents: boolean;
  /** ... and must NOT be able to read them (true makes the report degraded). */
  canReadErrorEvents: boolean;
};

export type ReadinessChecks = {
  config: { otpPepper: boolean; webhookSecret: boolean; demoMode: boolean; opsTestEnabled: boolean; vercelSystemVars: boolean; nodeMajor: number };
  database: "ok" | "unreachable" | "timeout";
  schema: { missingTables: string[] } | "skipped";
  appRole: AppRoleCheck | "skipped";
  data: { seeded: boolean } | "skipped";
};
export type Readiness = { status: "ok" | "degraded"; checks: ReadinessChecks };

type DatabaseFacts = { missingTables: string[]; appRole: AppRoleCheck; seeded: boolean };

const tableList = REQUIRED_TABLES.map((table) => `'${table}'`).join(", "); // constants only: nothing from a request is ever in this text

/** Asks the database everything in a few short queries. A privilege is read with has_*_privilege for current_user, never by trying it. */
async function probe(db: Db): Promise<DatabaseFacts> {
  await db.$queryRaw`SELECT 1`;
  const absent = await db.$queryRawUnsafe<{ name: string }[]>(
    `SELECT t.name FROM unnest(ARRAY[${tableList}]::text[]) AS t(name) WHERE to_regclass('public.' || t.name) IS NULL ORDER BY t.name`,
  );
  const missingTables = absent.map((row) => row.name);
  if (!missingTables.includes("otp_codes")) {
    const [column] = await db.$queryRaw<{ present: boolean }[]>`SELECT EXISTS (
      SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.otp_codes') AND attname = 'requested_ip_hash' AND NOT attisdropped) AS present`;
    if (!column.present) missingTables.push(REQUIRED_COLUMN);
  }
  const [role] = await db.$queryRaw<AppRoleCheck[]>`SELECT
    r.rolsuper AS "isSuperuser",
    COALESCE(has_table_privilege(current_user, to_regclass('public.otp_codes')::oid, 'INSERT'), false) AS "canInsertOtp",
    COALESCE(has_any_column_privilege(current_user, to_regclass('public.ledger_entries')::oid, 'UPDATE'), false) AS "canUpdateLedger",
    COALESCE(has_table_privilege(current_user, to_regclass('public.audit_log')::oid, 'DELETE'), false) AS "canDeleteAuditLog",
    COALESCE(has_table_privilege(current_user, to_regclass('public.error_events')::oid, 'INSERT'), false) AS "canInsertErrorEvents",
    COALESCE(has_any_column_privilege(current_user, to_regclass('public.error_events')::oid, 'SELECT'), false) AS "canReadErrorEvents"
    FROM pg_roles r WHERE r.rolname = current_user`;
  return { missingTables, appRole: role, seeded: missingTables.length === 0 && (await isSeeded(db)) };
}

/** A role that cannot read these tables, or a table that is missing, counts as "not seeded"; the other checks name the cause. */
async function isSeeded(db: Db): Promise<boolean> {
  try {
    const [row] = await db.$queryRaw<{ seeded: boolean }[]>`SELECT (EXISTS (SELECT 1 FROM users) AND EXISTS (SELECT 1 FROM flats) AND EXISTS (SELECT 1 FROM bills)) AS seeded`;
    return row.seeded;
  } catch {
    return false;
  }
}

type Outcome = { state: "ok"; facts: DatabaseFacts } | { state: "unreachable" | "timeout" };

/** The whole probe has one deadline. A late failure of an abandoned probe is swallowed, so it cannot become an unhandled rejection. */
async function probeWithin(getDb: () => Db, timeoutMs: number): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const work = probe(getDb());
    work.catch(() => undefined);
    const result = await Promise.race([work, deadline]);
    return result === "timeout" ? { state: "timeout" } : { state: "ok", facts: result };
  } catch {
    return { state: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export type ReadinessOptions = {
  getDb: () => Db;
  env?: Readonly<Record<string, string | undefined>>;
  nodeVersion?: string;
  timeoutMs?: number;
};

const roleIsRight = (role: AppRoleCheck): boolean =>
  !role.isSuperuser && role.canInsertOtp && !role.canUpdateLedger && !role.canDeleteAuditLog && role.canInsertErrorEvents && !role.canReadErrorEvents;

/** Never throws. Required for "ok": a valid pepper and webhook secret, a reachable database, no missing table, the right role, and seeded data. */
export async function checkReadiness({ getDb, env = process.env, nodeVersion = process.versions.node, timeoutMs = READINESS_TIMEOUT_MS }: ReadinessOptions): Promise<Readiness> {
  const config = {
    otpPepper: isProductionGradeSecret(env.OTP_PEPPER),
    webhookSecret: isProductionGradeSecret(env.PAYMENT_WEBHOOK_SECRET),
    demoMode: isDemoMode(env),
    opsTestEnabled: (env.OPS_TEST_TOKEN?.length ?? 0) >= MIN_TOKEN_CHARS,
    vercelSystemVars: env.VERCEL === "1",
    nodeMajor: Number.parseInt(nodeVersion, 10) || 0,
  };
  const outcome = await probeWithin(getDb, timeoutMs);
  if (outcome.state !== "ok") {
    return { status: "degraded", checks: { config, database: outcome.state, schema: "skipped", appRole: "skipped", data: "skipped" } };
  }
  const { missingTables, appRole, seeded } = outcome.facts;
  const ok = config.otpPepper && config.webhookSecret && missingTables.length === 0 && roleIsRight(appRole) && seeded;
  return { status: ok ? "ok" : "degraded", checks: { config, database: "ok", schema: { missingTables }, appRole, data: { seeded } } };
}
