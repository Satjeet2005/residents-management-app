import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SQLSTATE,
  connect,
  insertAttempt,
  insertBankRow,
  insertBill,
  insertFlat,
  insertImport,
  insertRow,
  insertUser,
  rejectedWith,
  uniqueRef,
} from "./db";

let db: Client;
let userId: string;
let importId: string;

beforeAll(async () => {
  db = await connect();
  userId = await insertUser(db);
  importId = await insertImport(db, userId);
});
afterAll(() => db.end());

const accepted = (id: Promise<string>) => expect(id).resolves.toBeTypeOf("string");

/** A ledger entry with explicit links; the type is chosen to satisfy I2. */
const entry = (flatId: string, links: Record<string, unknown> = {}) =>
  insertRow(db, "ledger_entries", {
    flat_id: flatId,
    entry_type: "PAYMENT",
    direction: "PAYMENT",
    amount_paise: 1000,
    effective_date: "2026-04-01",
    idempotency_key: uniqueRef("idem"),
    ...links,
  });

describe("L1 payment_attempts (bill_id, flat_id) -> bills (id, flat_id)", () => {
  it("L1 rejects an attempt whose flat differs from its bill's flat", async () => {
    const [flatA, flatB] = [await insertFlat(db), await insertFlat(db)];
    const billOfA = await insertBill(db, flatA);
    await rejectedWith(
      insertAttempt(db, billOfA, flatB),
      SQLSTATE.foreignKeyViolation,
      "payment_attempts_bill_id_flat_id_fkey",
    );
  });

  it("L1 rejects moving an existing attempt to another flat", async () => {
    const [flatA, flatB] = [await insertFlat(db), await insertFlat(db)];
    const attemptId = await insertAttempt(db, await insertBill(db, flatA), flatA);
    await rejectedWith(
      db.query("UPDATE payment_attempts SET flat_id = $2 WHERE id = $1", [attemptId, flatB]),
      SQLSTATE.foreignKeyViolation,
      "payment_attempts_bill_id_flat_id_fkey",
    );
  });

  it("L1 accepts an attempt in the same flat as its bill", async () => {
    const flatA = await insertFlat(db);
    await accepted(insertAttempt(db, await insertBill(db, flatA), flatA));
  });
});

describe("L1 ledger_entries (bill_id, flat_id) -> bills (id, flat_id)", () => {
  it("L1 rejects an entry whose flat differs from its bill's flat", async () => {
    const [flatA, flatB] = [await insertFlat(db), await insertFlat(db)];
    const billOfA = await insertBill(db, flatA);
    await rejectedWith(
      entry(flatB, { entry_type: "BILL", direction: "CHARGE", bill_id: billOfA }),
      SQLSTATE.foreignKeyViolation,
      "ledger_entries_bill_id_flat_id_fkey",
    );
  });

  it("L1 accepts an entry in the same flat as its bill", async () => {
    const flatA = await insertFlat(db);
    await accepted(entry(flatA, { entry_type: "BILL", direction: "CHARGE", bill_id: await insertBill(db, flatA) }));
  });

  it("L1 NULL case: an entry with no bill_id skips the check and is accepted", async () => {
    await accepted(entry(await insertFlat(db), { bill_id: null }));
  });
});

describe("L1 ledger_entries (payment_attempt_id, flat_id) -> payment_attempts (id, flat_id)", () => {
  it("L1 rejects an entry whose flat differs from its payment attempt's flat", async () => {
    const [flatA, flatB] = [await insertFlat(db), await insertFlat(db)];
    const attemptOfA = await insertAttempt(db, await insertBill(db, flatA), flatA);
    await rejectedWith(
      entry(flatB, { payment_attempt_id: attemptOfA }),
      SQLSTATE.foreignKeyViolation,
      "ledger_entries_payment_attempt_id_flat_id_fkey",
    );
  });

  it("L1 accepts an entry in the same flat as its payment attempt", async () => {
    const flatA = await insertFlat(db);
    const attemptId = await insertAttempt(db, await insertBill(db, flatA), flatA);
    await accepted(entry(flatA, { payment_attempt_id: attemptId }));
  });

  it("L1 NULL case: an entry with no payment_attempt_id skips the check and is accepted", async () => {
    await accepted(entry(await insertFlat(db), { payment_attempt_id: null }));
  });
});

describe("L1 bank_rows (ledger_entry_id, flat_id) -> ledger_entries (id, flat_id)", () => {
  it("L1 rejects a matched bank row whose flat differs from its ledger entry's flat", async () => {
    const [flatA, flatB] = [await insertFlat(db), await insertFlat(db)];
    const entryOfA = await entry(flatA);
    await rejectedWith(
      insertBankRow(db, importId, { state: "AUTO_MATCHED", flatId: flatB, ledgerEntryId: entryOfA }),
      SQLSTATE.foreignKeyViolation,
      "bank_rows_ledger_entry_id_flat_id_fkey",
    );
  });

  it("L1 rejects matching an existing bank row to an entry of another flat", async () => {
    const [flatA, flatB] = [await insertFlat(db), await insertFlat(db)];
    const rowId = await insertBankRow(db, importId, { flatId: flatA });
    const entryOfB = await entry(flatB);
    await rejectedWith(
      db.query("UPDATE bank_rows SET state = 'MANUALLY_MATCHED', ledger_entry_id = $2 WHERE id = $1", [rowId, entryOfB]),
      SQLSTATE.foreignKeyViolation,
      "bank_rows_ledger_entry_id_flat_id_fkey",
    );
  });

  it("L1 accepts a matched bank row in the same flat as its ledger entry", async () => {
    const flatA = await insertFlat(db);
    await accepted(
      insertBankRow(db, importId, { state: "AUTO_MATCHED", flatId: flatA, ledgerEntryId: await entry(flatA) }),
    );
  });

  it("L1 NULL case: a QUEUED row with a flat but no ledger entry skips the check and is accepted", async () => {
    await accepted(insertBankRow(db, importId, { state: "QUEUED", flatId: await insertFlat(db) }));
  });

  it("L1 a matched row cannot dodge the composite check with a NULL: J3 requires flat_id and ledger_entry_id", async () => {
    const flatA = await insertFlat(db);
    const entryOfA = await entry(flatA);
    await rejectedWith(
      insertBankRow(db, importId, { state: "AUTO_MATCHED", flatId: null, ledgerEntryId: entryOfA }),
      SQLSTATE.checkViolation,
      "bank_rows_state_matches_links",
    );
    await rejectedWith(
      insertBankRow(db, importId, { state: "MANUALLY_MATCHED", flatId: flatA, ledgerEntryId: null }),
      SQLSTATE.checkViolation,
      "bank_rows_state_matches_links",
    );
  });
});
