import { describe, expect, it } from "vitest";
import { AGE_BUCKETS, ageBucket, ageingFlats, ageingTable, daysPastDue } from "@/domain/reports/age";
import { createPrng } from "@/domain/seed/prng";
import { type FlatSpec, bill, lateFee, payment, positionsOf, randomFlat } from "./report-helpers";

describe("RP1 age buckets", () => {
  it.each([
    [-30, "NOT_YET_DUE"],
    [-1, "NOT_YET_DUE"],
    [0, "NOT_YET_DUE"],
    [1, "DAYS_1_30"],
    [30, "DAYS_1_30"],
    [31, "DAYS_31_60"],
    [60, "DAYS_31_60"],
    [61, "DAYS_61_90"],
    [90, "DAYS_61_90"],
    [91, "OVER_90"],
    [365, "OVER_90"],
  ])("%s days past due is %s", (days, bucket) => {
    expect(ageBucket(days)).toBe(bucket);
  });

  it("days past due run from the due date: zero on the day, negative before", () => {
    expect(daysPastDue("2026-10-10", "2026-10-10")).toBe(0);
    expect(daysPastDue("2026-10-10", "2026-10-11")).toBe(1);
    expect(daysPastDue("2026-10-10", "2026-10-09")).toBe(-1);
    expect(daysPastDue("2026-09-10", "2026-10-27")).toBe(47);
  });

  it("has the five buckets in order", () => {
    expect(AGE_BUCKETS).toEqual(["NOT_YET_DUE", "DAYS_1_30", "DAYS_31_60", "DAYS_61_90", "OVER_90"]);
  });
});

