import { describe, expect, it } from "vitest";
import { AGE_BUCKETS, type Ageing } from "@/domain/reports/age";
import type { MoneyLine } from "@/domain/reports/money-line";
import { ageingTableOf, barWidthPercent, bucketFromQuery, bucketLabel, bucketQuery, listedBuckets, reconcileNote, shareOfTotal, sortFromQuery, sortQuery } from "@/lib/reports/ageing";

describe("RC3 the ageing buckets in the address and in words", () => {
  it("round-trip through ?bucket=", () => {
    for (const bucket of AGE_BUCKETS) expect(bucketFromQuery(bucketQuery(bucket))).toBe(bucket);
    expect(AGE_BUCKETS.map(bucketQuery)).toEqual(["not-yet-due", "1-30", "31-60", "61-90", "over-90"]);
  });

  it.each([undefined, "", "NOT_YET_DUE", "all", "0-30", "31", "over-91", "<script>", "1-30,31-60"])("%j names no bucket", (value) => {
    expect(bucketFromQuery(value)).toBeNull();
  });

  it("the first of several values counts", () => {
    expect(bucketFromQuery(["61-90", "1-30"])).toBe("DAYS_61_90");
    expect(bucketFromQuery([])).toBeNull();
  });

  it("each bucket has the words of the task", () => {
    expect(AGE_BUCKETS.map(bucketLabel)).toEqual(["Not yet due", "1 to 30 days", "31 to 60 days", "61 to 90 days", "Over 90 days"]);
  });
});

describe("RC4 the age list: bars scaled to the total, hidden empty group, share, table and the reconciling sentence", () => {
  const row = (bucket: (typeof AGE_BUCKETS)[number], bills: number, unpaid: bigint, fees: bigint) => ({ bucket, flats: bills, bills, unpaidBillsPaise: unpaid, lateFeesPaise: fees, amountDuePaise: unpaid + fees });
  const ageing: Ageing = {
    buckets: [row("NOT_YET_DUE", 0, 0n, 0n), row("DAYS_1_30", 472, 313_912_900n, 3_075_100n), row("DAYS_31_60", 204, 130_000_000n, 0n), row("DAYS_61_90", 125, 84_000_000n, 0n), row("OVER_90", 117, 75_000_000n, 0n)],
    total: { flats: 817, bills: 918, unpaidBillsPaise: 602_912_900n, lateFeesPaise: 3_075_100n, amountDuePaise: 605_988_000n },
  };
  const money: MoneyLine = { billedPaise: 1_805_219_000n, collectedPaise: 1_491_306_100n, outstandingPaise: 313_912_900n, flatsBilled: 2399, flatsPaidInFull: 1927, flatsOutstanding: 472, fees: { postedPaidPaise: 0n, postedOwingPaise: 0n, accruingPaise: 3_075_100n } };

  it("'Not yet due' is left out when it is empty and listed when it holds something", () => {
    expect(listedBuckets(ageing).map((b) => b.bucket)).toEqual(["DAYS_1_30", "DAYS_31_60", "DAYS_61_90", "OVER_90"]);
    const withDue = { ...ageing, buckets: [row("NOT_YET_DUE", 3, 1_000n, 0n), ...ageing.buckets.slice(1)] };
    expect(listedBuckets(withDue)[0].bucket).toBe("NOT_YET_DUE");
  });

  it("each bar is a share of the TOTAL, so the bars compare, never wider than the whole, and a small group is at least 1 percent", () => {
    expect(barWidthPercent(ageing.buckets[1].amountDuePaise, ageing)).toBe(52.3);
    expect(barWidthPercent(ageing.total.amountDuePaise, ageing)).toBe(100);
    expect(barWidthPercent(1n, ageing)).toBe(1);
    expect(barWidthPercent(0n, ageing)).toBe(0);
    expect(shareOfTotal(ageing.buckets[1].amountDuePaise, ageing)).toBe(52);
  });

  it("the table has Age, Bills, Flats, Unpaid bills, Late fees and Total, a row per listed group and a total row, in exact rupees", () => {
    const table = ageingTableOf(ageing);
    expect(table.columns).toEqual(["Age", "Bills", "Flats", "Unpaid bills", "Late fees", "Total"]);
    expect(table.rows).toHaveLength(5);
    expect(table.rows[0]).toEqual({ header: "1 to 30 days", cells: ["472", "472", "₹31,39,129", "₹30,751", "₹31,69,880"] });
    expect(table.rows.at(-1)).toEqual({ header: "Total owed", cells: ["918", "817", "₹60,29,129", "₹30,751", "₹60,59,880"] });
  });

  it("the sentence ties Still unpaid to the group that holds exactly that amount, with the late fees on top; otherwise it gives the totals of every month", () => {
    expect(reconcileNote({ ageing, money, period: "2026-10-01" })).toBe("October's unpaid bills are ₹31,39,129 (Billed and collected). The 1 to 30 days group also holds late fees of ₹30,751.");
    expect(reconcileNote({ ageing, money: { ...money, outstandingPaise: 5n }, period: "2026-10-01" })).toBe("October's unpaid bills are ₹0.05 (Billed and collected). The age groups hold unpaid bills of every month, ₹60,29,129, and late fees of ₹30,751.");
    expect(reconcileNote({ ageing, money: null, period: "2026-10-01" })).toBeNull();
  });

  it("the order is in the address: oldest only when asked, and the default is largest first", () => {
    expect(sortFromQuery("oldest")).toBe("OLDEST");
    for (const value of [undefined, "", "largest", "OLDEST", "newest", "<script>"]) expect(sortFromQuery(value), String(value)).toBe("LARGEST");
    expect(sortFromQuery(["oldest", "largest"])).toBe("OLDEST");
    expect(sortQuery("OLDEST")).toBe("oldest");
  });
});
