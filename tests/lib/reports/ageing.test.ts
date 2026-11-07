import { describe, expect, it } from "vitest";
import { AGE_BUCKETS } from "@/domain/reports/age";
import { ageingWidths, bucketFromQuery, bucketLabel, bucketQuery } from "@/lib/reports/ageing";

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

describe("RC4 the widths of the ageing bar", () => {
  it("are whole percents that add up to 100, and an amount above zero is never zero wide", () => {
    const widths = ageingWidths([1n, 1_000_000n, 500_000n, 1n, 2_000_000_000n]);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(widths.every((w) => Number.isInteger(w) && w >= 1)).toBe(true);
  });

  it("all zero is all zero, and a single amount fills the bar", () => {
    expect(ageingWidths([0n, 0n, 0n, 0n, 0n])).toEqual([0, 0, 0, 0, 0]);
    expect(ageingWidths([0n, 0n, 7n, 0n, 0n])).toEqual([0, 0, 100, 0, 0]);
  });

  it("follows the amounts: half and half", () => {
    expect(ageingWidths([100n, 0n, 100n, 0n, 0n])).toEqual([50, 0, 50, 0, 0]);
  });
});
