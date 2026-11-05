import { beforeAll, describe, expect, it } from "vitest";
import { buildMatchContext, defaultMatchSettings, normaliseUpiId } from "@/domain/matching/context";
import { nameLookupKey, nameMatchStrength, nameWords } from "@/domain/matching/names";
import { bill, flat } from "./builders";
import { demoDataset, flatContextsFromDataset } from "./context";

describe("buildMatchContext", () => {
  it("indexes flats by code", () => {
    const context = buildMatchContext([flat("T12-0408"), flat("T07-1203")]);
    expect([...context.flatsByCode.keys()]).toEqual(["T12-0408", "T07-1203"]);
    expect(context.flats).toHaveLength(2);
  });

  it("indexes a UPI id case-insensitively and lists every flat that has it", () => {
    const context = buildMatchContext([flat("T01-0101", { upi: ["Raj.S@demo"] }), flat("T02-0101", { upi: [" raj.s@DEMO "] }), flat("T03-0101", { upi: ["other@demo"] })]);
    expect(context.flatsByUpiId.get("raj.s@demo")?.map((f) => f.code)).toEqual(["T01-0101", "T02-0101"]);
    expect(context.flatsByUpiId.get("other@demo")?.map((f) => f.code)).toEqual(["T03-0101"]);
    expect(normaliseUpiId("  A.B@Demo ")).toBe("a.b@demo");
  });

  it("indexes resident and payer-name words under the lookup key", () => {
    const context = buildMatchContext([flat("T01-0101", { residents: ["Mr. Rahul Kulkarni"], payerNames: ["Sunita Kulkarni"] })]);
    expect(context.flatsByNameKey.get("RAHU")?.map((f) => f.code)).toEqual(["T01-0101"]);
    expect(context.flatsByNameKey.get("KULK")?.map((f) => f.code)).toEqual(["T01-0101"]);
    expect(context.flatsByNameKey.get("SUNI")?.map((f) => f.code)).toEqual(["T01-0101"]);
    expect(context.flatsByNameKey.has("MR")).toBe(false);
  });

  it("keeps a flat once per key even when two names share a word", () => {
    const context = buildMatchContext([flat("T01-0101", { residents: ["Anil Joshi", "Swati Joshi"] })]);
    expect(context.flatsByNameKey.get("JOSH")).toHaveLength(1);
  });

  it("sorts open bills oldest first and does not change its input", () => {
    const input = flat("T01-0101", { bills: [bill("b2", 100n, "2026-10-10"), bill("b1", 100n, "2026-09-10")] });
    const context = buildMatchContext([input]);
    expect(context.flatsByCode.get("T01-0101")?.openBills.map((b) => b.billKey)).toEqual(["b1", "b2"]);
    expect(input.openBills.map((b) => b.billKey)).toEqual(["b2", "b1"]);
  });

  it("starts with empty caches", () => {
    const context = buildMatchContext([]);
    expect(context.caches.fees.size).toBe(0);
    expect(context.caches.amounts.size).toBe(0);
    expect(context.settings).toBe(defaultMatchSettings);
  });

  it("refuses a repeated flat code, a bad bill and a bad setting", () => {
    expect(() => buildMatchContext([flat("T01-0101"), flat("T01-0101")])).toThrow(RangeError);
    expect(() => buildMatchContext([flat("T01-0101", { bills: [bill("b", 0n, "2026-10-10")] })])).toThrow(RangeError);
    expect(() => buildMatchContext([flat("T01-0101", { bills: [bill("b", 5n, "2026-13-40")] })])).toThrow(RangeError);
    expect(() => buildMatchContext([flat("T01-0101", { bills: [bill("b", 5n, "2026-10-10"), bill("b", 5n, "2026-11-10")] })])).toThrow(RangeError);
    expect(() => buildMatchContext([], { ...defaultMatchSettings, approvalThresholdPaise: 0n })).toThrow(RangeError);
    expect(() => buildMatchContext([], { ...defaultMatchSettings, lateFeePolicy: { annualRateBps: 3000, capBps: 2100, daysInYear: 365 } })).toThrow(RangeError);
  });
});

describe("name lookup keys", () => {
  it("words that can pair strongly always share a key", () => {
    expect(nameLookupKey("KULKARNI")).toBe(nameLookupKey("KULKAR"));
    expect(nameLookupKey("RAJ")).toBe("RAJ");
    for (const [a, b] of [["Rahul Kulkarni", "RAHUL KULKAR"], ["Aamir Shaikh", "Shaikh Aamir"], ["Sunita Rao", "SUNITA RAO"]]) {
      expect(nameMatchStrength(a, b)).not.toBe("NONE");
      const keysB = new Set(nameWords(b).map(nameLookupKey));
      expect(nameWords(a).some((w) => keysB.has(nameLookupKey(w)))).toBe(true);
    }
  });
});

describe("demo dataset adapter", () => {
  let flats: ReturnType<typeof flatContextsFromDataset>;
  beforeAll(() => {
    flats = flatContextsFromDataset(demoDataset());
  });

  it("gives one context per flat and indexes them all", () => {
    const context = buildMatchContext(flats);
    expect(context.flats).toHaveLength(2400);
    expect(context.flatsByCode.size).toBe(2400);
  });

  it("lists the open bills of the sample flats as of 2026-10-27", () => {
    const byCode = new Map(flats.map((f) => [f.code, f]));
    expect(byCode.get("T12-0408")?.openBills.map((b) => [b.dueOn, b.amountPaise])).toEqual([["2026-09-10", 637000n]]);
    expect(byCode.get("T21-1601")?.openBills.map((b) => [b.dueOn, b.amountPaise, b.paymentsOnBill.length])).toEqual([["2026-10-09", 1066000n, 1]]);
    expect(byCode.get("T15-0902")?.openBills.map((b) => b.dueOn)).toEqual(["2026-09-10", "2026-10-10"]);
    expect(byCode.get("T07-1203")?.openBills).toEqual([]);
  });
});
