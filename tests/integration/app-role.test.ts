import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APPEND_ONLY_TABLES, NO_ACCESS_TABLES, PRIVILEGE_MATRIX, buildAppRoleStatements } from "@/server/db-roles/app-role";
import { SQLSTATE, connect, insertBill, insertComplaint, insertFlat, insertRow, insertUser } from "./db";
import { createAppRole, sqlState, type TestAppRole } from "./app-role-helpers";

let owner: Client;
let app: Client;
let role: TestAppRole;
let flatId: string;
let userId: string;
const DENIED = SQLSTATE.insufficientPrivilege;

beforeAll(async () => {
  owner = await connect();
  role = await createAppRole(owner);
  app = await role.open();
  flatId = await insertFlat(owner);
  userId = await insertUser(owner);
});
afterAll(async () => {
  await app?.end();
  if (role) await role.drop();
  await owner?.end();
});

const tables = Object.keys(PRIVILEGE_MATRIX);
const uuid = () => crypto.randomUUID();

describe("D95 the app role is an ordinary login role", () => {
  it("D95 it is not a superuser, cannot create roles or databases, and bypasses no security", async () => {
    const { rows } = await owner.query("SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication FROM pg_roles WHERE rolname = $1", [role.name]);
    expect(rows[0]).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, rolreplication: false });
    expect((await app.query("SELECT current_user")).rows[0].current_user).toBe(role.name);
  });

  it("D95 it owns no table: every table is owned by the owner role", async () => {
    const { rows } = await owner.query("SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'");
    expect(rows.map((r) => r.tableowner)).toEqual([role.ownerRole]);
  });
});

