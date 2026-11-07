import { describe, expect, it } from "vitest";
import { createPrng } from "@/domain/seed/prng";
import { atLeastPercent, atMostPercent, medianOf, percent } from "@/domain/reports/stats";

describe("RP1 medianOf", () => {
  it.each([
    [[], null],
    [[7], 7],
    [[1, 3], 1],
    [[3, 1], 1],
    [[3, 1, 2], 2],
    [[4, 1, 3, 2], 2],
    [[10, 20, 30, 40, 50, 60], 30],
    [[5, 5, 5, 5], 5],
    [[-4, -1, -3, -2], -3],
    [[0, 0, 100], 0],
  ])("%j has the median %s (an even count takes the LOWER middle value)", (values, expected) => {
    expect(medianOf(values)).toBe(expected);
  });

  it("does not change the list it is given", () => {
    const values = [3, 1, 2];
    medianOf(values);
    expect(values).toEqual([3, 1, 2]);
  });

  it("2,000 random lists: the median is one of the values, at least half the values are at or below it, and at least half are at or above it", () => {
    const r = createPrng(2026_11);
    for (let i = 0; i < 2000; i++) {
      const values = Array.from({ length: r.int(1, 15) }, () => r.int(-50, 200));
      const median = medianOf(values) as number;
      expect(values).toContain(median);
      expect(values.filter((v) => v <= median).length * 2).toBeGreaterThanOrEqual(values.length);
      expect(values.filter((v) => v >= median).length * 2).toBeGreaterThanOrEqual(values.length - 1);
    }
  });
});

describe("RP1 percent", () => {
  it("is null when there is nothing to take a share of, never 0", () => {
    expect(percent(0, 0)).toBeNull();
    expect(percent(5, 0)).toBeNull();
  });

  it.each([
    [0, 5, 0],
    [1, 3, 33],
    [2, 3, 67],
    [1, 2, 50],
    [1, 8, 13],
    [5, 8, 63],
    [5, 5, 100],
    [199, 200, 100],
    [1, 200, 1],
    [1, 400, 0],
  ])("%s of %s is %s percent (rounded half up)", (n, d, expected) => {
    expect(percent(n, d)).toBe(expected);
  });

  it("targets are checked on the counts: 89 of 100 is not 90 percent, and 0 of 0 meets no target", () => {
    expect(atLeastPercent(9, 10, 90)).toBe(true);
    expect(atLeastPercent(89, 100, 90)).toBe(false);
    expect(atLeastPercent(449, 500, 90)).toBe(false);
    expect(atLeastPercent(0, 0, 0)).toBe(false);
    expect(atMostPercent(8, 100, 8)).toBe(true);
    expect(atMostPercent(81, 1000, 8)).toBe(false);
    expect(atMostPercent(0, 0, 8)).toBe(false);
  });
});
