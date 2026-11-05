import { describe, expect, it } from "vitest";
import { evaluate } from "@/domain/matching/benchmark/evaluate";
import type { Truth, TruthRow } from "@/domain/matching/benchmark/truth";
import { processStatement } from "@/domain/matching/processor";
import { bill, flat } from "../builders";
import { inputOf } from "../processor-helpers";

// All four flats owe the same amount, so a code alone never auto-posts (M4j). Three of them have a known UPI id.
const owing = (code: string, key: string, name: string, upi: string[] = []) => flat(code, { residents: [name], upi, bills: [bill(key, 637000n, "2026-09-10")] });
const FLATS = [
  owing("T12-0408", "k12", "Swati Joshi", ["swati@demo"]),
  owing("T07-1203", "k07", "Neeraj Kulkarni", ["neeraj@demo"]),
  owing("T15-0902", "k15", "Rohit Deshmukh", ["rohit@demo"]),
  owing("T01-0101", "k01", "Amit Rao"),
];

const pays = (flatCode: string, key: string): Truth => ({ kind: "PAYS_BILL", flatCode, billKeys: [key] });
const none: Truth = { kind: "NOT_MAINTENANCE", flatCode: null, billKeys: [] };

// Ten rows, all on 2026-10-27. Each pays 6468.00 where an amount is not given: the amount due on a 637000 bill 47 days late.
const ROWS: [string, Truth][] = [
  ["UPI/402200118801/swati@demo/T12 408/maint,6468,,", pays("T12-0408", "k12")], // 1 AUTO, right flat and bill: a true auto-post
  ["UPI/402200118802/neeraj@demo/T07 1203,6468,,", pays("T01-0101", "k01")], // 2 AUTO to the flat the narration names, but the money is T01-0101's: false
  ["UPI/402200118803/rohit@demo/T15 902,6468,,", { kind: "ADVANCE", flatCode: "T15-0902", billKeys: [] }], // 3 AUTO of a payment that is an advance: false
  ["NEFT-N30112345604-AMIT RAO-maint,6468,,", pays("T01-0101", "k01")], // 4 queued; the true flat is the top candidate
  ["UPI/402200118805/stranger@zzz,12.34,,", pays("T12-0408", "k12")], // 5 queued with no candidate
  ["SMS CHARGES,,29.50,", none], // 6 ignored, rightly
  ["INT.PD 01-07-2026 TO 30-09-2026,1200,,", pays("T12-0408", "k12")], // 7 ignored, but it was a bill payment
  ["UPI/402200118808/friend@zzz/gift,777,,", none], // 8 queued, not maintenance
  ["CHQ RET 123456,,5000,", { kind: "RETURN", flatCode: null, billKeys: [] }], // 9 queued, rightly
  ["UPI/402200118810/stranger@zzz,13.34,,", pays("T12-0408", "k12")], // 10 queued with no candidate
];

function run() {
  const processed = processStatement(inputOf(FLATS, ROWS.map(([line]) => `2026-10-27,${line}`)));
  const truth: TruthRow[] = ROWS.map(([, t], i) => ({ rowNumber: i + 1, truth: t }));
  const narrations = new Map(processed.rows.map((r) => [r.rowNumber, ROWS[r.rowNumber - 1][0]]));
  return { processed, truth, metrics: evaluate(processed, truth, narrations) };
}

