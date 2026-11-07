/**
 * The grants of the developer's READ-ONLY logs role (D135, D136), generated like the app role's (src/server/db-roles/app-role.ts): guards first, then
 * the grants. The role may CONNECT, see the schema (USAGE) and SELECT on error_events, and nothing else: it cannot read any other table, cannot
 * write, and, because it owns nothing, cannot disable a trigger. This module only builds SQL text. It never takes, builds or prints a password:
 * the human creates the role with SQL, never in the console, and sets its password there.
 */

const IDENTIFIER = /^[a-z][a-z0-9_]{2,40}$/;

function identifier(name: string, what: string): string {
  if (!IDENTIFIER.test(name)) throw new RangeError(`${what} must match ${IDENTIFIER.source}`);
  return `"${name}"`;
}

const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** The statements, in order, as separate strings (so a test can read them one by one). */
export function buildLogsRoleStatements({ logsRole, ownerRole }: { logsRole: string; ownerRole: string }): string[] {
  const reader = identifier(logsRole, "role");
  identifier(ownerRole, "owner");
  if (logsRole === ownerRole) throw new RangeError("role and owner must be different roles");
  return [
    `DO $guard$
BEGIN
  IF current_user <> ${literal(ownerRole)} THEN
    RAISE EXCEPTION 'Run this as the owner role ${ownerRole}, not as %', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(logsRole)}) THEN
    RAISE EXCEPTION 'The role ${logsRole} does not exist. Create it first with CREATE ROLE ... LOGIN and set its password (see docs/observability.md).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(logsRole)} AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)) THEN
    RAISE EXCEPTION 'The role ${logsRole} has administrator attributes; the logs role must have none.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neon_superuser') AND pg_has_role(${literal(logsRole)}, 'neon_superuser', 'member') THEN
    RAISE EXCEPTION 'The role ${logsRole} is a member of neon_superuser (it was made in the Neon console, API or CLI). Drop it and create it with SQL.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner = ${literal(logsRole)}) THEN
    RAISE EXCEPTION 'The role ${logsRole} owns a table; the logs role must not own any table.';
  END IF;
END
$guard$;`,
    // Start from nothing, so running this again removes anything it should not have.
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${reader};`,
    `REVOKE CREATE ON SCHEMA public FROM ${reader};`,
    `DO $connect$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${reader}', current_database()); END $connect$;`,
    `GRANT USAGE ON SCHEMA public TO ${reader};`,
    `GRANT SELECT ON "error_events" TO ${reader};`,
  ];
}

/** The whole script, ready to run as the owner. */
export function buildLogsRoleSql(options: { logsRole: string; ownerRole: string }): string {
  const header = `-- Grants for the READ-ONLY logs role "${options.logsRole}", generated from src/server/db-roles/logs-role.ts.
-- Run as the owner role "${options.ownerRole}". It creates no role and sets no password. Running it again is safe.
`;
  return `${header}${buildLogsRoleStatements(options).join("\n\n")}\n`;
}
