import { describe, expect, it } from "vitest";
import { buildMatchContext, defaultMatchSettings } from "@/domain/matching/context";
import { DECISION_RULES, matchRow } from "@/domain/matching/decide";
import { parseNarration } from "@/domain/matching/narration";
import type { FlatContext, MatchSettings, RowDecision } from "@/domain/matching/types";
import { bill, flat } from "./builders";

const SEPT = (key = "sep") => bill(key, 637000n, "2026-09-10");
const PART_PAID = bill("oct", 1066000n, "2026-10-09", [{ date: "2026-10-12", amountPaise: 500000n }]);

const FLATS: FlatContext[] = [
  flat("T12-0408", { residents: ["Swati Joshi", "Anil Joshi"], bills: [SEPT()] }),
  flat("T21-1601", { residents: ["Aamir Shaikh"], upi: ["aamir.s@demo"], bills: [PART_PAID] }),
  flat("T07-1203", { residents: ["Neeraj Kulkarni"], upi: ["neeraj.k@demo"] }),
  flat("T15-0902", { residents: ["Rohit Deshmukh"], bills: [bill("a", 858000n, "2026-09-10"), bill("b", 858000n, "2026-10-10")] }),
  flat("T01-1101", { residents: ["Ravi Menon"], upi: ["family@demo"], bills: [SEPT("m1")] }),
  flat("T11-0101", { residents: ["Gita Menon"], upi: ["family@demo"], bills: [SEPT("m2")] }),
  flat("T20-1601", { residents: ["Kiran Patil"], bills: [bill("big", 2600000n, "2026-10-10")] }),
];

const context = buildMatchContext(FLATS);

function decide(narration: string, creditPaise: bigint, options: { debitPaise?: bigint; settings?: MatchSettings; flats?: FlatContext[] } = {}): RowDecision {
  const ctx = options.flats === undefined && options.settings === undefined ? context : buildMatchContext(options.flats ?? FLATS, options.settings);
  return matchRow(ctx, { txnDate: "2026-10-27", narrationRaw: narration, creditPaise, debitPaise: options.debitPaise ?? 0n }, parseNarration(narration));
}
const codes = (d: RowDecision): string[] => d.reasons.map((r) => r.code);

describe("the rule table", () => {
  it("lists each rule once, in order, with a title", () => {
    expect(DECISION_RULES.map((r) => r.id)).toEqual(["M0", "M1", "M2", "M3", "M4", "M5", "M6", "M7"]);
    expect(DECISION_RULES.every((r) => r.title.length > 10)).toBe(true);
  });
});

describe("M0, M1, M2, M3: rows that need no flat", () => {
  it("M0 a row with no amount is ignored", () => {
    expect(decide("UPI/402200118877/T12 408", 0n)).toMatchObject({ kind: "IGNORE", ignoreKind: "NOT_MAINTENANCE" });
  });

  it("M0 a negative amount throws", () => {
    expect(() => decide("UPI/402200118877", -1n)).toThrow(RangeError);
  });

  it("M1 a debit is ignored", () => {
    const d = decide("UPI/402200118877/T12 408", 0n, { debitPaise: 646800n });
    expect(d).toMatchObject({ kind: "IGNORE", ignoreKind: "DEBIT", confidence: "NONE", flatCode: null, plan: null, candidates: [], totalCandidates: 0 });
    expect(codes(d)).toEqual(["DEBIT"]);
  });

  it("M1 a debit that is a bank charge is still ignored as a DEBIT, and says so", () => {
    const d = decide("SMS CHARGES", 0n, { debitPaise: 2950n });
    expect(d).toMatchObject({ kind: "IGNORE", ignoreKind: "DEBIT" });
    expect(codes(d)).toEqual(["DEBIT", "BANK_CHARGE"]);
  });

  it("M1 a returned cheque on the debit side is queued, never ignored", () => {
    const d = decide("CHQ RET 123456 T12 408", 0n, { debitPaise: 646800n });
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "NONE", plan: null });
    expect(d.reasons).toEqual([{ code: "CHEQUE_RETURN", text: "Cheque returned: a person must reverse the matching payment" }]);
  });

  it("M2 interest and bank charges credited are ignored with their own kind", () => {
    expect(decide("INT PD 01-07-2026 TO 30-09-2026", 120000n)).toMatchObject({ kind: "IGNORE", ignoreKind: "INTEREST" });
    expect(decide("SMS CHARGES REVERSAL", 2950n)).toMatchObject({ kind: "IGNORE", ignoreKind: "BANK_CHARGE" });
  });

  it("M3 a credit with no narration is queued with no candidates, even if an amount fits a flat", () => {
    for (const narration of ["", "   "]) {
      const d = decide(narration, 646800n);
      expect(d).toMatchObject({ kind: "QUEUE", confidence: "NONE", candidates: [], totalCandidates: 0, plan: null });
      expect(codes(d)).toEqual(["NO_NARRATION"]);
    }
  });
});

