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
  insertKnownPayer,
  insertQueueItem,
  insertUser,
  rejectedWith,
  uniqueRef,
} from "./db";

let db: Client;
let flatId: string;
let userId: string;
let importId: string;
let billCount = 0;

beforeAll(async () => {
  db = await connect();
  flatId = await insertFlat(db);
  userId = await insertUser(db);
  importId = await insertImport(db, userId);
});
afterAll(() => db.end());

const newRow = () => insertBankRow(db, importId);

async function newAttempt() {
  const n = billCount++;
  const billId = await insertBill(db, flatId, `${2040 + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`);
  return insertAttempt(db, billId, flatId);
}

describe("J7 accounts_queue_items references", () => {
  it("J7 UNRESOLVED_PAYMENT needs exactly a payment attempt", async () => {
    const [rowId, attemptId] = [await newRow(), await newAttempt()];
    const constraint = "accounts_queue_items_reference_matches_type";
    await rejectedWith(insertQueueItem(db, { itemType: "UNRESOLVED_PAYMENT" }), SQLSTATE.checkViolation, constraint);
    await rejectedWith(
      insertQueueItem(db, { itemType: "UNRESOLVED_PAYMENT", bankRowId: rowId }),
      SQLSTATE.checkViolation,
      constraint,
    );
    await rejectedWith(
      insertQueueItem(db, { itemType: "UNRESOLVED_PAYMENT", bankRowId: rowId, paymentAttemptId: attemptId }),
      SQLSTATE.checkViolation,
      constraint,
    );
    await expect(insertQueueItem(db, { itemType: "UNRESOLVED_PAYMENT", paymentAttemptId: attemptId })).resolves.toBeTypeOf(
      "string",
    );
  });

  it("J7 BANK_ROW needs exactly a bank row", async () => {
    const [rowId, attemptId] = [await newRow(), await newAttempt()];
    const constraint = "accounts_queue_items_reference_matches_type";
    await rejectedWith(insertQueueItem(db, { itemType: "BANK_ROW" }), SQLSTATE.checkViolation, constraint);
    await rejectedWith(
      insertQueueItem(db, { itemType: "BANK_ROW", paymentAttemptId: attemptId }),
      SQLSTATE.checkViolation,
      constraint,
    );
    await rejectedWith(
      insertQueueItem(db, { itemType: "BANK_ROW", bankRowId: rowId, paymentAttemptId: attemptId }),
      SQLSTATE.checkViolation,
      constraint,
    );
    await expect(insertQueueItem(db, { itemType: "BANK_ROW", bankRowId: rowId })).resolves.toBeTypeOf("string");
  });

  it("J7 EXCEPTION may reference either a bank row or a payment attempt", async () => {
    await expect(insertQueueItem(db, { itemType: "EXCEPTION", bankRowId: await newRow() })).resolves.toBeTypeOf("string");
    await expect(
      insertQueueItem(db, { itemType: "EXCEPTION", paymentAttemptId: await newAttempt() }),
    ).resolves.toBeTypeOf("string");
  });
});

describe("J7 at most one OPEN item per bank row and per payment attempt", () => {
  it("J7 rejects a second OPEN item for the same bank row, even of another type", async () => {
    const rowId = await newRow();
    await insertQueueItem(db, { itemType: "BANK_ROW", bankRowId: rowId });
    await rejectedWith(
      insertQueueItem(db, { itemType: "BANK_ROW", bankRowId: rowId }),
      SQLSTATE.uniqueViolation,
      "accounts_queue_items_one_open_per_bank_row",
    );
    await rejectedWith(
      insertQueueItem(db, { itemType: "EXCEPTION", bankRowId: rowId }),
      SQLSTATE.uniqueViolation,
      "accounts_queue_items_one_open_per_bank_row",
    );
  });

  it("J7 rejects a second OPEN item for the same payment attempt", async () => {
    const attemptId = await newAttempt();
    await insertQueueItem(db, { itemType: "UNRESOLVED_PAYMENT", paymentAttemptId: attemptId });
    await rejectedWith(
      insertQueueItem(db, { itemType: "EXCEPTION", paymentAttemptId: attemptId }),
      SQLSTATE.uniqueViolation,
      "accounts_queue_items_one_open_per_payment_attempt",
    );
  });

  it("J7 allows a new OPEN item once the previous one is RESOLVED", async () => {
    const rowId = await newRow();
    const first = await insertQueueItem(db, { itemType: "BANK_ROW", bankRowId: rowId });
    await db.query(
      "UPDATE accounts_queue_items SET status = 'RESOLVED', resolved_at = now(), resolved_by_id = $2, note = 'matched manually' WHERE id = $1",
      [first, userId],
    );
    await expect(insertQueueItem(db, { itemType: "BANK_ROW", bankRowId: rowId })).resolves.toBeTypeOf("string");
  });
});

describe("J7 RESOLVED requires resolved_at, resolved_by_id and a non-blank note", () => {
  const resolved = (rowId: string, overrides: { resolvedAt?: string | null; resolvedById?: string | null; note?: string | null }) =>
    insertQueueItem(db, {
      itemType: "BANK_ROW",
      bankRowId: rowId,
      status: "RESOLVED",
      resolvedAt: "2026-04-06T10:00:00Z",
      resolvedById: userId,
      note: "matched manually",
      ...overrides,
    });

  it.each([
    ["resolved_at", { resolvedAt: null }],
    ["resolved_by_id", { resolvedById: null }],
    ["a note", { note: null }],
    ["a non-blank note", { note: "   " }],
  ])("J7 rejects RESOLVED without %s", async (_label, overrides) => {
    await rejectedWith(
      resolved(await newRow(), overrides),
      SQLSTATE.checkViolation,
      "accounts_queue_items_resolved_has_who_when_why",
    );
  });

  it("J7 accepts RESOLVED with all three", async () => {
    await expect(resolved(await newRow(), {})).resolves.toBeTypeOf("string");
  });
});

describe("J8 known_payers", () => {
  it.each(["", "   "])("J8 rejects a blank identifier_value %j", async (value) => {
    await rejectedWith(
      insertKnownPayer(db, flatId, "UPI_ID", value),
      SQLSTATE.checkViolation,
      "known_payers_identifier_not_blank",
    );
  });

  it("J8 is unique on (identifier_type, identifier_value, flat_id)", async () => {
    const value = uniqueRef("fake.payer@upi");
    await insertKnownPayer(db, flatId, "UPI_ID", value);
    await rejectedWith(
      insertKnownPayer(db, flatId, "UPI_ID", value),
      SQLSTATE.uniqueViolation,
      "known_payers_identifier_type_identifier_value_flat_id_key",
    );
  });

  it("J8 allows the same value for another flat or another identifier type", async () => {
    const value = uniqueRef("FAKE PAYER");
    await insertKnownPayer(db, flatId, "NAME", value);
    await expect(insertKnownPayer(db, await insertFlat(db), "NAME", value)).resolves.toBeTypeOf("string");
    await expect(insertKnownPayer(db, flatId, "UPI_ID", value)).resolves.toBeTypeOf("string");
  });
});