describe("RP1 the ageing table", () => {
  const flat = (code: string, ...bills: ReturnType<typeof bill>[]): FlatSpec => ({ flatId: `id-${code}`, flatCode: code, bills, entries: [] });

  it("an empty list has five empty buckets and a zero total", () => {
    const ageing = ageingTable([], "2026-10-27");
    expect(ageing.buckets.map((b) => [b.bucket, b.flats, b.bills, b.unpaidBillsPaise, b.lateFeesPaise, b.amountDuePaise])).toEqual(AGE_BUCKETS.map((b) => [b, 0, 0, 0n, 0n, 0n]));
    expect(ageing.total).toEqual({ flats: 0, bills: 0, unpaidBillsPaise: 0n, lateFeesPaise: 0n, amountDuePaise: 0n });
  });

  it("one open bill is in one bucket with its principal plus its computed fee", () => {
    const f = flat("T01-0001", bill("2026-09-01", 637_000n));
    const [p] = positionsOf([f], "2026-10-27");
    const ageing = ageingTable(positionsOf([f], "2026-10-27"), "2026-10-27");
    expect(ageing.buckets.find((b) => b.bucket === "DAYS_31_60")).toEqual({ bucket: "DAYS_31_60", flats: 1, bills: 1, unpaidBillsPaise: 637_000n, lateFeesPaise: p.position.feeOutstandingPaise, amountDuePaise: p.position.amountDuePaise });
    expect(p.position.amountDuePaise).toBeGreaterThan(637_000n);
    expect(ageing.total.amountDuePaise).toBe(p.position.amountDuePaise);
  });

  it("the bucket of a bill follows the days since its due date, at every boundary", () => {
    const asOf = "2026-10-27";
    const cases: [number, string][] = [[0, "NOT_YET_DUE"], [-5, "NOT_YET_DUE"], [1, "DAYS_1_30"], [30, "DAYS_1_30"], [31, "DAYS_31_60"], [60, "DAYS_31_60"], [61, "DAYS_61_90"], [90, "DAYS_61_90"], [91, "OVER_90"]];
    for (const [days, expected] of cases) {
      const dueOn = new Date(Date.UTC(2026, 9, 27 - days)).toISOString().slice(0, 10);
      const f = flat("T01-0001", { ...bill("2026-06-01", 100_000n), dueOn });
      const ageing = ageingTable(positionsOf([f], asOf), asOf);
      expect(ageing.buckets.filter((b) => b.bills === 1).map((b) => b.bucket), `${days} days`).toEqual([expected]);
    }
  });

  it("a flat with bills in two buckets counts once in each and once in the total; a settled bill is left out", () => {
    const a = bill("2026-06-01", 100_000n);
    const b = bill("2026-09-01", 100_000n);
    const c = bill("2026-08-01", 100_000n);
    const f: FlatSpec = { flatId: "id-a", flatCode: "T01-0001", bills: [a, b, c], entries: [payment(c.id, 100_000n, "2026-08-05")] };
    const ageing = ageingTable(positionsOf([f], "2026-10-27"), "2026-10-27");
    expect(ageing.buckets.map((x) => x.bills)).toEqual([0, 0, 1, 0, 1]);
    expect(ageing.buckets.map((x) => x.flats)).toEqual([0, 0, 1, 0, 1]);
    expect(ageing.total.flats).toBe(1);
    expect(ageing.total.bills).toBe(2);
  });

  it("a FEE_ONLY position (principal paid, fee owed) is in the table, aged from its due date, with the fee as the amount due", () => {
    const b = bill("2026-09-01", 637_000n);
    const f: FlatSpec = { flatId: "id-a", flatCode: "T01-0001", bills: [b], entries: [payment(b.id, 637_000n, "2026-10-12"), lateFee(b.id, 3_800n, "2026-10-12")] };
    const [p] = positionsOf([f], "2026-10-27");
    expect(p.position.kind).toBe("FEE_ONLY");
    const ageing = ageingTable(positionsOf([f], "2026-10-27"), "2026-10-27");
    expect(ageing.buckets.find((x) => x.bucket === "DAYS_31_60")).toMatchObject({ bills: 1, amountDuePaise: 3_800n });
  });

  it("the flats of a group: each flat once with its bills, its oldest age and its total, largest first by default order and oldest first on request; nothing personal", () => {
    const older = { ...bill("2026-08-01", 200_000n), dueOn: "2026-08-20" };
    const flats = [
      flat("T02-0002", { ...bill("2026-09-01", 100_000n), dueOn: "2026-09-10" }),
      flat("T01-0001", { ...bill("2026-09-01", 100_000n), dueOn: "2026-09-10" }),
      flat("T03-0003", { ...bill("2026-09-01", 900_000n), dueOn: "2026-09-20" }),
      flat("T04-0004", { ...bill("2026-09-01", 100_000n), dueOn: "2026-09-12" }, { ...bill("2026-09-02", 100_000n), dueOn: "2026-09-25" }),
    ];
    const positions = positionsOf(flats, "2026-10-27");
    const largest = ageingFlats(positions, "2026-10-27", "DAYS_31_60", "LARGEST");
    expect(largest.map((r) => r.flatCode)).toEqual(["T03-0003", "T04-0004", "T01-0001", "T02-0002"]);
    const oldest = ageingFlats(positions, "2026-10-27", "DAYS_31_60", "OLDEST");
    expect(oldest.map((r) => [r.flatCode, r.oldestDaysPastDue])).toEqual([["T01-0001", 47], ["T02-0002", 47], ["T04-0004", 45], ["T03-0003", 37]]);
    expect(largest.find((r) => r.flatCode === "T04-0004")).toMatchObject({ bills: 2, oldestDaysPastDue: 45 });
    expect(Object.keys(largest[0]).sort()).toEqual(["amountDuePaise", "bills", "flatCode", "flatId", "oldestDaysPastDue"]);
    expect(ageingFlats(positions, "2026-10-27", "OVER_90", "LARGEST")).toEqual([]);
    expect(older.dueOn).toBe("2026-08-20");
  });

  it("a flat with bills of two ages is in two groups, each time with only the bills of that group; the groups' flats add up to more than the different flats", () => {
    const f = flat("T05-0005", { ...bill("2026-07-01", 100_000n), dueOn: "2026-07-10" }, { ...bill("2026-10-01", 100_000n), dueOn: "2026-10-10" });
    const positions = positionsOf([f], "2026-10-27");
    expect(ageingFlats(positions, "2026-10-27", "OVER_90", "LARGEST")).toMatchObject([{ flatCode: "T05-0005", bills: 1, oldestDaysPastDue: 109 }]);
    expect(ageingFlats(positions, "2026-10-27", "DAYS_1_30", "LARGEST")).toMatchObject([{ flatCode: "T05-0005", bills: 1, oldestDaysPastDue: 17 }]);
    const ageing = ageingTable(positions, "2026-10-27");
    expect(ageing.total.flats).toBe(1);
    expect(ageing.buckets.reduce((sum, b) => sum + b.flats, 0)).toBe(2);
  });

  it("2,000 random bill sets: the buckets add up to the total, to the sum of the amounts due, and each open position is in exactly one bucket and one set of rows", () => {
    const r = createPrng(14_002);
    for (let n = 0; n < 2000; n++) {
      const flats = Array.from({ length: r.int(1, 6) }, (_, i) => randomFlat(r.fork(`f${n}-${i}`), i));
      const asOf = new Date(Date.UTC(2026, r.int(5, 11), r.int(1, 28))).toISOString().slice(0, 10);
      const positions = positionsOf(flats, asOf);
      const open = positions.filter((p) => p.position.kind !== "SETTLED");
      const ageing = ageingTable(positions, asOf);
      const label = `set ${n} as of ${asOf}`;
      const dueTotal = open.reduce((sum, p) => sum + p.position.amountDuePaise, 0n);
      expect(ageing.buckets.reduce((sum, b) => sum + b.amountDuePaise, 0n), label).toBe(dueTotal);
      expect(ageing.total.amountDuePaise, label).toBe(dueTotal);
      expect(ageing.buckets.reduce((sum, b) => sum + b.bills, 0), label).toBe(open.length);
      expect(ageing.total.bills, label).toBe(open.length);
      // D175: the split. Unpaid bills + late fees = the amount due, in every bucket and in total, and the buckets add up to the total of each part.
      for (const row of [...ageing.buckets, ageing.total]) expect(row.unpaidBillsPaise + row.lateFeesPaise, label).toBe(row.amountDuePaise);
      expect(ageing.buckets.reduce((sum, b) => sum + b.unpaidBillsPaise, 0n), label).toBe(ageing.total.unpaidBillsPaise);
      expect(ageing.buckets.reduce((sum, b) => sum + b.lateFeesPaise, 0n), label).toBe(ageing.total.lateFeesPaise);
      expect(ageing.total.unpaidBillsPaise, label).toBe(open.reduce((sum, p) => sum + p.position.principalOutstandingPaise, 0n));
      expect(ageing.total.flats, label).toBe(new Set(open.map((p) => p.flatId)).size);
      expect(ageing.buckets.reduce((sum, b) => sum + b.flats, 0), label).toBeGreaterThanOrEqual(ageing.total.flats);
      // The flats of each group add up to the group: their number is the group's flats, their bills its bills, their amounts its amount due.
      for (const sort of ["LARGEST", "OLDEST"] as const) {
        const perGroup = AGE_BUCKETS.map((bucket) => ageingFlats(positions, asOf, bucket, sort));
        expect(perGroup.map((rows) => rows.length), label).toEqual(ageing.buckets.map((b) => b.flats));
        expect(perGroup.map((rows) => rows.reduce((sum, row) => sum + row.bills, 0)), label).toEqual(ageing.buckets.map((b) => b.bills));
        expect(perGroup.flat().reduce((sum, row) => sum + row.amountDuePaise, 0n), label).toBe(dueTotal);
      }
    }
  });
});
