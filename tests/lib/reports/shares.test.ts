import { describe, expect, it } from "vitest";
import { sharesOf } from "@/lib/reports/shares";

describe("SH1 shares that add to 100 (largest remainder, D214)", () => {
  it("three equal parts are 34, 33 and 33: the missing percent goes to the earlier part", () => {
    expect(sharesOf([1n, 1n, 1n])).toEqual([34, 33, 33]);
  });

  it("the shares of any list add to exactly 100, and no share is more than one percent from its true value", () => {
    const lists = [[5n, 3n, 2n], [1n, 99n], [333n, 333n, 334n], [7n, 11n, 13n, 17n, 19n], [1n, 1n, 1n, 1n, 1n, 1n, 1n], [10_000_000n, 1n, 1n]];
    for (const parts of lists) {
      const shares = sharesOf(parts);
      expect(shares.reduce((a, b) => a + b, 0), parts.join(",")).toBe(100);
      const total = parts.reduce((a, b) => a + b, 0n);
      parts.forEach((part, i) => expect(Math.abs(shares[i] - Number((part * 10000n) / total) / 100), `${parts.join(",")} [${i}]`).toBeLessThan(1));
    }
  });

  it("a part of zero stays zero, and nothing owed gives all zeros (never a share of nothing)", () => {
    expect(sharesOf([0n, 5n])).toEqual([0, 100]);
    expect(sharesOf([0n, 0n])).toEqual([0, 0]);
    expect(sharesOf([])).toEqual([]);
  });
});