describe("D95 what the app role may do", () => {
  it("D95 INSERT into ledger_entries, audit_log and complaint_events", async () => {
    await app.query(
      `INSERT INTO ledger_entries (flat_id, entry_type, direction, amount_paise, effective_date, idempotency_key)
       VALUES ($1, 'BILL', 'CHARGE', 1000, '2026-04-01', $2)`,
      [flatId, `idem-${uuid()}`],
    );
    await app.query("INSERT INTO audit_log (action, entity_type, entity_id) VALUES ('TEST', 'auth', 'unknown')");
    const complaintId = await insertComplaint(owner, flatId, userId);
    await app.query("INSERT INTO complaint_events (complaint_id, event_type) VALUES ($1, 'COMMENT')", [complaintId]);
  });

  it("D95 payment attempts: INSERT, SELECT ... FOR UPDATE, and UPDATE of status, debit_status and resolved_at only; INSERT on accounts_queue_items", async () => {
    const billId = await insertBill(owner, flatId);
    const attemptId = await insertRow(app, "payment_attempts", { bill_id: billId, flat_id: flatId, amount_paise: 1000, status: "INITIATED", gateway_reference: `MOCK-${uuid()}` });
    await app.query("BEGIN");
    await app.query("SELECT id FROM payment_attempts WHERE id = $1 FOR UPDATE", [attemptId]);
    await app.query("UPDATE payment_attempts SET status = 'SUCCEEDED', debit_status = 'CONFIRMED', resolved_at = now() WHERE id = $1", [attemptId]);
    await app.query("COMMIT");
    await insertRow(app, "accounts_queue_items", { item_type: "EXCEPTION", payment_attempt_id: attemptId, note: "test" });
    const { rows } = await owner.query("SELECT status, debit_status FROM payment_attempts WHERE id = $1", [attemptId]);
    expect(rows[0]).toEqual({ status: "SUCCEEDED", debit_status: "CONFIRMED" });
  });

  it("D95 payment attempts: every other column is read-only for the app (amount, bill, flat, reference, start time, resolver), and there is no DELETE", async () => {
    for (const column of ["amount_paise", "bill_id", "flat_id", "gateway_reference", "started_at", "resolved_by_id", "release_reason", "escalated_at", "hold_started_at"]) {
      expect(await sqlState(app.query(`UPDATE payment_attempts SET ${column} = ${column} WHERE false`)), column).toBe(DENIED);
    }
    expect(await sqlState(app.query("DELETE FROM payment_attempts WHERE false"))).toBe(DENIED);
  });

  it("D95 statement import: INSERT statement_imports, bank_rows, payment_matches and queue items; UPDATE of a bank row's state, flat, ledger entry and version only", async () => {
    const importId = await insertRow(app, "statement_imports", { uploaded_by_id: userId, filename: "s.csv", file_sha256: uuid(), rows_read: 1 });
    const rowId = await insertRow(app, "bank_rows", { import_id: importId, row_number: 1, txn_date: "2026-10-27", narration_raw: "x", credit_paise: 1000, dedupe_key: `k-${uuid()}` });
    const billId = await insertBill(owner, flatId, "2026-05-01");
    const entryId = await insertRow(app, "ledger_entries", { flat_id: flatId, entry_type: "PAYMENT", direction: "PAYMENT", amount_paise: 1000, effective_date: "2026-10-27", bill_id: billId, bank_row_id: rowId, idempotency_key: `i-${uuid()}` });
    await app.query("UPDATE bank_rows SET state = 'AUTO_MATCHED', flat_id = $2, ledger_entry_id = $3, version = version + 1 WHERE id = $1", [rowId, flatId, entryId]);
    await insertRow(app, "payment_matches", { bank_row_id: rowId, decision: "AUTO", flat_id: flatId, score: 90 });
    await insertRow(app, "accounts_queue_items", { item_type: "BANK_ROW", bank_row_id: (await insertRow(app, "bank_rows", { import_id: importId, row_number: 2, txn_date: "2026-10-27", narration_raw: "y", credit_paise: 5, dedupe_key: `k-${uuid()}` })) });
    expect((await owner.query("SELECT state, version FROM bank_rows WHERE id = $1", [rowId])).rows[0]).toEqual({ state: "AUTO_MATCHED", version: 2 });
  });

  it("D95 bank rows: the narration, amounts, dates, dedupe key and import are read-only for the app, and payment matches cannot be changed or deleted", async () => {
    for (const column of ["narration_raw", "credit_paise", "debit_paise", "balance_paise", "txn_date", "value_date", "dedupe_key", "import_id", "row_number", "parsed"]) {
      expect(await sqlState(app.query(`UPDATE bank_rows SET ${column} = ${column} WHERE false`)), column).toBe(DENIED);
    }
    expect(await sqlState(app.query("DELETE FROM bank_rows WHERE false"))).toBe(DENIED);
    expect(await sqlState(app.query("UPDATE payment_matches SET score = 1 WHERE false"))).toBe(DENIED);
    expect(await sqlState(app.query("DELETE FROM statement_imports WHERE false"))).toBe(DENIED);
  });

  it("D95 SELECT on every table the matrix gives SELECT", async () => {
    for (const [table, grant] of Object.entries(PRIVILEGE_MATRIX)) {
      if (grant.select) await app.query(`SELECT 1 FROM "${table}" LIMIT 1`);
    }
  });

  it("D95 UPDATE of last_seen_at and revoked_at on sessions, and of attempts and consumed_at on otp_codes", async () => {
    const sessionId = await insertRow(owner, "sessions", { user_id: userId, token_hash: `h-${uuid()}`, expires_at: "2030-01-01T00:00:00Z", last_seen_at: "2026-01-01T00:00:00Z" });
    await app.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [sessionId]);
    await app.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [sessionId]);
    const codeId = await insertRow(owner, "otp_codes", { phone: "5000000001", code_hash: "x", expires_at: "2030-01-01T00:00:00Z" });
    await app.query("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1 AND attempts < 5", [codeId]);
    await app.query("UPDATE otp_codes SET consumed_at = now() WHERE id = $1", [codeId]);
  });

  it("D95 the privileges it holds are exactly the matrix, read back from Postgres for every table and privilege", async () => {
    for (const table of tables) {
      const grant = PRIVILEGE_MATRIX[table];
      const has = async (privilege: string) =>
        (await owner.query("SELECT has_table_privilege($1, $2, $3) AS ok", [role.name, table, privilege])).rows[0].ok as boolean;
      const hasColumn = async () =>
        (await owner.query("SELECT has_any_column_privilege($1, $2, 'UPDATE') AS ok", [role.name, table])).rows[0].ok as boolean;
      expect(await has("SELECT"), `${table} SELECT`).toBe(grant.select === true);
      expect(await has("INSERT"), `${table} INSERT`).toBe(grant.insert === true);
      expect(await has("UPDATE"), `${table} table-level UPDATE`).toBe(false);
      expect(await hasColumn(), `${table} column-level UPDATE`).toBe((grant.updateColumns?.length ?? 0) > 0);
      for (const privilege of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) expect(await has(privilege), `${table} ${privilege}`).toBe(false);
    }
    for (const table of NO_ACCESS_TABLES) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        expect((await owner.query("SELECT has_table_privilege($1, $2, $3) AS ok", [role.name, table, privilege])).rows[0].ok, `${table} ${privilege}`).toBe(false);
      }
    }
  });
});

