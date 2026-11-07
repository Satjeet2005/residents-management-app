import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildLogsRoleSql } from "@/server/db-roles/logs-role";
import { SQLSTATE, connect } from "./db";
import { createLogsRole, sqlState, type TestAppRole } from "./app-role-helpers";

/** D135, D136: the generated read-only logs role, as a real Postgres role. It reads error_events and nothing else. */

let owner: Client;
let reader: Client;
let role: TestAppRole;
let tables: string[];
const DENIED = SQLSTATE.insufficientPrivilege;

beforeAll(async () => {
  owner = await connect();
  role = await createLogsRole(owner);
  reader = await role.open();
  tables = (await owner.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map((r) => r.tablename);
});
afterAll(async () => {
  await reader?.end();
  if (role) await role.drop();
  await owner?.end();
});

describe("D135 the logs role", () => {
  it("is an ordinary login role with no administrator attribute, and owns no table", async () => {
    const { rows } = await owner.query("SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication FROM pg_roles WHERE rolname = $1", [role.name]);
    expect(rows[0]).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, rolreplication: false });
    expect((await owner.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = $1", [role.name])).rows[0].n).toBe(0);
  });

  it("can SELECT error_events, by column and as a count", async () => {
    await owner.query("INSERT INTO error_events (ref, level, source, route, error_name, message, environment, fingerprint) VALUES ('E-LOGROL', 'WARN', 'TEST', '/logs-role', 'Error', 'm', 'test', 'f')");
    expect((await reader.query("SELECT message FROM error_events WHERE ref = 'E-LOGROL'")).rows).toEqual([{ message: "m" }]);
    expect((await reader.query("SELECT count(*)::int AS n FROM error_events")).rows[0].n).toBeGreaterThan(0);
  });

  it("cannot read any other table: every one of them is denied", async () => {
    for (const table of tables.filter((t) => t !== "error_events")) {
      expect(await sqlState(reader.query(`SELECT 1 FROM "${table}" LIMIT 1`)), table).toBe(DENIED);
    }
    expect(await sqlState(reader.query("SELECT * FROM _prisma_migrations"))).toBe(DENIED);
  });

  it("cannot write: INSERT, UPDATE, DELETE and TRUNCATE on error_events are denied, and so is any write elsewhere", async () => {
    const insert = "INSERT INTO error_events (ref, level, source, route, error_name, message, environment, fingerprint) VALUES ('E-LOGBAD', 'WARN', 'TEST', '/x', 'Error', 'm', 'test', 'f')";
    expect(await sqlState(reader.query(insert))).toBe(DENIED);
    expect(await sqlState(reader.query("UPDATE error_events SET message = 'x'"))).toBe(DENIED);
    expect(await sqlState(reader.query("DELETE FROM error_events"))).toBe(DENIED);
    expect(await sqlState(reader.query("TRUNCATE error_events"))).toBe(DENIED);
    expect(await sqlState(reader.query("INSERT INTO audit_log (action, entity_type, entity_id) VALUES ('X', 'auth', 'u')"))).toBe(DENIED);
    expect(await sqlState(reader.query("CREATE TABLE logs_made_this (a int)"))).toBe(DENIED);
  });

  it("cannot disable triggers or drop them", async () => {
    expect(await sqlState(reader.query("ALTER TABLE error_events DISABLE TRIGGER ALL"))).toBe(DENIED);
    expect(await sqlState(reader.query("ALTER TABLE ledger_entries DISABLE TRIGGER ALL"))).toBe(DENIED);
    expect(await sqlState(reader.query("SET session_replication_role = replica"))).toBe(DENIED);
  });

  it("holds exactly SELECT on error_events and no privilege at all on any other table, read back from Postgres", async () => {
    for (const table of tables) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        const { rows } = await owner.query("SELECT has_table_privilege($1, $2, $3) AS ok", [role.name, table, privilege]);
        expect(rows[0].ok, `${table} ${privilege}`).toBe(table === "error_events" && privilege === "SELECT");
      }
      expect((await owner.query("SELECT has_any_column_privilege($1, $2, 'UPDATE') AS ok", [role.name, table])).rows[0].ok, `${table} column UPDATE`).toBe(false);
    }
  });

  it("running the grants again is safe and changes nothing", async () => {
    await owner.query(role.sql);
    expect((await owner.query("SELECT has_table_privilege($1, 'error_events', 'SELECT') AS ok", [role.name])).rows[0].ok).toBe(true);
    expect((await owner.query("SELECT has_table_privilege($1, 'users', 'SELECT') AS ok", [role.name])).rows[0].ok).toBe(false);
  });
});

describe("D135 the guards of the generated SQL", () => {
  it("refuse to run as the wrong role", async () => {
    const wrong = buildLogsRoleSql({ logsRole: role.name, ownerRole: "not_the_owner" });
    expect(await sqlState(owner.query(wrong))).toBe("P0001");
  });

  it("refuse a role that does not exist", async () => {
    expect(await sqlState(owner.query(buildLogsRoleSql({ logsRole: "app_t_missing_role", ownerRole: role.ownerRole })))).toBe("P0001");
  });

  it("refuse a role with an administrator attribute", async () => {
    const admin = "app_t_logs_admin";
    await owner.query(`DROP ROLE IF EXISTS "${admin}"`);
    await owner.query(`CREATE ROLE "${admin}" LOGIN CREATEDB`);
    try {
      expect(await sqlState(owner.query(buildLogsRoleSql({ logsRole: admin, ownerRole: role.ownerRole })))).toBe("P0001");
    } finally {
      await owner.query(`DROP ROLE IF EXISTS "${admin}"`);
    }
  });
});
