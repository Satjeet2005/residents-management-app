import { describe, expect, it } from "vitest";
import { processStatement } from "@/domain/matching/processor";
import { bill, flat } from "./builders";
import { inputOf } from "./processor-helpers";

const FLATS = [flat("T12-0408", { residents: ["Swati Joshi"], bills: [bill("sep", 637000n, "2026-09-10")] }), flat("T07-1203", { residents: ["Neeraj Kulkarni"] })];
const PAY = "2026-10-27,UPI/402200118877/T12 408/maint,6468,,";

describe("processStatement: ordering", () => {
  it("processes rows by date, then row number, whatever order they arrive in", () => {
    const input = inputOf(FLATS, ["2026-10-09,CASH DEP,100,,", "2026-10-02,CASH DEP,200,,", "2026-10-09,CASH DEP,300,,"]);
    const forward = processStatement(input);
    expect(forward.rows.map((r) => r.rowNumber)).toEqual([2, 1, 3]);
    const reversed = processStatement({ ...input, rows: [...input.rows].reverse() });
    expect(reversed).toEqual(forward);
  });
});

describe("processStatement: states", () => {
  it("maps a decision to a state and keeps the decision", () => {
    const result = processStatement(inputOf(FLATS, [PAY, "2026-10-27,UPI/402200118878/stranger@zzz,12.34,,", "2026-10-27,SMS CHARGES,,29.5,"]));
    expect(result.rows.map((r) => [r.state, r.decision?.kind])).toEqual([["AUTO_MATCHED", "AUTO_MATCH"], ["QUEUED", "QUEUE"], ["IGNORED", "IGNORE"]]);
  });

  it("lists the entries of automatic matches only, with idempotency keys", () => {
    const result = processStatement(inputOf(FLATS, [PAY, "2026-10-27,UPI/402200118878/stranger@zzz,12.34,,"]));
    expect(result.entriesToPost.map((e) => [e.rowNumber, e.flatCode, e.billKey, e.entryType, e.amountPaise, e.effectiveDate])).toEqual([
      [1, "T12-0408", "sep", "LATE_FEE", 9800n, "2026-10-27"],
      [1, "T12-0408", "sep", "PAYMENT", 646800n, "2026-10-27"],
    ]);
    const [fee, payment] = result.entriesToPost;
    expect(fee.idempotencyKey).toBe(`bank:${result.rows[0].dedupeKey}:LATE_FEE`);
    expect(payment.idempotencyKey).toBe(`bank:${result.rows[0].dedupeKey}:PAYMENT`);
  });
});

describe("processStatement: dedupe", () => {
  it("a row whose key an earlier import holds is ALREADY_IMPORTED, with no decision and no entries", () => {
    const first = processStatement(inputOf(FLATS, [PAY]));
    const again = processStatement(inputOf(FLATS, [PAY], new Set(first.rows.map((r) => r.dedupeKey))));
    expect(again.rows.map((r) => [r.state, r.decision])).toEqual([["ALREADY_IMPORTED", null]]);
    expect(again.entriesToPost).toEqual([]);
    expect(again.rows[0].dedupeKey).toBe(first.rows[0].dedupeKey);
  });

  it("two identical cash deposits in one file get two keys and both are processed", () => {
    const result = processStatement(inputOf(FLATS, ["2026-10-05,CASH DEP,5000,,100000", "2026-10-05,CASH DEP,5000,,100000"]));
    expect(result.rows.map((r) => r.state)).toEqual(["QUEUED", "QUEUED"]);
    expect(new Set(result.rows.map((r) => r.dedupeKey)).size).toBe(2);
  });

  it("the same payment reference twice in one file is one payment: the second is ALREADY_IMPORTED", () => {
    const result = processStatement(inputOf(FLATS, [PAY, PAY]));
    expect(result.rows.map((r) => r.state)).toEqual(["AUTO_MATCHED", "ALREADY_IMPORTED"]);
  });
});

describe("processStatement: summary", () => {
  it("counts every row once and adds up the credits", () => {
    const lines = [PAY, "2026-10-27,UPI/402200118878/stranger@zzz,12.34,,", "2026-10-27,SMS CHARGES,,29.5,", "not a date,CASH,5,,", "2026-10-27,CASH,abc,,"];
    const input = inputOf(FLATS, lines);
    const first = processStatement(input);
    const result = processStatement({ ...input, alreadyImportedKeys: new Set([first.rows[0].dedupeKey]) });
    expect(result.summary).toEqual({
      rowsRead: 5,
      validRows: 3,
      invalidRows: 2,
      autoMatched: 0,
      queued: 1,
      ignored: 1,
      alreadyImported: 1,
      creditTotalPaise: 646800n + 1234n,
      autoMatchedTotalPaise: 0n,
    });
  });

  it("reports invalid rows and never drops them", () => {
    const result = processStatement(inputOf(FLATS, ["bad,CASH,5,,", "bad,CASH,6,,"]));
    expect(result.rows).toEqual([]);
    expect(result.summary).toMatchObject({ rowsRead: 2, validRows: 0, invalidRows: 2 });
    expect(result.csvErrors.length).toBeGreaterThanOrEqual(2);
  });

  it("a file-level error (row 0) counts as one invalid item", () => {
    const result = processStatement({ ...inputOf(FLATS, []), csvErrors: [{ rowNumber: 0, column: "credit", message: "header: needs a credit column" }] });
    expect(result.summary).toMatchObject({ rowsRead: 1, invalidRows: 1 });
  });

  it("an automatic match adds to the auto total", () => {
    expect(processStatement(inputOf(FLATS, [PAY])).summary.autoMatchedTotalPaise).toBe(646800n);
  });
});