describe("D95 what the app role may not do (permission denied, SQLSTATE 42501)", () => {
  it.each(APPEND_ONLY_TABLES)("D95 %s: UPDATE, DELETE and TRUNCATE are denied", async (table) => {
    expect(await sqlState(app.query(`UPDATE "${table}" SET id = id WHERE false`))).toBe(DENIED);
    expect(await sqlState(app.query(`DELETE FROM "${table}" WHERE false`))).toBe(DENIED);
    expect(await sqlState(app.query(`TRUNCATE "${table}"`))).toBe(DENIED);
  });

  it("D95 ALTER TABLE ledger_entries DISABLE TRIGGER ALL is denied", async () => {
    expect(await sqlState(app.query("ALTER TABLE ledger_entries DISABLE TRIGGER ALL"))).toBe(DENIED);
    expect(await sqlState(app.query("ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_no_update_delete"))).toBe(DENIED);
  });

  it("D95 DROP TRIGGER is denied", async () => {
    expect(await sqlState(app.query("DROP TRIGGER ledger_entries_no_update_delete ON ledger_entries"))).toBe(DENIED);
  });

  it("D95 the triggers are still enabled afterwards", async () => {
    const { rows } = await owner.query("SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'ledger_entries'::regclass AND NOT tgisinternal ORDER BY tgname");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) expect(row.tgenabled, row.tgname).toBe("O");
  });

  it("D95 CREATE TABLE in the schema, DROP TABLE and CREATE ROLE are denied", async () => {
    expect(await sqlState(app.query("CREATE TABLE app_made_this (a int)"))).toBe(DENIED);
    expect(await sqlState(app.query("DROP TABLE ledger_entries"))).toBe(DENIED);
    expect(await sqlState(app.query("DROP TABLE audit_log"))).toBe(DENIED);
    expect(await sqlState(app.query("CREATE ROLE app_made_role"))).toBe(DENIED);
    expect(await sqlState(app.query("CREATE SCHEMA app_made_schema"))).toBe(DENIED);
  });

  it("D95 an UPDATE of an ungranted column is denied: sessions.expires_at and user_id, otp_codes.code_hash and expires_at", async () => {
    expect(await sqlState(app.query("UPDATE sessions SET expires_at = now() WHERE false"))).toBe(DENIED);
    expect(await sqlState(app.query("UPDATE sessions SET user_id = user_id WHERE false"))).toBe(DENIED);
    expect(await sqlState(app.query("UPDATE otp_codes SET code_hash = 'x' WHERE false"))).toBe(DENIED);
    expect(await sqlState(app.query("UPDATE otp_codes SET expires_at = now() WHERE false"))).toBe(DENIED);
    expect(await sqlState(app.query("UPDATE users SET active = false WHERE false"))).toBe(DENIED);
  });

  it("D95 _prisma_migrations cannot be read or written", async () => {
    expect(await sqlState(app.query("SELECT * FROM _prisma_migrations"))).toBe(DENIED);
    expect(await sqlState(app.query("DELETE FROM _prisma_migrations WHERE false"))).toBe(DENIED);
    expect(await sqlState(app.query("INSERT INTO _prisma_migrations (id, checksum, migration_name) VALUES ('a', 'b', 'c')"))).toBe(DENIED);
  });

  it("D95 SET session_replication_role = replica is denied, so triggers cannot be skipped that way", async () => {
    expect(await sqlState(app.query("SET session_replication_role = replica"))).toBe(DENIED);
    expect((await app.query("SHOW session_replication_role")).rows[0].session_replication_role).toBe("origin");
  });

  it("D95 DELETE and TRUNCATE are denied on every table, and INSERT on the read-only ones", async () => {
    for (const table of tables) {
      expect(await sqlState(app.query(`DELETE FROM "${table}" WHERE false`)), `${table} DELETE`).toBe(DENIED);
      expect(await sqlState(app.query(`TRUNCATE "${table}"`)), `${table} TRUNCATE`).toBe(DENIED);
      if (PRIVILEGE_MATRIX[table].insert !== true) {
        expect(await sqlState(app.query(`INSERT INTO "${table}" DEFAULT VALUES`)), `${table} INSERT`).toBe(DENIED);
      }
    }
  });

  it("D95 an UPDATE of any column of a table with no UPDATE grant is denied (every table but sessions and otp_codes)", async () => {
    const { rows } = await owner.query<{ table_name: string; column_name: string }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND ordinal_position = 1",
    );
    const firstColumn = new Map(rows.map((r) => [r.table_name, r.column_name]));
    for (const table of tables.filter((t) => t !== "sessions" && t !== "otp_codes")) {
      const column = firstColumn.get(table);
      expect(column, `${table} has a first column`).toBeDefined();
      expect(await sqlState(app.query(`UPDATE "${table}" SET "${column}" = "${column}" WHERE false`)), `${table} UPDATE`).toBe(DENIED);
    }
  });
});

