import { describe, expect, it } from "vitest";
import { accountedLine, actionsAllowed, barWidths, summarySegments } from "@/lib/reconciliation/summary";
import type { SummaryCounts } from "@/lib/reconciliation/types";

const counts = (over: Partial<SummaryCounts> = {}): SummaryCounts => ({ rowsRead: 105, autoMatched: 27, manuallyMatched: 0, needsYou: 40, awaitingApproval: 0, notMaintenance: 38, alreadyImported: 0, invalidRows: 0, accounted: true, ...over });

describe("RS1 bar widths (largest remainder)", () => {
  it("add up to exactly 100 for any counts, and a count above zero never has width zero", () => {
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let round = 0; round < 500; round++) {
      const size = 1 + (next() % 6);
      const values = Array.from({ length: size }, () => (next() % 5 === 0 ? 0 : next() % 3 === 0 ? 1 : next() % 200));
      const widths = barWidths(values);
      if (values.every((v) => v === 0)) expect(widths.every((w) => w === 0)).toBe(true);
      else expect(widths.reduce((a, b) => a + b, 0), values.join(",")).toBe(100);
      values.forEach((v, i) => expect(v > 0 ? widths[i] > 0 : widths[i] === 0, `${values.join(",")} at ${i}`).toBe(true));
    }
  });

  it.each([
    [[27, 40, 0, 38], [26, 38, 0, 36]],
    [[1, 1, 1], [34, 33, 33]],
    [[1, 1000], [1, 99]],
    [[0, 0, 0], [0, 0, 0]],
    [[5], [100]],
    [[1, 1, 1, 1, 1, 1], [17, 17, 17, 17, 16, 16]],
  ])("%j gives %j", (input, expected) => {
    expect(barWidths(input)).toEqual(expected);
  });

  it("refuses a negative or fractional count", () => {
    expect(() => barWidths([-1, 2])).toThrow(RangeError);
    expect(() => barWidths([1.5])).toThrow(RangeError);
  });
});

describe("RS2 the segments of the summary bar", () => {
  it("shows Posted automatically, Need you, Awaiting approval and Not maintenance always, with their numbers", () => {
    const segments = summarySegments(counts());
    expect(segments.map((s) => [s.label, s.count])).toEqual([["Posted automatically", 27], ["Need you", 40], ["Awaiting approval", 0], ["Not maintenance", 38]]);
    expect(segments.reduce((sum, s) => sum + s.width, 0)).toBe(100);
  });

  it("adds Already imported and Posted by hand only above zero", () => {
    const labels = summarySegments(counts({ alreadyImported: 12, manuallyMatched: 3 })).map((s) => s.label);
    expect(labels).toEqual(["Posted automatically", "Posted by hand", "Need you", "Awaiting approval", "Not maintenance", "Already imported"]);
  });
});

describe("RS3 the accounted line reads the flag", () => {
  it("says 'All N rows accounted for' when the flag is true", () => {
    expect(accountedLine(counts({ rowsRead: 105, accounted: true }))).toEqual({ ok: true, text: "All 105 rows accounted for" });
  });

  it("warns and offers no action when the flag is false, whatever the numbers are", () => {
    const bad = counts({ accounted: false });
    expect(accountedLine(bad)).toEqual({ ok: false, text: "The counts do not add up. Do not post from this import." });
    expect(actionsAllowed(bad)).toBe(false);
    expect(actionsAllowed(counts())).toBe(true);
  });

  it("does not decide from the counts: a flag of false with counts that do add up is still a warning", () => {
    const addsUp = counts({ rowsRead: 105, autoMatched: 27, needsYou: 40, notMaintenance: 38, accounted: false });
    expect(addsUp.autoMatched + addsUp.needsYou + addsUp.notMaintenance).toBe(105);
    expect(accountedLine(addsUp).ok).toBe(false);
  });
});
