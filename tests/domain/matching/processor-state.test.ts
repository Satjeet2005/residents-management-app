import { describe, expect, it } from "vitest";
import { amountIndexFor, recordPayment } from "@/domain/matching/amounts";
import { buildMatchContext } from "@/domain/matching/context";
import { accountingReport, processStatement, type ProcessedStatement } from "@/domain/matching/processor";
import { bill, flat } from "./builders";
import { inputOf } from "./processor-helpers";

const SEPT = (key = "sep") => bill(key, 637000n, "2026-09-10");
const OCT = bill("oct", 637000n, "2026-10-10");
const pay = (n: number, narration = "T12 408", amount = "6468"): string => `2026-10-27,UPI/40220011887${n}/${narration}/maint,${amount},,`;

describe("state application: a bill that was paid is paid for the rows after it", () => {
  const flats = [flat("T12-0408", { bills: [SEPT()] })];

  it("two rows that each pay the oldest bill exactly: the first is AUTO_MATCHED, the second is QUEUED", () => {
    const result = processStatement(inputOf(flats, [pay(1), pay(2)]));
    expect(result.rows.map((r) => r.state)).toEqual(["AUTO_MATCHED", "QUEUED"]);
    expect(result.rows[1].decision?.reasons.map((r) => r.code)).toContain("NO_OPEN_BILL");
    expect(result.entriesToPost.filter((e) => e.entryType === "PAYMENT")).toHaveLength(1);
  });

  it("the second row pays the next bill when that is what it pays", () => {
    const two = [flat("T12-0408", { bills: [SEPT(), OCT] })];
    // 637000 plus the 47-day fee, then the October bill: 637000 plus a 17-day fee of 3600.
    const result = processStatement(inputOf(two, [pay(1, "T12 408", "6468"), pay(2, "T12 408", "6406")]));
    expect(result.rows.map((r) => r.state)).toEqual(["AUTO_MATCHED", "AUTO_MATCHED"]);
    expect(result.rows.map((r) => r.decision?.plan?.entries.at(-1)?.billKey)).toEqual(["sep", "oct"]);
  });

  it("a QUEUED or IGNORED row changes nothing", () => {
    const result = processStatement(inputOf(flats, ["2026-10-27,UPI/402200118870/stranger@zzz,6468,,", "2026-10-27,SMS CHARGES,,29.5,", pay(3)]));
    expect(result.rows.map((r) => r.state)).toEqual(["QUEUED", "IGNORED", "AUTO_MATCHED"]);
  });

  it("a later row paying part of a paid bill sees no open bill", () => {
    const result = processStatement(inputOf(flats, [pay(1), pay(2, "T12 408", "100")]));
    expect(result.rows[1].state).toBe("QUEUED");
    expect(result.rows[1].decision?.candidates[0]).toMatchObject({ flatCode: "T12-0408", amountRelation: "NO_OPEN_BILL" });
  });

  it("an amount that only one flat owed is no longer owed once that flat is paid", () => {
    const two = [flat("T12-0408", { upi: ["swati@demo"], bills: [SEPT()] }), flat("T07-1203", { bills: [SEPT("b")] })];
    const result = processStatement(inputOf(two, [pay(1, "swati@demo/T12 408"), "2026-10-27,UPI/402200118872/stranger@zzz,6468,,"]));
    expect(result.rows[0].state).toBe("AUTO_MATCHED");
    expect(result.rows[1].decision?.candidates.map((c) => c.flatCode)).toEqual(["T07-1203"]);
    expect(result.rows[1].decision?.totalCandidates).toBe(1);
  });

  it("an amount becomes unique once the other flat that owed it is paid (C26), so the order of the rows can change M4j", () => {
    const two = [flat("T12-0408", { upi: ["swati@demo"], bills: [SEPT()] }), flat("T07-1203", { bills: [SEPT("b")] })];
    const first = pay(1, "swati@demo/T12 408");
    const second = pay(2, "T07 1203");
    expect(processStatement(inputOf(two, [first, second])).rows.map((r) => r.state)).toEqual(["AUTO_MATCHED", "AUTO_MATCHED"]);
    const reversed = processStatement(inputOf(two, [second, first]));
    expect(reversed.rows.map((r) => [r.rowNumber, r.state])).toEqual([[1, "QUEUED"], [2, "AUTO_MATCHED"]]);
    expect(reversed.rows[0].decision?.reasons.map((r) => r.code)).toContain("NEEDS_SECOND_SIGNAL");
  });

  it("never changes the flats it was given", () => {
    const given = [flat("T12-0408", { bills: [SEPT()] })];
    const before = structuredClone(given);
    processStatement(inputOf(given, [pay(1)]));
    expect(given).toEqual(before);
  });
});

