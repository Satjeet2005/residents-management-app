import { describe, expect, it } from "vitest";
import { buildLogsRoleSql, buildLogsRoleStatements } from "@/server/db-roles/logs-role";

/** D135, D136: the generated grants of the read-only logs role. The real role is exercised in tests/integration/logs-role.test.ts. */

const OPTIONS = { logsRole: "township_logs", ownerRole: "neondb_owner" };
const statements = buildLogsRoleStatements(OPTIONS);
const grants = statements.filter((s) => s.startsWith("GRANT "));

describe("D135 buildLogsRoleSql", () => {
  it("grants CONNECT, USAGE on the schema and SELECT on error_events, and nothing else", () => {
    expect(grants).toEqual(['GRANT USAGE ON SCHEMA public TO "township_logs";', 'GRANT SELECT ON "error_events" TO "township_logs";']);
    expect(statements.some((s) => s.includes("GRANT CONNECT ON DATABASE"))).toBe(true);
  });

  it("no statement after the guard mentions INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES, CREATE ROLE, a password or PUBLIC grants", () => {
    const text = statements.slice(1).join("\n").replace(/REVOKE CREATE ON SCHEMA/g, ""); // the guard only names CREATE ROLE in its error message
    expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|TRIGGER|REFERENCES|PASSWORD|SUPERUSER)\b/i);
    expect(text).not.toMatch(/CREATE ROLE|ALTER ROLE|GRANT\s+[^;]*\bTO\s+PUBLIC|ALTER DEFAULT PRIVILEGES/i);
  });

  it("starts with a guard on the running role, the role's attributes, neon_superuser and ownership, and resets the role before the grants", () => {
    expect(statements[0]).toContain("current_user <> 'neondb_owner'");
    expect(statements[0]).toContain("rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication");
    expect(statements[0]).toContain("pg_has_role('township_logs', 'neon_superuser', 'member')");
    expect(statements[0]).toContain("owns a table");
    expect(statements.indexOf('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "township_logs";')).toBeGreaterThan(0);
    expect(statements.indexOf('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "township_logs";')).toBeLessThan(statements.findIndex((s) => s.startsWith("GRANT ")));
  });

  it.each(["", "ab", "Logs", "1logs", "logs-role", "logs;drop", 'logs"', "logs'x", "x".repeat(42)])("refuses %j as the role", (name) => {
    expect(() => buildLogsRoleSql({ logsRole: name, ownerRole: "neondb_owner" })).toThrow(RangeError);
  });

  it("refuses a bad owner and the same role as role and owner", () => {
    expect(() => buildLogsRoleSql({ logsRole: "township_logs", ownerRole: "Owner;" })).toThrow(RangeError);
    expect(() => buildLogsRoleSql({ logsRole: "same_role", ownerRole: "same_role" })).toThrow(/different/);
  });
});
