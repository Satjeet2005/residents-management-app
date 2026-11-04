import type { Client } from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";
import { SQLSTATE, connect, rejectedWith } from "./db";

let db: Client;

beforeAll(async () => {
  db = await connect();
});
afterAll(() => db.end());

// Postgres refuses a multi-table TRUNCATE without CASCADE unless every table
// that references a listed table is listed too. That foreign-key rule (0A000)
// runs before any trigger, so the statements below are chosen to show which
// guard stops them.
describe("TRUNCATE of several tables is rejected", () => {
  it("ledger_entries with bank_rows alone is stopped by the foreign-key rule, not the trigger", async () => {
    await rejectedWith(db.query("TRUNCATE ledger_entries, bank_rows"), SQLSTATE.featureNotSupported);
  });

  it("payment_matches with bank_rows alone is stopped by the foreign-key rule, not the trigger", async () => {
    await rejectedWith(db.query("TRUNCATE payment_matches, bank_rows"), SQLSTATE.featureNotSupported);
  });

  it("ledger_entries with every table that references it or bank_rows (no CASCADE) reaches the ledger trigger", async () => {
    await rejectedWith(
      db.query("TRUNCATE ledger_entries, bank_rows, payment_matches, accounts_queue_items"),
      SQLSTATE.restrictViolation,
      undefined,
      "ledger_entries is append-only",
    );
  });

  it("payment_matches with an unrelated table is rejected by the payment_matches trigger", async () => {
    await rejectedWith(
      db.query("TRUNCATE payment_matches, known_payers"),
      SQLSTATE.restrictViolation,
      undefined,
      "payment_matches is append-only",
    );
  });

  it.each(["complaint_events", "classifications", "audit_log"])(
    "%s with an unrelated table is rejected by its own trigger",
    async (table) => {
      await rejectedWith(
        db.query(`TRUNCATE ${table}, known_payers`),
        SQLSTATE.restrictViolation,
        undefined,
        `${table} is append-only`,
      );
    },
  );

  it("the complaint tables together (no CASCADE) reach an append-only trigger", async () => {
    await rejectedWith(
      db.query("TRUNCATE complaints, complaint_events, classifications, complaint_links, complaint_affected"),
      SQLSTATE.restrictViolation,
      undefined,
      "is append-only",
    );
  });
});