describe("evaluate: definitions", () => {
  const { metrics: m } = run();

  it("counts the states", () => {
    expect(m).toMatchObject({ rows: 10, credits: 8, autoMatched: 3, queued: 5, ignored: 2, alreadyImported: 0, accounted: true });
  });

  it("a false auto-post is a wrong flat, or a truth that is not PAYS_BILL", () => {
    expect(m.trueAuto).toBe(1);
    expect(m.falseAuto).toBe(2);
    expect(m.falseAutoRows.map((r) => [r.rowNumber, r.truthKind, r.truthFlat, r.decidedFlat])).toEqual([
      [2, "PAYS_BILL", "T01-0101", "T07-1203"],
      [3, "ADVANCE", "T15-0902", "T15-0902"],
    ]);
    expect(m.falseAutoRows[0].narration).toBe("UPI/402200118802/neeraj@demo/T07 1203,6468,,");
    expect(m.falseAutoRows[0].reasons).toEqual(["CODE_FOUND", "PAYER_KNOWN", "AMOUNT_EQUALS_DUE"]);
  });

  it("matchable, precision, recall and the rates", () => {
    expect(m.matchable).toBe(6);
    expect(m.precision).toBeCloseTo(1 / 3, 10);
    expect(m.recall).toBeCloseTo(1 / 6, 10);
    expect(m.autoRate).toBeCloseTo(3 / 8, 10);
    expect(m.queueRate).toBeCloseTo(4 / 8, 10);
  });

  it("top1 and top5 look at the queued rows whose truth is PAYS_BILL", () => {
    // Rows 4, 5 and 10: only row 4 lists the true flat.
    expect(m.top1).toBeCloseTo(1 / 3, 10);
    expect(m.top5).toBeCloseTo(1 / 3, 10);
  });

  it("money wrongly ignored, and work made for a person", () => {
    expect(m.wrongIgnores).toBe(1);
    expect(m.notMaintenanceNotIgnored).toBe(1);
  });

  it("counts queue reasons once per queued row", () => {
    expect(m.queueReasons.NO_MATCH).toBe(3);
    expect(m.queueReasons.CHEQUE_RETURN).toBe(1);
  });

  it("lists the most frequent outcomes that are not ideal, most frequent first", () => {
    expect(m.confusions[0]).toEqual({ truth: "PAYS_BILL", decision: "QUEUED/NONE", count: 2 });
    const rest = m.confusions.slice(1).map((c) => `${c.truth} ${c.decision}`);
    expect(rest).toEqual(["ADVANCE AUTO_MATCHED", "NOT_MAINTENANCE QUEUED/NONE", "PAYS_BILL AUTO_MATCHED", "PAYS_BILL IGNORED", "PAYS_BILL QUEUED/LOW"]);
    // The true auto-post, the ignored non-maintenance row and the queued cheque return are the ideal outcomes.
    expect(m.confusions.reduce((n, c) => n + c.count, 0)).toBe(7);
  });
});

describe("evaluate: edges", () => {
  it("a statement with nothing to score has precision 1 and rates of 1 where nothing could go wrong", () => {
    const m = evaluate(processStatement(inputOf(FLATS, [])), []);
    expect(m).toMatchObject({ rows: 0, credits: 0, trueAuto: 0, falseAuto: 0, precision: 1, recall: 1, top1: 1, top5: 1, accounted: true, confusions: [] });
  });

  it("refuses a row that has no truth, since a partial truth would give a wrong number", () => {
    const processed = processStatement(inputOf(FLATS, ["2026-10-27,CASH DEP,100,,"]));
    expect(() => evaluate(processed, [])).toThrow(RangeError);
  });

  it("uses the bill as well as the flat: the right flat with the wrong bill is a false auto-post", () => {
    const processed = processStatement(inputOf(FLATS, ["2026-10-27,UPI/402200118801/swati@demo/T12 408/maint,6468,,"]));
    const m = evaluate(processed, [{ rowNumber: 1, truth: pays("T12-0408", "some-other-bill") }]);
    expect(m).toMatchObject({ trueAuto: 0, falseAuto: 1 });
  });

  it("is computed from the truth: the same decisions give different numbers for different truths", () => {
    const processed = processStatement(inputOf(FLATS, ["2026-10-27,UPI/402200118801/swati@demo/T12 408/maint,6468,,"]));
    expect(evaluate(processed, [{ rowNumber: 1, truth: pays("T12-0408", "k12") }]).precision).toBe(1);
    expect(evaluate(processed, [{ rowNumber: 1, truth: none }]).precision).toBe(0);
  });

  it("does not count already imported rows as decisions", () => {
    const first = processStatement(inputOf(FLATS, ["2026-10-27,UPI/402200118801/swati@demo/T12 408/maint,6468,,"]));
    const again = processStatement(inputOf(FLATS, ["2026-10-27,UPI/402200118801/swati@demo/T12 408/maint,6468,,"], new Set(first.rows.map((r) => r.dedupeKey))));
    const m = evaluate(again, [{ rowNumber: 1, truth: pays("T12-0408", "k12") }]);
    expect(m).toMatchObject({ alreadyImported: 1, autoMatched: 0, trueAuto: 0, falseAuto: 0 });
  });
});
