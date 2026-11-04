import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SQLSTATE,
  connect,
  insertBankRow,
  insertEntry,
  insertFlat,
  insertImport,
  insertUser,
  rejectedWith,
  uniqueRef,
} from "./db";

let db: Client;
let flatId: string;
let userId: string;
let importId: string;

beforeAll(async () => {
  db = await connect();
  flatId = await insertFlat(db);
  userId = await insertUser(db);
  importId = await insertImport(db, userId);
});
afterAll(() => db.end());

describe("J1 bank_rows.dedupe_key unique; unique(import_id, row_number)", () => {
  it("J1 rejects a duplicate dedupe_key and accepts a distinct one", async () => {
    const dedupeKey = uniqueRef("dedupe");
    await insertBankRow(db, importId, { dedupeKey });
    await rejectedWith(
      insertBankRow(db, importId, { dedupeKey }),
      SQLSTATE.uniqueViolation,
      "bank_rows_dedupe_key_key",
    );
    await expect(insertBankRow(db, importId)).resolves.toBeTypeOf("string");
  });

  it("J1 rejects a duplicate (import_id, row_number); the same row_number in another import is accepted", async () => {
    const rowNumber = 90_001;
    await insertBankRow(db, importId, { rowNumber });
    await rejectedWith(
      insertBankRow(db, importId, { rowNumber }),
      SQLSTATE.uniqueViolation,
      "bank_rows_import_id_row_number_key",
    );
    const otherImport = await insertImport(db, userId);
    await expect(insertBankRow(db, otherImport, { rowNumber })).resolves.toBeTypeOf("string");
  });
});

describe("J2 exactly one of credit_paise and debit_paise is positive; both >= 0", () => {
  it.each([
    ["both positive", { creditPaise: 100, debitPaise: 100 }],
    ["both zero", { creditPaise: 0, debitPaise: 0 }],
    ["a negative credit", { creditPaise: -5, debitPaise: 10 }],
    ["a negative debit", { creditPaise: 10, debitPaise: -5 }],
  ])("J2 rejects %s", async (_label, amounts) => {
    await rejectedWith(
      insertBankRow(db, importId, amounts),
      SQLSTATE.checkViolation,
      "bank_rows_exactly_one_side_positive",
    );
  });

  it("J2 accepts a credit-only row and a debit-only row", async () => {
    await expect(insertBankRow(db, importId, { creditPaise: 250000, debitPaise: 0 })).resolves.toBeTypeOf("string");
    await expect(insertBankRow(db, importId, { creditPaise: 0, debitPaise: 4200 })).resolves.toBeTypeOf("string");
  });
});

describe("J3 state requires or forbids flat_id and ledger_entry_id", () => {
  it.each(["QUEUED", "AWAITING_APPROVAL", "IGNORED"])(
    "J3 %s requires ledger_entry_id to be null (flat_id is free)",
    async (state) => {
      const entryId = await insertEntry(db, flatId, { entryType: "PAYMENT", direction: "PAYMENT" });
      await rejectedWith(
        insertBankRow(db, importId, { state, flatId, ledgerEntryId: entryId }),
        SQLSTATE.checkViolation,
        "bank_rows_state_matches_links",
      );
      await expect(insertBankRow(db, importId, { state })).resolves.toBeTypeOf("string");
      await expect(insertBankRow(db, importId, { state, flatId })).resolves.toBeTypeOf("string");
    },
  );

  it.each(["AUTO_MATCHED", "MANUALLY_MATCHED"])(
    "J3 %s requires both flat_id and ledger_entry_id",
    async (state) => {
      const entryId = await insertEntry(db, flatId, { entryType: "PAYMENT", direction: "PAYMENT" });
      const rejected = (flat: string | null, entry: string | null) =>
        rejectedWith(
          insertBankRow(db, importId, { state, flatId: flat, ledgerEntryId: entry }),
          SQLSTATE.checkViolation,
          "bank_rows_state_matches_links",
        );
      await rejected(null, null);
      await rejected(flatId, null);
      await rejected(null, entryId);
      await expect(insertBankRow(db, importId, { state, flatId, ledgerEntryId: entryId })).resolves.toBeTypeOf(
        "string",
      );
    },
  );

  it("J3 is enforced on UPDATE: a QUEUED row cannot become matched without a ledger entry", async () => {
    const rowId = await insertBankRow(db, importId);
    await rejectedWith(
      db.query("UPDATE bank_rows SET state = 'AUTO_MATCHED', flat_id = $2 WHERE id = $1", [rowId, flatId]),
      SQLSTATE.checkViolation,
      "bank_rows_state_matches_links",
    );
    const entryId = await insertEntry(db, flatId, { entryType: "PAYMENT", direction: "PAYMENT", bankRowId: rowId });
    await expect(
      db.query("UPDATE bank_rows SET state = 'AUTO_MATCHED', flat_id = $2, ledger_entry_id = $3 WHERE id = $1", [
        rowId,
        flatId,
        entryId,
      ]),
    ).resolves.toBeDefined();
  });
});

describe("J6 a bank row can fund at most one PAYMENT ledger entry", () => {
  it("J6 rejects a second PAYMENT entry for the same bank row", async () => {
    const rowId = await insertBankRow(db, importId);
    await insertEntry(db, flatId, { entryType: "PAYMENT", direction: "PAYMENT", bankRowId: rowId });
    await rejectedWith(
      insertEntry(db, flatId, { entryType: "PAYMENT", direction: "PAYMENT", bankRowId: rowId }),
      SQLSTATE.uniqueViolation,
      "ledger_entries_one_payment_per_bank_row",
    );
  });

  it("J6 still allows a REVERSAL that references the same bank row", async () => {
    const rowId = await insertBankRow(db, importId);
    const paymentId = await insertEntry(db, flatId, { entryType: "PAYMENT", direction: "PAYMENT", bankRowId: rowId });
    await expect(
      insertEntry(db, flatId, {
        entryType: "REVERSAL",
        direction: "CHARGE",
        reversesEntryId: paymentId,
        bankRowId: rowId,
      }),
    ).resolves.toBeTypeOf("string");
  });

  it("J6 allows one PAYMENT per bank row across different rows, and many entries without a bank row", async () => {
    const [rowA, rowB] = [await insertBankRow(db, importId), await insertBankRow(db, importId)];
    await insertEntry(db, flatId, { entryType: "PAYMENT", direction: "PAYMENT", bankRowId: rowA });
    await expect(
      insertEntry(db, flatId, { entryType: "PAYMENT", direction: "PAYMENT", bankRowId: rowB }),
    ).resolves.toBeTypeOf("string");
    await insertEntry(db, flatId, { entryType: "PAYMENT", direction: "PAYMENT" });
    await expect(insertEntry(db, flatId, { entryType: "PAYMENT", direction: "PAYMENT" })).resolves.toBeTypeOf("string");
  });
});