describe("M4: an automatic match needs every condition", () => {
  it("a code and the exact amount due on the oldest bill", () => {
    const d = decide("UPI/402200118877/T12 408/maint", 646800n);
    expect(d).toMatchObject({ kind: "AUTO_MATCH", confidence: "HIGH", flatCode: "T12-0408", totalCandidates: 1 });
    expect(codes(d)).toEqual(["CODE_FOUND", "AMOUNT_EQUALS_DUE"]);
    expect(d.plan?.entries.map((e) => [e.entryType, e.amountPaise])).toEqual([["LATE_FEE", 9800n], ["PAYMENT", 646800n]]);
  });

  it("a known UPI id and the exact amount due", () => {
    const d = decide("UPI/402200118877/aamir.s@demo/maint", 569800n);
    expect(d).toMatchObject({ kind: "AUTO_MATCH", flatCode: "T21-1601" });
    expect(codes(d)).toEqual(["PAYER_KNOWN", "AMOUNT_EQUALS_DUE"]);
  });

  it("M4a a second flat with CODE evidence queues it", () => {
    const d = decide("UPI/402200118877/T12 408 and T07 1203", 646800n);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "MEDIUM", flatCode: null });
    expect(codes(d)).toContain("CODE_CONFLICT");
  });

  it("M4b an ambiguous flat token queues it", () => {
    const d = decide("UPI/402200118877/T12 408 T1 1101", 646800n);
    expect(d.kind).toBe("QUEUE");
    expect(codes(d)).toContain("CODE_AMBIGUOUS");
  });

  it("M4b a code for a flat that is not in the society, beside a real one, queues it", () => {
    expect(decide("UPI/402200118877/T12 408 T28 1608", 646800n).kind).toBe("QUEUE");
  });

  it("M4c/M9 a UPI id that two flats list is never a payer, and never auto", () => {
    const d = decide("UPI/402200118877/family@demo", 646800n);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "LOW", flatCode: null });
    expect(d.reasons).toContainEqual({ code: "PAYER_SHARED", text: "UPI id is registered to more than one flat" });
    expect(d.candidates.flatMap((c) => c.evidence)).toEqual(["PAYER_SHARED", "PAYER_SHARED"]);
  });

  it("M4c a shared UPI id with a code on one of its flats is still not automatic", () => {
    const d = decide("UPI/402200118877/family@demo/T01-1101", 646800n);
    expect(d.kind).toBe("QUEUE");
    expect(codes(d)).toContain("PAYER_SHARED");
  });

  it("M4d a code for one flat and a UPI id for another is queued with the reason", () => {
    const d = decide("UPI/402200118877/aamir.s@demo/T12 408", 646800n);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "MEDIUM", flatCode: null });
    expect(d.reasons).toContainEqual({ code: "CODE_CONFLICT", text: "Flat code and UPI id point to different flats" });
    expect(d.candidates.map((c) => c.flatCode)).toEqual(["T12-0408", "T21-1601"]);
  });

  it("M4d a code for a flat that is not in the society and a UPI id of a real one is queued", () => {
    expect(decide("UPI/402200118877/aamir.s@demo/T28 1608", 569800n).kind).toBe("QUEUE");
  });

  it("M4e the oldest bill only: the second bill's amount alone is not the amount due", () => {
    expect(decide("UPI/402200118877/T15 902", 858000n).kind).toBe("QUEUE");
  });

  it("M4f/M8 a credit at or above the threshold is never automatic; one paisa below is", () => {
    const flats = [flat("T12-0408", { bills: [SEPT()] })];
    const at: MatchSettings = { ...defaultMatchSettings, approvalThresholdPaise: 646800n };
    const above = decide("UPI/402200118877/T12 408", 646800n, { settings: at, flats });
    expect(above).toMatchObject({ kind: "QUEUE", confidence: "MEDIUM", flatCode: "T12-0408" });
    expect(above.reasons).toContainEqual({ code: "ABOVE_THRESHOLD", text: "Needs a second approver when posted" });
    const below = decide("UPI/402200118877/T12 408", 646800n, { settings: { ...at, approvalThresholdPaise: 646801n }, flats });
    expect(below.kind).toBe("AUTO_MATCH");
  });

  it("M4g a credit whose narration says a cheque was returned is never automatic", () => {
    const d = decide("CHQ RETURNED T12 408", 646800n);
    expect(d.kind).toBe("QUEUE");
    expect(codes(d)).toContain("CHEQUE_RETURN");
  });
});

describe("M4h: a note that says advance or several months blocks an automatic match", () => {
  it.each(["ADV", "advance", "3 months", "3 mths", "2 month"])("the note %s queues a payment of exactly one bill", (note) => {
    const d = decide(`UPI/402200118877/T12 408/${note}`, 646800n);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "MEDIUM", flatCode: "T12-0408", plan: null });
    expect(d.reasons).toContainEqual({ code: "HINT_CONFLICT", text: "The note says advance or several months, but the amount equals one bill." });
  });

  it.each(["1 month", "maint", "rent 1 mth"])("the note %s does not stop an automatic match", (note) => {
    expect(decide(`UPI/402200118877/T12 408/${note}`, 646800n).kind).toBe("AUTO_MATCH");
  });
});

