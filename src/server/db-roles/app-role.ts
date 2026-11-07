/**
 * The privileges of the application's database role, generated from ONE matrix (D95, docs/deployment-plan.md
 * "Database role design"). The web app connects as this role, which is not the table owner, so it cannot run
 * `ALTER TABLE ... DISABLE TRIGGER` or `DROP TRIGGER`, and the append-only tables (the ledger, the audit log and three
 * more) give it only SELECT and INSERT. Tests prove the grants (tests/integration/app-role*.test.ts) and that every table
 * in the schema is decided here (tests/integration/app-role-matrix.test.ts).
 *
 * This module only builds SQL text. It never takes, builds or prints a password: the role and its password are made by the
 * human, in SQL, before the grants are run (a role made in the Neon console, API or CLI becomes a member of
 * `neon_superuser`, which this design must avoid).
 */

export type TableGrant = {
  select?: true;
  insert?: true;
  /** Column-level UPDATE: only these columns. Never a whole-table UPDATE. */
  updateColumns?: readonly string[];
};

const S: TableGrant = { select: true };
const SI: TableGrant = { select: true, insert: true };

/** The tables that are append-only (a trigger forbids UPDATE, DELETE and TRUNCATE for everyone). The app gets SELECT and INSERT only. */
export const APPEND_ONLY_TABLES = ["ledger_entries", "payment_matches", "complaint_events", "classifications", "audit_log"] as const;

/**
 * Every table in the public schema and what the app may do with it. No table gets DELETE, TRUNCATE, REFERENCES or
 * TRIGGER. UPDATE is granted by column, and today only for sessions, one-time codes, three columns of payment attempts, four of bank rows, four of queue items and thirteen of complaints;
 * the other tables whose rows change get SELECT and INSERT now and their UPDATE columns when the feature
 * that writes them ships.
 */
export const PRIVILEGE_MATRIX: Readonly<Record<string, TableGrant>> = {
  // Reference data, seeded; there is no admin screen (D1).
  flats: S,
  flat_members: S,
  users: S,
  user_permissions: S,
  society_settings: S,
  complaint_categories: S,
  // Append-only.
  ledger_entries: SI,
  payment_matches: SI,
  complaint_events: SI,
  classifications: SI,
  audit_log: SI,
  // Written once, then read.
  bills: SI,
  statement_imports: SI,
  known_payers: SI,
  complaint_links: SI,
  complaint_affected: SI,
  // Rows that change: only the columns the code writes.
  sessions: { ...SI, updateColumns: ["last_seen_at", "revoked_at"] },
  otp_codes: { ...SI, updateColumns: ["attempts", "consumed_at"] },
  // The payment flow: an attempt is inserted, then moved to SUCCEEDED or FAILED by the signed webhook. Nothing else about it
  // may change (not its amount, bill, flat or reference). A row lock (SELECT ... FOR UPDATE) needs only a column UPDATE.
  payment_attempts: { ...SI, updateColumns: ["status", "debit_status", "resolved_at"] },
  // Statement import: a bank row is inserted QUEUED, then moved to AUTO_MATCHED with its flat and ledger entry. The narration, amounts,
  // dates and dedupe key of a row can never be changed by the app.
  bank_rows: { ...SI, updateColumns: ["state", "flat_id", "ledger_entry_id", "version"] },
  // Manual reconciliation: staff resolve a queue item (RESOLVED with who, when and why). What the item points at never changes.
  accounts_queue_items: { ...SI, updateColumns: ["status", "resolved_at", "resolved_by_id", "note"] },
  // Complaints: raised and classified once, then moved through their life cycle. Only these columns change; the text, flat, raiser, language,
  // safety flag and creation time of a complaint can never be changed by the app.
  complaints: {
    ...SI,
    updateColumns: ["status", "assignee_id", "category_id", "urgency", "response_due_at", "first_response_at", "pending_confirmation_at", "closed_at", "close_kind", "rating", "reopen_count", "needs_review", "version"],
  },
  // Feature not built yet: SELECT and INSERT now; UPDATE columns are added with the feature.
  outbox_jobs: SI,
  notifications: SI,
  visitor_passes: SI,
};

/** Tables the app must not touch at all. */
export const NO_ACCESS_TABLES = ["_prisma_migrations", "error_events"] as const;

const IDENTIFIER = /^[a-z][a-z0-9_]{2,40}$/;

function identifier(name: string, what: string): string {
  if (!IDENTIFIER.test(name)) throw new RangeError(`${what} must match ${IDENTIFIER.source}`);
  return `"${name}"`;
}

