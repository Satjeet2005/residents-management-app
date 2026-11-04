import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SQLSTATE,
  connect,
  insertEntry,
  insertFlat,
  rejectedWith,
  uniqueRef,
} from "./db";

let db: Client;
let flatId: string;

beforeAll(async () => {
  db = await connect();
  flatId = await insertFlat(db);
});
afterAll(() => db.end());

describe("I1 ledger amount_paise > 0", () => {
  it.each([0, -1])("I1 rejects amount %i", async (amountPaise) => {
    await rejectedWith(
      insertEntry(db, flatId, { amountPaise }),
      SQLSTATE.checkViolation,
      "ledger_entries_amount_paise_positive",
    );
  });

  it("I1 accepts amount 1", async () => {
    await expect(insertEntry(db, flatId, { amountPaise: 1 })).resolves.toBeTypeOf("string");
  });
});

describe("I2 entry_type fixes direction", () => {
  it.each([
    ["BILL", "PAYMENT"],
    ["LATE_FEE", "PAYMENT"],
    ["PAYMENT", "CHARGE"],
  ])("I2 rejects %s with direction %s", async (entryType, direction) => {
    await rejectedWith(
      insertEntry(db, flatId, { entryType, direction }),
      SQLSTATE.checkViolation,
      "ledger_entries_type_direction",
    );
  });

  it.each([
    ["BILL", "CHARGE"],
    ["LATE_FEE", "CHARGE"],
    ["PAYMENT", "PAYMENT"],
  ])("I2 accepts %s with direction %s", async (entryType, direction) => {
    await expect(insertEntry(db, flatId, { entryType, direction })).resolves.toBeTypeOf("string");
  });

  it.each(["CHARGE", "PAYMENT"])("I2 accepts REVERSAL and ADJUSTMENT with direction %s", async (direction) => {
    const target = await insertEntry(db, flatId);
    await expect(
      insertEntry(db, flatId, { entryType: "REVERSAL", direction, reversesEntryId: target }),
    ).resolves.toBeTypeOf("string");
    await expect(
      insertEntry(db, flatId, { entryType: "ADJUSTMENT", direction, note: "correction" }),
    ).resolves.toBeTypeOf("string");
  });
});

describe("I3 ledger_entries is append-only", () => {
  it("I3 rejects UPDATE and leaves the row unchanged", async () => {
    const id = await insertEntry(db, flatId, { amountPaise: 5000 });
    await rejectedWith(
      db.query("UPDATE ledger_entries SET amount_paise = 1 WHERE id = $1", [id]),
      SQLSTATE.restrictViolation,
    );
    const { rows } = await db.query("SELECT amount_paise::text AS amount FROM ledger_entries WHERE id = $1", [id]);
    expect(rows[0].amount).toBe("5000");
  });

  it("I3 rejects DELETE and leaves the row in place", async () => {
    const id = await insertEntry(db, flatId);
    await rejectedWith(db.query("DELETE FROM ledger_entries WHERE id = $1", [id]), SQLSTATE.restrictViolation);
    const { rowCount } = await db.query("SELECT 1 FROM ledger_entries WHERE id = $1", [id]);
    expect(rowCount).toBe(1);
  });

  it("I3 rejects TRUNCATE, including through TRUNCATE ... CASCADE from a parent table", async () => {
    await rejectedWith(db.query("TRUNCATE ledger_entries"), SQLSTATE.restrictViolation);
    await rejectedWith(db.query("TRUNCATE flats CASCADE"), SQLSTATE.restrictViolation);
  });

  it("I3 still accepts INSERT (append)", async () => {
    await expect(insertEntry(db, flatId)).resolves.toBeTypeOf("string");
  });
});

describe("I4 idempotency_key unique; reference unique where not null", () => {
  it("I4 rejects a duplicate idempotency_key and accepts a distinct one", async () => {
    const idempotencyKey = uniqueRef("idem");
    await insertEntry(db, flatId, { idempotencyKey });
    await rejectedWith(
      insertEntry(db, flatId, { idempotencyKey }),
      SQLSTATE.uniqueViolation,
      "ledger_entries_idempotency_key_key",
    );
    await expect(insertEntry(db, flatId, { idempotencyKey: uniqueRef("idem") })).resolves.toBeTypeOf("string");
  });

  it("I4 rejects a duplicate reference but allows many NULL references", async () => {
    const reference = uniqueRef("UTR");
    await insertEntry(db, flatId, { entryType: "PAYMENT", direction: "PAYMENT", reference });
    await rejectedWith(
      insertEntry(db, flatId, { entryType: "PAYMENT", direction: "PAYMENT", reference }),
      SQLSTATE.uniqueViolation,
      "ledger_entries_reference_key",
    );
    await insertEntry(db, flatId, { reference: null });
    await expect(insertEntry(db, flatId, { reference: null })).resolves.toBeTypeOf("string");
  });
});

describe("I5 reversals and adjustments", () => {
  it("I5 rejects a REVERSAL without reverses_entry_id and accepts one with it", async () => {
    await rejectedWith(
      insertEntry(db, flatId, { entryType: "REVERSAL" }),
      SQLSTATE.checkViolation,
      "ledger_entries_reversal_has_target",
    );
    const target = await insertEntry(db, flatId);
    await expect(
      insertEntry(db, flatId, { entryType: "REVERSAL", direction: "PAYMENT", reversesEntryId: target }),
    ).resolves.toBeTypeOf("string");
  });

  it("I5 rejects reversing the same entry twice", async () => {
    const target = await insertEntry(db, flatId);
    await insertEntry(db, flatId, { entryType: "REVERSAL", direction: "PAYMENT", reversesEntryId: target });
    await rejectedWith(
      insertEntry(db, flatId, { entryType: "REVERSAL", direction: "PAYMENT", reversesEntryId: target }),
      SQLSTATE.uniqueViolation,
      "ledger_entries_reverses_entry_id_key",
    );
  });

  it.each([null, "", "   "])("I5 rejects an ADJUSTMENT with note %j", async (note) => {
    await rejectedWith(
      insertEntry(db, flatId, { entryType: "ADJUSTMENT", note }),
      SQLSTATE.checkViolation,
      "ledger_entries_adjustment_has_note",
    );
  });

  it("I5 accepts an ADJUSTMENT with a note", async () => {
    await expect(
      insertEntry(db, flatId, { entryType: "ADJUSTMENT", note: "waived by committee" }),
    ).resolves.toBeTypeOf("string");
  });
});