describe("recordPayment", () => {
  it("moves a flat in an amount index that was already built", () => {
    const context = buildMatchContext([flat("T12-0408", { bills: [SEPT(), OCT] })]);
    const index = amountIndexFor(context, "2026-10-27");
    expect(index.byDue.get(646800n)).toEqual(["T12-0408"]);
    recordPayment(context, "T12-0408", "sep", { date: "2026-10-27", amountPaise: 646800n });
    expect(index.byDue.get(646800n)).toBeUndefined();
    expect(index.byDue.get(640600n)).toEqual(["T12-0408"]);
    expect(index.byFlat.get("T12-0408")).toMatchObject({ duePaise: 640600n });
  });

  it("removes a flat whose last bill is paid, and refuses unknown bills and bad amounts", () => {
    const context = buildMatchContext([flat("T12-0408", { bills: [SEPT()] })]);
    const index = amountIndexFor(context, "2026-10-27");
    recordPayment(context, "T12-0408", "sep", { date: "2026-10-27", amountPaise: 646800n });
    expect(index.byFlat.has("T12-0408")).toBe(false);
    expect(() => recordPayment(context, "T12-0408", "nope", { date: "2026-10-27", amountPaise: 1n })).toThrow(RangeError);
    expect(() => recordPayment(context, "T99-0101", "sep", { date: "2026-10-27", amountPaise: 1n })).toThrow(RangeError);
    expect(() => recordPayment(context, "T12-0408", "sep", { date: "2026-10-27", amountPaise: 0n })).toThrow(RangeError);
  });

  it("buildMatchContext copies the payments it is given", () => {
    const given = flat("T12-0408", { bills: [bill("sep", 637000n, "2026-09-10", [{ date: "2026-09-20", amountPaise: 100n }])] });
    const context = buildMatchContext([given]);
    recordPayment(context, "T12-0408", "sep", { date: "2026-10-01", amountPaise: 200n });
    expect(given.openBills[0].paymentsOnBill).toHaveLength(1);
    expect(context.flatsByCode.get("T12-0408")?.openBills[0].paymentsOnBill).toHaveLength(2);
  });
});

describe("accounted", () => {
  const flats = [flat("T12-0408", { bills: [SEPT()] })];
  const lines = [pay(1), pay(2), "2026-10-27,UPI/402200118873/stranger@zzz,12.34,,", "2026-10-27,SMS CHARGES,,29.5,", "bad,CASH,1,,"];
  const good = (): ProcessedStatement => processStatement(inputOf(flats, lines));

  it("is true for a statement where every row is accounted for, and the report is empty", () => {
    const result = good();
    expect(result.accounted).toBe(true);
    expect(accountingReport(result)).toEqual([]);
    expect(result.summary).toMatchObject({ rowsRead: 5, validRows: 4, invalidRows: 1, autoMatched: 1, queued: 2, ignored: 1 });
  });

  it("is true for a statement of only invalid rows, with no entries", () => {
    const result = processStatement(inputOf(flats, ["bad,CASH,1,,"]));
    expect(result).toMatchObject({ accounted: true, entriesToPost: [] });
  });

  it("says which condition is broken", () => {
    const corrupt = (change: (p: ProcessedStatement) => void): string[] => {
      const copy = structuredClone(good());
      change(copy);
      return accountingReport(copy);
    };
    expect(corrupt((p) => (p.rows[0].state = "QUEUED"))).toEqual(expect.arrayContaining([expect.stringContaining("Row 1 is QUEUED but its decision is AUTO_MATCH")]));
    expect(corrupt((p) => (p.rows[1].state = "BOGUS" as never))[0]).toContain("has no valid state");
    expect(corrupt((p) => (p.rows[1].decision = null))[0]).toContain("has no decision");
    expect(corrupt((p) => (p.summary.queued += 1))).toEqual(expect.arrayContaining([expect.stringContaining("queued is 3 but the rows give 2")]));
    expect(corrupt((p) => (p.summary.rowsRead -= 1))).toEqual(expect.arrayContaining([expect.stringContaining("do not equal the rows read")]));
    expect(corrupt((p) => (p.summary.invalidRows = 0))[0]).toContain("invalidRows is 0 but the rows give 1");
    expect(corrupt((p) => (p.rows[0].creditPaise += 1n))[0]).toContain("is not its credit");
    expect(corrupt((p) => p.entriesToPost.pop())[0]).toContain("entries to post");
    expect(corrupt((p) => (p.entriesToPost[1].idempotencyKey = p.entriesToPost[0].idempotencyKey))).toEqual(expect.arrayContaining([expect.stringContaining("share an idempotency key")]));
  });
});
