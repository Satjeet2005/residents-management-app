import { describe, expect, it } from "vitest";
import {
  formatRupees,
  formatRupeesRounded,
  paise,
  parseRupees,
  roundPaiseToRupeesHalfUp,
  sumPaise,
} from "@/domain/money/money";

/** mulberry32: a tiny deterministic generator, so failures are reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("paise()", () => {
  it("accepts integers and bigints", () => {
    expect(paise(637000)).toBe(637000n);
    expect(paise(-5)).toBe(-5n);
    expect(paise(0)).toBe(0n);
    expect(paise(2160000000n)).toBe(2160000000n);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, -(2 ** 53)])(
    "rejects %s with RangeError",
    (value) => {
      expect(() => paise(value)).toThrow(RangeError);
    },
  );
});

describe("formatRupees: Indian grouping", () => {
  it.each([
    [0n, "₹0"],
    [5n, "₹5"],
    [99n, "₹99"],
    [100n, "₹100"],
    [999n, "₹999"],
    [1000n, "₹1,000"],
    [12345n, "₹12,345"],
    [123456n, "₹1,23,456"],
    [1234567n, "₹12,34,567"],
    [12345678n, "₹1,23,45,678"],
    [123456789n, "₹12,34,56,789"],
  ])("%s rupees formats as %s", (rupees, expected) => {
    expect(formatRupees(rupees * 100n)).toBe(expected);
  });

  it("formats 1 crore", () => {
    expect(formatRupees(10_000_000n * 100n)).toBe("₹1,00,00,000");
  });

  it("formats ₹21.6 crore (216,000,000 rupees = 21,600,000,000 paise)", () => {
    expect(formatRupees(21_600_000_000n)).toBe("₹21,60,00,000");
  });

  it("formats 2,160,000,000,000 paise (21,600,000,000 rupees)", () => {
    expect(formatRupees(2_160_000_000_000n)).toBe("₹21,60,00,00,000");
  });

  it("formats a value beyond 2^63 without loss", () => {
    expect(formatRupees(9_223_372_036_854_775_807n)).toBe("₹92,23,37,20,36,85,47,758.07");
  });
});

describe("formatRupees: paise and negatives", () => {
  it.each([
    [1n, "₹0.01"],
    [5n, "₹0.05"],
    [99n, "₹0.99"],
    [101n, "₹1.01"],
    [9843n, "₹98.43"],
    [9800n, "₹98"],
    [637000n, "₹6,370"],
    [12345650n, "₹1,23,456.50"],
    [12345605n, "₹1,23,456.05"],
  ])("%s paise formats as %s", (amount, expected) => {
    expect(formatRupees(amount)).toBe(expected);
  });

  it.each([
    [-9800n, "-₹98"],
    [-9843n, "-₹98.43"],
    [-5n, "-₹0.05"],
    [-12345600n, "-₹1,23,456"],
    [-100n, "-₹1"],
  ])("%s paise formats as %s", (amount, expected) => {
    expect(formatRupees(amount)).toBe(expected);
  });
});

describe("roundPaiseToRupeesHalfUp: ties go away from zero, negatives mirror positives", () => {
  it.each([
    [150n, 200n],
    [149n, 100n],
    [250n, 300n],
    [0n, 0n],
    [50n, 100n],
    [49n, 0n],
    [100n, 100n],
    [9843n, 9800n],
    [9850n, 9900n],
    [-150n, -200n],
    [-149n, -100n],
    [-250n, -300n],
    [-50n, -100n],
    [-49n, 0n],
  ])("%s -> %s", (input, expected) => {
    expect(roundPaiseToRupeesHalfUp(input)).toBe(expected);
  });

  it("formatRupeesRounded rounds before formatting", () => {
    expect(formatRupeesRounded(9843n)).toBe("₹98");
    expect(formatRupeesRounded(9850n)).toBe("₹99");
    expect(formatRupeesRounded(-9850n)).toBe("-₹99");
    expect(formatRupeesRounded(0n)).toBe("₹0");
  });
});

describe("sumPaise", () => {
  it("adds bigints exactly", () => {
    expect(sumPaise([])).toBe(0n);
    expect(sumPaise([637000n, 9800n, -100n])).toBe(646700n);
    expect(sumPaise([9_223_372_036_854_775_807n, 1n])).toBe(9_223_372_036_854_775_808n);
  });
});

describe("parseRupees", () => {
  it.each([
    ["6,370", 637000n],
    ["6370", 637000n],
    ["₹1,23,456.50", 12345650n],
    ["₹6,370", 637000n],
    ["6370.5", 637050n],
    ["6370.50", 637050n],
    ["6370.05", 637005n],
    ["0", 0n],
    ["0.99", 99n],
    ["1,234,567.89", 123456789n],
    ["12,34,567", 123456700n],
    ["  ₹98.43  ", 9843n],
    ["6,37,0", 637000n],
  ])("parses %j as %s paise", (text, expected) => {
    expect(parseRupees(text)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["-100", "sign"],
    ["+100", "sign"],
    ["−100", "sign"],
    ["abc", "letters"],
    ["12a", "letters"],
    ["Rs 100", "letters"],
    ["1e5", "letters"],
    ["100.123", "more than 2 decimals"],
    ["100.1234", "more than 2 decimals"],
    ["₹", "no digits"],
    [".5", "no integer digits"],
    ["5.", "no decimals after the point"],
    ["1,,000", "double comma"],
    [",100", "leading comma"],
    ["100,", "trailing comma"],
    ["1,000,.50", "comma before the point"],
    ["1,000.5,0", "comma in the decimals"],
    ["1.000.5", "two points"],
    ["₹₹100", "two rupee signs"],
    ["100₹", "rupee sign at the end"],
    ["1 000", "inner whitespace"],
    ["１２３", "non-ASCII digits"],
  ])("rejects %j (%s) with RangeError", (text) => {
    expect(() => parseRupees(text)).toThrow(RangeError);
  });

  it("gives clear messages", () => {
    expect(() => parseRupees("")).toThrow("Amount is empty");
    expect(() => parseRupees("-5")).toThrow("must not have a sign");
    expect(() => parseRupees("1.234")).toThrow("more than 2 decimal places");
    expect(() => parseRupees("abc")).toThrow("digits with an optional");
  });
});

describe("parseRupees(formatRupees(x)) === x", () => {
  it("round trips 2,000 seeded random non-negative values", () => {
    const random = seededRandom(20261104);
    for (let i = 0; i < 2000; i++) {
      const digits = 1 + Math.floor(random() * 16);
      let text = "";
      for (let d = 0; d < digits; d++) text += Math.floor(random() * 10).toString();
      const value = BigInt(text);
      expect(parseRupees(formatRupees(value))).toBe(value);
    }
  });

  it("round trips whole-rupee and paise edge values", () => {
    for (const value of [0n, 1n, 99n, 100n, 101n, 99_999n, 100_000n, 10_000_000_00n, 2_160_000_000_000n]) {
      expect(parseRupees(formatRupees(value))).toBe(value);
    }
  });
});
