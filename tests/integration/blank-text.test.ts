import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SQLSTATE,
  connect,
  insertAttempt,
  insertBankRow,
  insertBill,
  insertComplaint,
  insertEntry,
  insertFlat,
  insertImport,
  insertKnownPayer,
  insertMatch,
  insertQueueItem,
  insertRow,
  insertUser,
  rejectedWith,
  uniqueRef,
} from "./db";

let db: Client;
let flatId: string;
let userId: string;
let bankRowId: string;
let billCount = 0;

beforeAll(async () => {
  db = await connect();
  flatId = await insertFlat(db);
  userId = await insertUser(db);
  bankRowId = await insertBankRow(db, await insertImport(db, userId));
});
afterAll(() => db.end());

// btrim() trims only spaces, so these used to pass "not blank" checks.
const BLANKS = ["\t", "\n", "\t\n", " \r\n ", "\u000b\f"];
const TEXT = "a real reason";
const newBill = () => insertBill(db, flatId, `${2050 + billCount++}-01-01`);

describe("not-blank checks treat tabs and newlines as blank", () => {
  it.each(BLANKS)("ledger ADJUSTMENT note %s is rejected", async (note) => {
    await rejectedWith(
      insertEntry(db, flatId, { entryType: "ADJUSTMENT", note }),
      SQLSTATE.checkViolation,
      "ledger_entries_adjustment_has_note",
    );
  });

  it.each(BLANKS)("RELEASED payment attempt release_reason %s is rejected", async (releaseReason) => {
    await rejectedWith(
      insertAttempt(db, await newBill(), flatId, { status: "RELEASED", releaseReason }),
      SQLSTATE.checkViolation,
      "payment_attempts_released_has_reason",
    );
  });

  it.each(BLANKS)("payment_matches human decision reason %s is rejected", async (reason) => {
    await rejectedWith(
      insertMatch(db, bankRowId, { decision: "MANUAL", decidedById: userId, reason }),
      SQLSTATE.checkViolation,
      "payment_matches_human_decision_has_actor_and_reason",
    );
  });

  it.each(BLANKS)("RESOLVED accounts queue note %s is rejected", async (note) => {
    await rejectedWith(
      insertQueueItem(db, {
        itemType: "BANK_ROW",
        bankRowId: await insertBankRow(db, await insertImport(db, userId)),
        status: "RESOLVED",
        resolvedAt: "2026-04-06T10:00:00Z",
        resolvedById: userId,
        note,
      }),
      SQLSTATE.checkViolation,
      "accounts_queue_items_resolved_has_who_when_why",
    );
  });

  it.each(BLANKS)("known_payers identifier_value %s is rejected", async (value) => {
    await rejectedWith(
      insertKnownPayer(db, flatId, "NAME", value),
      SQLSTATE.checkViolation,
      "known_payers_identifier_not_blank",
    );
  });

  it.each(BLANKS)("complaints body %s is rejected", async (body) => {
    await rejectedWith(
      insertComplaint(db, flatId, userId, { body }),
      SQLSTATE.checkViolation,
      "complaints_body_not_blank",
    );
  });

  it.each(BLANKS)("visitor_passes visitor_name %s is rejected", async (visitor_name) => {
    await rejectedWith(
      insertRow(db, "visitor_passes", { flat_id: flatId, visitor_name, expected_at: "2026-04-10T09:00:00Z" }),
      SQLSTATE.checkViolation,
      "visitor_passes_name_not_blank",
    );
  });
});

describe("not-blank checks still accept real text, including text with surrounding whitespace", () => {
  it("accepts a real value in every checked column", async () => {
    const padded = `\t ${TEXT}\n`;
    await expect(insertEntry(db, flatId, { entryType: "ADJUSTMENT", note: padded })).resolves.toBeTypeOf("string");
    await expect(
      insertAttempt(db, await newBill(), flatId, { status: "RELEASED", releaseReason: padded }),
    ).resolves.toBeTypeOf("string");
    await expect(
      insertMatch(db, bankRowId, { decision: "MANUAL", decidedById: userId, reason: padded }),
    ).resolves.toBeTypeOf("string");
    await expect(insertKnownPayer(db, flatId, "NAME", uniqueRef(padded))).resolves.toBeTypeOf("string");
    await expect(insertComplaint(db, flatId, userId, { body: padded })).resolves.toBeTypeOf("string");
    await expect(
      insertRow(db, "visitor_passes", { flat_id: flatId, visitor_name: padded, expected_at: "2026-04-10T09:00:00Z" }),
    ).resolves.toBeTypeOf("string");
  });

  it("keeps the NULL guards: a NULL note on an ADJUSTMENT and a NULL reason on a MANUAL decision are rejected", async () => {
    await rejectedWith(
      insertEntry(db, flatId, { entryType: "ADJUSTMENT", note: null }),
      SQLSTATE.checkViolation,
      "ledger_entries_adjustment_has_note",
    );
    await rejectedWith(
      insertMatch(db, bankRowId, { decision: "MANUAL", decidedById: userId, reason: null }),
      SQLSTATE.checkViolation,
      "payment_matches_human_decision_has_actor_and_reason",
    );
  });
});
