import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SQLSTATE, connect, insertBankRow, insertImport, insertMatch, insertUser, rejectedWith } from "./db";

let db: Client;
let rowId: string;
let maker: string;
let checker: string;

beforeAll(async () => {
  db = await connect();
  maker = await insertUser(db);
  checker = await insertUser(db);
  rowId = await insertBankRow(db, await insertImport(db, maker));
});
afterAll(() => db.end());

const HUMAN_DECISIONS = ["MANUAL", "REQUEST_APPROVAL", "APPROVED", "REJECTED", "IGNORE", "UNDO"];

describe("J4 payment_matches is append-only", () => {
  it("J4 rejects UPDATE and leaves the row unchanged", async () => {
    const id = await insertMatch(db, rowId);
    await rejectedWith(
      db.query("UPDATE payment_matches SET score = 99 WHERE id = $1", [id]),
      SQLSTATE.restrictViolation,
    );
    const { rows } = await db.query("SELECT score FROM payment_matches WHERE id = $1", [id]);
    expect(rows[0].score).toBeNull();
  });

  it("J4 rejects DELETE and leaves the row in place", async () => {
    const id = await insertMatch(db, rowId);
    await rejectedWith(db.query("DELETE FROM payment_matches WHERE id = $1", [id]), SQLSTATE.restrictViolation);
    const { rowCount } = await db.query("SELECT 1 FROM payment_matches WHERE id = $1", [id]);
    expect(rowCount).toBe(1);
  });

  it("J4 rejects TRUNCATE, including through TRUNCATE ... CASCADE from bank_rows", async () => {
    await rejectedWith(db.query("TRUNCATE payment_matches"), SQLSTATE.restrictViolation);
    await rejectedWith(db.query("TRUNCATE bank_rows CASCADE"), SQLSTATE.restrictViolation);
  });

  it("J4 still accepts INSERT (append)", async () => {
    await expect(insertMatch(db, rowId)).resolves.toBeTypeOf("string");
  });
});

describe("J5 maker-checker and honesty", () => {
  it.each(HUMAN_DECISIONS)("J5 %s requires decided_by_id", async (decision) => {
    await rejectedWith(
      insertMatch(db, rowId, { decision, decidedById: null, reason: "checked the statement" }),
      SQLSTATE.checkViolation,
      "payment_matches_human_decision_has_actor_and_reason",
    );
  });

  it.each(HUMAN_DECISIONS)("J5 %s requires a non-blank reason", async (decision) => {
    for (const reason of [null, "", "   "]) {
      await rejectedWith(
        insertMatch(db, rowId, { decision, decidedById: maker, reason }),
        SQLSTATE.checkViolation,
        "payment_matches_human_decision_has_actor_and_reason",
      );
    }
    await expect(insertMatch(db, rowId, { decision, decidedById: maker, reason: "checked the statement" })).resolves.toBeTypeOf(
      "string",
    );
  });

  it("J5 AUTO has no human actor and needs no reason", async () => {
    await rejectedWith(
      insertMatch(db, rowId, { decision: "AUTO", decidedById: maker }),
      SQLSTATE.checkViolation,
      "payment_matches_auto_has_no_actor",
    );
    await expect(insertMatch(db, rowId, { decision: "AUTO" })).resolves.toBeTypeOf("string");
  });

  it("J5 the approver must differ from the decider", async () => {
    await rejectedWith(
      insertMatch(db, rowId, { decision: "APPROVED", decidedById: maker, approverId: maker, reason: "second look" }),
      SQLSTATE.checkViolation,
      "payment_matches_approver_differs",
    );
    await expect(
      insertMatch(db, rowId, { decision: "APPROVED", decidedById: maker, approverId: checker, reason: "second look" }),
    ).resolves.toBeTypeOf("string");
  });

  it("J5 a decision may name no approver", async () => {
    await expect(
      insertMatch(db, rowId, { decision: "REQUEST_APPROVAL", decidedById: maker, reason: "amount over 25,000" }),
    ).resolves.toBeTypeOf("string");
  });
});
