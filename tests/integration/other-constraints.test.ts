import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SQLSTATE, connect, insertAttempt, insertBill, insertEntry, insertFlat, insertUser, rejectedWith, uniqueRef } from "./db";

let db: Client;
let flatId: string;
let userId: string;

beforeAll(async () => {
  db = await connect();
  flatId = await insertFlat(db);
  userId = await insertUser(db);
});
afterAll(() => db.end());

const MISSING_ID = "00000000-0000-0000-0000-000000000000";

describe("I8 uniques", () => {
  it("I8 flats.code is unique", async () => {
    const code = uniqueRef("T");
    const insert = () => db.query("INSERT INTO flats (code, tower, number, area_sqft) VALUES ($1, 'T1', '1', 500)", [code]);
    await insert();
    await rejectedWith(insert(), SQLSTATE.uniqueViolation, "flats_code_key");
  });

  it("I8 users.phone is unique", async () => {
    const phone = uniqueRef("+91");
    const insert = () => db.query("INSERT INTO users (phone, name, role) VALUES ($1, 'A', 'STAFF')", [phone]);
    await insert();
    await rejectedWith(insert(), SQLSTATE.uniqueViolation, "users_phone_key");
  });

  it("I8 flat_members is unique on (flat_id, user_id, starts_on)", async () => {
    const insert = (startsOn: string) =>
      db.query("INSERT INTO flat_members (flat_id, user_id, relation, starts_on) VALUES ($1, $2, 'OWNER', $3)", [flatId, userId, startsOn]);
    await insert("2026-01-01");
    await rejectedWith(insert("2026-01-01"), SQLSTATE.uniqueViolation, "flat_members_flat_id_user_id_starts_on_key");
    await expect(insert("2027-01-01")).resolves.toBeDefined();
  });

  it("I8 user_permissions is unique on (user_id, permission)", async () => {
    const insert = (permission: string) =>
      db.query("INSERT INTO user_permissions (user_id, permission) VALUES ($1, $2)", [userId, permission]);
    await insert("bills.read");
    await rejectedWith(insert("bills.read"), SQLSTATE.uniqueViolation, "user_permissions_user_id_permission_key");
    await expect(insert("bills.write")).resolves.toBeDefined();
  });

  it("I8 sessions.token_hash is unique", async () => {
    const tokenHash = uniqueRef("hash");
    const insert = () =>
      db.query("INSERT INTO sessions (user_id, token_hash, expires_at, last_seen_at) VALUES ($1, $2, now(), now())", [userId, tokenHash]);
    await insert();
    await rejectedWith(insert(), SQLSTATE.uniqueViolation, "sessions_token_hash_key");
  });

  it("I8 bills is unique on (flat_id, period)", async () => {
    await insertBill(db, flatId, "2031-01-01");
    await rejectedWith(insertBill(db, flatId, "2031-01-01"), SQLSTATE.uniqueViolation, "bills_flat_id_period_key");
    await expect(insertBill(db, flatId, "2031-02-01")).resolves.toBeTypeOf("string");
  });

  it("I8 society_settings.key is unique", async () => {
    const key = uniqueRef("late_fee_rate");
    const insert = () => db.query("INSERT INTO society_settings (key, value) VALUES ($1, '12'::jsonb)", [key]);
    await insert();
    await rejectedWith(insert(), SQLSTATE.uniqueViolation, "society_settings_pkey");
  });
});

describe("I8 value checks", () => {
  it("I8 flats.area_sqft must be > 0", async () => {
    await rejectedWith(
      db.query("INSERT INTO flats (code, tower, number, area_sqft) VALUES ($1, 'T1', '1', 0)", [uniqueRef("T")]),
      SQLSTATE.checkViolation,
      "flats_area_sqft_positive",
    );
  });

  it("I8 bills.amount_paise must be > 0", async () => {
    await rejectedWith(
      db.query(
        `INSERT INTO bills (flat_id, period, issued_on, due_on, amount_paise, area_sqft_snapshot, rate_paise_per_sqft)
         VALUES ($1, '2032-01-01', '2032-01-01', '2032-01-10', 0, 1000, 250)`,
        [flatId],
      ),
      SQLSTATE.checkViolation,
      "bills_amount_paise_positive",
    );
  });

  it("I8 bills.due_on must not be before issued_on", async () => {
    const insert = (dueOn: string) =>
      db.query(
        `INSERT INTO bills (flat_id, period, issued_on, due_on, amount_paise, area_sqft_snapshot, rate_paise_per_sqft)
         VALUES ($1, '2032-02-01', '2032-02-05', $2, 250000, 1000, 250)`,
        [flatId, dueOn],
      );
    await rejectedWith(insert("2032-02-04"), SQLSTATE.checkViolation, "bills_due_on_not_before_issued_on");
    await expect(insert("2032-02-05")).resolves.toBeDefined();
  });

  it("I8 bills.period must be the first of a month", async () => {
    await rejectedWith(insertBill(db, flatId, "2032-03-15"), SQLSTATE.checkViolation, "bills_period_is_first_of_month");
  });

  it("I8 payment_attempts.amount_paise must be > 0", async () => {
    const billId = await insertBill(db, flatId, "2032-04-01");
    await rejectedWith(
      insertAttempt(db, billId, flatId, { amountPaise: 0 }),
      SQLSTATE.checkViolation,
      "payment_attempts_amount_paise_positive",
    );
  });
});

describe("I8 foreign keys", () => {
  it("I8 ledger_entries rejects an unknown flat_id", async () => {
    await rejectedWith(insertEntry(db, MISSING_ID), SQLSTATE.foreignKeyViolation, "ledger_entries_flat_id_fkey");
  });

  it("I8 ledger_entries rejects an unknown bill_id, payment_attempt_id and reverses_entry_id", async () => {
    const insert = (column: string) =>
      db.query(
        `INSERT INTO ledger_entries (flat_id, entry_type, direction, amount_paise, effective_date, idempotency_key, ${column})
         VALUES ($1, 'BILL', 'CHARGE', 100, '2026-04-01', $2, $3)`,
        [flatId, uniqueRef("idem"), MISSING_ID],
      );
    await rejectedWith(insert("bill_id"), SQLSTATE.foreignKeyViolation, "ledger_entries_bill_id_fkey");
    await rejectedWith(insert("payment_attempt_id"), SQLSTATE.foreignKeyViolation, "ledger_entries_payment_attempt_id_fkey");
    await rejectedWith(insert("reverses_entry_id"), SQLSTATE.foreignKeyViolation, "ledger_entries_reverses_entry_id_fkey");
  });

  it("I8 payment_attempts rejects an unknown bill_id", async () => {
    await rejectedWith(insertAttempt(db, MISSING_ID, flatId), SQLSTATE.foreignKeyViolation, "payment_attempts_bill_id_fkey");
  });

  it("I8 ledger_entries.bank_row_id references bank_rows (added with the bank statement schema)", async () => {
    await rejectedWith(
      insertEntry(db, flatId, { entryType: "PAYMENT", direction: "PAYMENT", bankRowId: MISSING_ID }),
      SQLSTATE.foreignKeyViolation,
      "ledger_entries_bank_row_id_fkey",
    );
  });

  it("I8 a bill with an attempt cannot be deleted (RESTRICT)", async () => {
    const billId = await insertBill(db, flatId, "2033-01-01");
    await insertAttempt(db, billId, flatId);
    await rejectedWith(db.query("DELETE FROM bills WHERE id = $1", [billId]), SQLSTATE.foreignKeyViolation, "payment_attempts_bill_id_fkey");
  });
});