describe("D95 the grants script protects itself and can be run again", () => {
  it("D95 run as the app role it refuses (it must run as the owner)", async () => {
    const error = await app.query(role.sql).then(() => null, (e: Error) => e);
    expect(error?.message).toContain("Run this as the owner role");
  });

  it("D95 it refuses when the app role does not exist", async () => {
    const missing = buildAppRoleStatements({ appRole: "no_such_role_x", ownerRole: role.ownerRole })[0];
    const error = await owner.query(missing).then(() => null, (e: Error) => e);
    expect(error?.message).toContain("does not exist");
  });

  it("D95 it refuses when a table has no privilege decision, naming the table (and leaves nothing behind)", async () => {
    await owner.query("BEGIN");
    try {
      await owner.query("CREATE TABLE zz_undecided_table (id int)");
      const error = await owner.query(buildAppRoleStatements({ appRole: role.name, ownerRole: role.ownerRole })[0]).then(() => null, (e: Error) => e);
      expect(error?.message).toContain("No privilege decision");
      expect(error?.message).toContain("zz_undecided_table");
    } finally {
      await owner.query("ROLLBACK");
    }
    expect((await owner.query("SELECT to_regclass('public.zz_undecided_table') AS t")).rows[0].t).toBeNull();
  });

  it("D95 running it twice is fine, and running it again takes back a privilege that was added by hand", async () => {
    await owner.query(`GRANT DELETE ON ledger_entries TO "${role.name}"`);
    await owner.query(`GRANT UPDATE ON audit_log TO "${role.name}"`);
    expect(await sqlState(app.query("DELETE FROM ledger_entries WHERE false"))).toBeNull();
    await owner.query(role.sql);
    await owner.query(role.sql);
    expect(await sqlState(app.query("DELETE FROM ledger_entries WHERE false"))).toBe(DENIED);
    expect(await sqlState(app.query("UPDATE audit_log SET id = id WHERE false"))).toBe(DENIED);
    expect(await sqlState(app.query("UPDATE sessions SET last_seen_at = now() WHERE false"))).toBeNull();
  });
});