const quote = (name: string): string => `"${name}"`;
const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const knownTables = (): string[] => [...Object.keys(PRIVILEGE_MATRIX), ...NO_ACCESS_TABLES].sort();

function privilegeList(grant: TableGrant): string {
  return [grant.select ? "SELECT" : null, grant.insert ? "INSERT" : null].filter((p): p is string => p !== null).join(", ");
}

/** The statements, in order, as separate strings (so a test can read them one by one). */
export function buildAppRoleStatements({ appRole, ownerRole }: { appRole: string; ownerRole: string }): string[] {
  const app = identifier(appRole, "appRole");
  identifier(ownerRole, "ownerRole");
  if (appRole === ownerRole) throw new RangeError("appRole and ownerRole must be different roles");
  const statements: string[] = [];

  // 1. Refuse to run in the wrong place or with the wrong people.
  statements.push(`DO $guard$
DECLARE unknown_tables text;
BEGIN
  IF current_user <> ${literal(ownerRole)} THEN
    RAISE EXCEPTION 'Run this as the owner role ${ownerRole}, not as %', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(appRole)}) THEN
    RAISE EXCEPTION 'The role ${appRole} does not exist. Create it first with CREATE ROLE ... LOGIN and set its password (see docs/deployment-plan.md).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(appRole)} AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)) THEN
    RAISE EXCEPTION 'The role ${appRole} has administrator attributes; the app role must have none.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neon_superuser') AND pg_has_role(${literal(appRole)}, 'neon_superuser', 'member') THEN
    RAISE EXCEPTION 'The role ${appRole} is a member of neon_superuser (it was made in the Neon console, API or CLI). Drop it and create it with SQL.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner = ${literal(appRole)}) THEN
    RAISE EXCEPTION 'The role ${appRole} owns a table; the app role must not own any table.';
  END IF;
  SELECT string_agg(tablename, ', ' ORDER BY tablename) INTO unknown_tables
    FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN (${knownTables().map(literal).join(", ")});
  IF unknown_tables IS NOT NULL THEN
    RAISE EXCEPTION 'No privilege decision for table(s): %. Add them to PRIVILEGE_MATRIX in src/server/db-roles/app-role.ts.', unknown_tables;
  END IF;
END
$guard$;`);

  // 2. Start from nothing, so running this again removes anything the matrix no longer allows.
  statements.push(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${app};`);
  statements.push(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;`);
  statements.push(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;`);
  statements.push(`REVOKE CREATE ON SCHEMA public FROM ${app};`);

  // 3. The way in: connect to this database and see the schema, nothing more.
  statements.push(`DO $connect$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${app}', current_database()); END $connect$;`);
  statements.push(`GRANT USAGE ON SCHEMA public TO ${app};`);

  // 4. The matrix, one explicit grant per table (no default privileges: a table added later is invisible until it is added here).
  const bySignature = new Map<string, string[]>();
  for (const [table, grant] of Object.entries(PRIVILEGE_MATRIX)) {
    const list = privilegeList(grant);
    if (list !== "") bySignature.set(list, [...(bySignature.get(list) ?? []), table]);
  }
  for (const [list, tables] of bySignature) statements.push(`GRANT ${list} ON ${tables.map(quote).join(", ")} TO ${app};`);
  for (const [table, grant] of Object.entries(PRIVILEGE_MATRIX)) {
    if (grant.updateColumns && grant.updateColumns.length > 0) {
      statements.push(`GRANT UPDATE (${grant.updateColumns.map(quote).join(", ")}) ON ${quote(table)} TO ${app};`);
    }
  }
  return statements;
}

/** The whole script, ready to run as the owner. */
export function buildAppRoleSql(options: { appRole: string; ownerRole: string }): string {
  const header = `-- Grants for the application role "${options.appRole}", generated from src/server/db-roles/app-role.ts.
-- Run as the owner role "${options.ownerRole}". It creates no role and sets no password. Running it again is safe.
`;
  return `${header}${buildAppRoleStatements(options).join("\n\n")}\n`;
}

/** Tables that exist in the schema but have no decision in the matrix or the no-access list. A table added without deciding its privileges shows up here. */
export function undecidedTables(existing: readonly string[]): string[] {
  const known = new Set(knownTables());
  return existing.filter((table) => !known.has(table)).sort();
}

/** Tables the matrix names that do not exist in the schema (a renamed or dropped table that was not updated here). */
export function staleMatrixTables(existing: readonly string[]): string[] {
  const present = new Set(existing);
  return knownTables().filter((table) => !present.has(table));
}