describe("M5: identity evidence that is not enough, medium confidence, explained", () => {
  const reasonText = (d: RowDecision, code: string) => d.reasons.find((r) => r.code === code)?.text;

  it("principal only: names the fee that would remain", () => {
    const d = decide("UPI/402200118877/aamir.s@demo", 566000n);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "MEDIUM", flatCode: "T21-1601" });
    expect(reasonText(d, "AMOUNT_PRINCIPAL_ONLY")).toBe("Amount equals the unpaid bill but not the late fee: ₹38 would remain");
  });

  it("less than the amount due", () => {
    expect(reasonText(decide("UPI/402200118877/T12 408", 300000n), "AMOUNT_LESS")).toBe("Amount is less than the amount due");
  });

  it("more than the amount due, such as two months", () => {
    expect(reasonText(decide("UPI/402200118877/T12 408", 1274000n), "AMOUNT_MORE")).toBe("More than the amount due: possible advance or several months");
  });

  it("no open bill on the flat", () => {
    const d = decide("UPI/402200118877/neeraj.k@demo", 646800n);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "MEDIUM", flatCode: "T07-1203" });
    expect(reasonText(d, "NO_OPEN_BILL")).toBe("No open bill on this flat");
  });

  it("puts the flat with identity evidence first", () => {
    const d = decide("NEFT-N30112345678-SWATI JOSHI-T07 1203", 646800n);
    expect(d.candidates[0].flatCode).toBe("T07-1203");
    expect(d.kind).toBe("QUEUE");
  });
});

describe("M6: names and amounts, no identity, low confidence", () => {
  it("a name alone, even an exact one with the right amount, is queued", () => {
    const d = decide("NEFT-N30112345678-SWATI JOSHI-maint", 646800n);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "LOW", flatCode: null });
    expect(d.candidates[0]).toMatchObject({ flatCode: "T12-0408", evidence: ["NAME_EXACT"], amountRelation: "EQUALS_DUE" });
    expect(codes(d)).toContain("NAME_EXACT");
  });

  it("an amount alone, even when one flat needs it, is queued and says so", () => {
    const d = decide("UPI/402200118877/stranger@demo", 646800n);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "LOW", flatCode: null, totalCandidates: 3 });
    expect(d.reasons[0]).toEqual({ code: "MULTIPLE_FLATS_OWE", text: "3 flats owe ₹6,468" });
  });

  it("one flat that owes the amount: the reason says an amount alone is not enough", () => {
    const d = decide("UPI/402200118877/stranger@demo", 569800n);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "LOW", totalCandidates: 1 });
    expect(d.reasons[0].text).toContain("An amount alone does not say who paid");
  });

  it("lists at most 5 candidates and counts them all", () => {
    const many = Array.from({ length: 8 }, (_, i) => flat(`T0${i + 1}-0101`, { bills: [SEPT(`k${i}`)] }));
    const d = decide("UPI/402200118877/stranger@demo", 646800n, { flats: many });
    expect(d.candidates).toHaveLength(5);
    expect(d.totalCandidates).toBe(8);
    expect(d.reasons[0]).toEqual({ code: "MULTIPLE_FLATS_OWE", text: "8 flats owe ₹6,468" });
  });

  it("a credit at the threshold with no identity carries the threshold reason", () => {
    const d = decide("UPI/402200118877/stranger@demo", 2_600_000n + 0n, { flats: FLATS });
    expect(d.kind).toBe("QUEUE");
    expect(codes(d)).toContain("ABOVE_THRESHOLD");
  });
});

describe("M7: nothing fits", () => {
  it("queues with no confidence and the plain reason", () => {
    const d = decide("UPI/402200118877/stranger@demo/gift", 12345n);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "NONE", flatCode: null, candidates: [], totalCandidates: 0, plan: null });
    expect(d.reasons).toEqual([{ code: "NO_MATCH", text: "No flat found. May not be a maintenance payment." }]);
  });

  it("notes a flat code that is not a flat in this society", () => {
    const d = decide("UPI/402200118877/T28 1608", 12345n);
    expect(d.reasons.map((r) => r.text)).toEqual(["No flat found. May not be a maintenance payment.", "Flat code T28-1608 is not a flat in this society"]);
  });
});

describe("every decision", () => {
  it("has a reason, and a queued or ignored one has no plan", () => {
    const narrations = ["", "UPI/402200118877/T12 408", "UPI/402200118877/family@demo", "NEFT-N30112345678-SWATI JOSHI", "SMS CHARGES", "x", "CHQ RET 123456"];
    for (const narration of narrations) {
      for (const credit of [0n, 100n, 646800n, 569800n, 3_000_000n]) {
        const d = decide(narration, credit);
        expect(d.reasons.length).toBeGreaterThan(0);
        if (d.kind !== "AUTO_MATCH") expect(d.plan).toBeNull();
        expect(d.candidates.length).toBeLessThanOrEqual(5);
      }
    }
  });
});
