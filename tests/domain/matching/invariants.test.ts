import { describe, expect, it } from "vitest";
import { buildMatchContext, defaultMatchSettings } from "@/domain/matching/context";
import { matchRow } from "@/domain/matching/decide";
import { parseNarration } from "@/domain/matching/narration";
import type { FlatContext, MatchSettings, RowDecision } from "@/domain/matching/types";
import { bill, flat } from "./builders";

const SEPT = (key = "sep", amount = 637000n) => bill(key, amount, "2026-09-10");
const DUE = 646800n; // 637000 plus the 47-day fee of 9800 on 2026-10-27

const FLATS: FlatContext[] = [
  flat("T12-0408", { residents: ["Swati Joshi"], bills: [SEPT()] }),
  flat("T21-1601", { residents: ["Aamir Shaikh"], upi: ["aamir.s@demo"], bills: [bill("oct", 1066000n, "2026-10-09", [{ date: "2026-10-12", amountPaise: 500000n }])] }),
  flat("T07-1203", { residents: ["Neeraj Kulkarni"] }),
  flat("T15-0902", { residents: ["Rohit Deshmukh"], bills: [bill("a", 858000n, "2026-09-10"), bill("b", 858000n, "2026-10-10")] }),
  flat("T01-1101", { residents: ["Ravi Menon"], upi: ["family@demo"], bills: [SEPT("m1")] }),
  flat("T11-0101", { residents: ["Gita Menon"], upi: ["family@demo"], bills: [SEPT("m2")] }),
];

function decide(narration: string, creditPaise: bigint, options: { debitPaise?: bigint; settings?: MatchSettings; flats?: FlatContext[] } = {}): RowDecision {
  const context = buildMatchContext(options.flats ?? FLATS, options.settings);
  return matchRow(context, { txnDate: "2026-10-27", narrationRaw: narration, creditPaise, debitPaise: options.debitPaise ?? 0n }, parseNarration(narration));
}
const codes = (d: RowDecision): string[] => d.reasons.map((r) => r.code);

describe("X1 exactly one flat", () => {
  it("a code on flat A and a known payer on flat B is QUEUE, not AUTO", () => {
    const d = decide("UPI/402200118877/aamir.s@demo/T12 408", DUE);
    expect(d.kind).toBe("QUEUE");
    expect(d.plan).toBeNull();
  });

  it("two different codes is QUEUE, even when the amount is right for one", () => {
    expect(decide("UPI/402200118877/T12 408 T07 1203", DUE).kind).toBe("QUEUE");
    expect(decide("UPI/402200118877/T12 408 T01 1101", DUE).kind).toBe("QUEUE");
  });

  it("the same code written twice, or a code and its payer on one flat, is still one flat", () => {
    expect(decide("UPI/402200118877/T12 408 maint T12-0408", DUE, { flats: [FLATS[0]] }).kind).toBe("AUTO_MATCH");
    expect(decide("UPI/402200118877/aamir.s@demo/T21 1601", 569800n).kind).toBe("AUTO_MATCH");
  });
});

describe("X2 a shared UPI id never auto-matches", () => {
  it("whatever the amount, the code or the name", () => {
    const narrations = ["UPI/402200118877/family@demo", "UPI/402200118877/family@demo/T01 1101", "UPI/402200118877/FAMILY@DEMO/T11 101", "NEFT-N30112345678-RAVI MENON-family@demo"];
    for (const narration of narrations) {
      for (const credit of [DUE, 637000n, 100n, 2_600_000n]) {
        expect(decide(narration, credit).kind).not.toBe("AUTO_MATCH");
      }
    }
  });

  it("is the same when only one of the two flats could owe the amount", () => {
    const flats = [flat("T01-1101", { upi: ["family@demo"], bills: [SEPT()] }), flat("T11-0101", { upi: ["family@demo"] })];
    const d = decide("UPI/402200118877/family@demo/T01 1101", DUE, { flats });
    expect(d.kind).toBe("QUEUE");
    expect(codes(d)).toContain("PAYER_SHARED");
  });
});

describe("X3 names alone and amounts alone never auto-match", () => {
  // Why: two people can share a name, the person who pays may pay for a neighbour, and a bank may cut a name short.
  // An amount fits every flat of the same size (hundreds in the demo society), and one flat owing it today does not make it the payer.
  it("an exact name with exactly the amount due is QUEUE, confidence LOW", () => {
    for (const name of ["SWATI JOSHI", "JOSHI SWATI", "Swati Joshi", "SWATI J", "SWATI JOSH"]) {
      const d = decide(`NEFT-N30112345678-${name}-maint`, DUE);
      expect(d).toMatchObject({ kind: "QUEUE", confidence: "LOW" });
    }
  });

  it("an amount that exactly one flat owes is QUEUE, confidence LOW", () => {
    const d = decide("UPI/402200118877/stranger@demo", 569800n);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "LOW", totalCandidates: 1 });
  });

  it("a name that also matches the amount due on a flat still needs a code or payer", () => {
    expect(decide("NEFT-N30112345678-AAMIR SHAIKH", 569800n).kind).toBe("QUEUE");
  });
});

describe("X4 an ambiguous flat token never auto-matches", () => {
  it("T1 1101 fits T01-1101 and T11-0101", () => {
    const d = decide("UPI/402200118877/T1 1101", DUE);
    expect(d.kind).toBe("QUEUE");
    // An ambiguous token is not identity, so the amount-only flat T12-0408 is listed too.
    expect(d.candidates.map((c) => c.flatCode)).toEqual(["T01-1101", "T11-0101", "T12-0408"]);
    expect(codes(d)).toContain("CODE_AMBIGUOUS");
  });

  it("not even with a payer that agrees", () => {
    const flats = [flat("T01-1101", { upi: ["ravi@demo"], bills: [SEPT()] }), flat("T11-0101")];
    expect(decide("UPI/402200118877/ravi@demo/T1 1101", DUE, { flats }).kind).toBe("QUEUE");
  });
});

describe("X5 only the amount due on the oldest bill auto-matches", () => {
  const T15 = "UPI/402200118877/T15 902";
  const T12 = "UPI/402200118877/T12 408";
  const cases: [string, string, bigint, string][] = [
    ["principal only", T12, 637000n, "AMOUNT_PRINCIPAL_ONLY"],
    ["one paisa less", T12, DUE - 1n, "AMOUNT_LESS"],
    ["one paisa more", T12, DUE + 1n, "AMOUNT_MORE"],
    ["half", T12, 318500n, "AMOUNT_LESS"],
    ["two months (k times a bill)", T12, 637000n * 2n, "AMOUNT_MORE"],
    ["three months (k times a bill)", T12, 637000n * 3n, "AMOUNT_MORE"],
    ["both bills of T15 combined", T15, 871300n + 862800n, "AMOUNT_MORE"],
    ["the newer bill's amount on T15", T15, 858000n, "AMOUNT_PRINCIPAL_ONLY"],
    ["a flat with no open bill", "UPI/402200118877/T07 1203", DUE, "NO_OPEN_BILL"],
  ];
  it.each(cases)("%s is QUEUE with the right reason", (_name, narration, credit, reasonCode) => {
    const d = decide(narration, credit);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "MEDIUM", plan: null });
    expect(codes(d)).toContain(reasonCode);
  });

  it("the amount due on the oldest bill, with a code, is AUTO", () => {
    expect(decide(T12, DUE, { flats: [FLATS[0]] }).kind).toBe("AUTO_MATCH");
    expect(decide(T15, 871300n).kind).toBe("AUTO_MATCH");
  });
});

describe("X6 the approval threshold", () => {
  const big = (amount: bigint): FlatContext[] => [flat("T12-0408", { bills: [bill("b", amount, "2026-11-10")] })];
  const row = (amount: bigint) => decide("UPI/402200118877/T12 408", amount, { flats: big(amount) });

  it("one paisa below the default 25,000 rupees is AUTO", () => {
    expect(defaultMatchSettings.approvalThresholdPaise).toBe(2_500_000n);
    expect(row(2_499_999n).kind).toBe("AUTO_MATCH");
  });

  it("at the threshold and above it is QUEUE with the reason", () => {
    for (const amount of [2_500_000n, 2_500_001n, 9_000_000n]) {
      const d = row(amount);
      expect(d.kind).toBe("QUEUE");
      expect(codes(d)).toContain("ABOVE_THRESHOLD");
      expect(d.plan).toBeNull();
    }
  });

  it("follows the setting, not a constant", () => {
    const settings: MatchSettings = { ...defaultMatchSettings, approvalThresholdPaise: 600_000n };
    expect(decide("UPI/402200118877/T12 408", 637000n, { flats: big(637000n), settings }).kind).toBe("QUEUE");
    expect(decide("UPI/402200118877/T12 408", 637000n, { flats: big(637000n) }).kind).toBe("AUTO_MATCH");
  });
});

describe("X7 debits, interest, bank charges and cheque returns", () => {
  it("debits are IGNORE", () => {
    for (const narration of ["UPI/402200118877/T12 408", "NEFT-N30112345678-SWATI JOSHI", "ATM WDL", ""]) {
      expect(decide(narration, 0n, { debitPaise: DUE })).toMatchObject({ kind: "IGNORE", ignoreKind: "DEBIT", plan: null });
    }
  });

  it("interest and bank charges are IGNORE", () => {
    expect(decide("INT PD 01-07-2026 TO 30-09-2026", 12345n)).toMatchObject({ kind: "IGNORE", ignoreKind: "INTEREST" });
    expect(decide("INTEREST CREDIT T12 408", DUE)).toMatchObject({ kind: "IGNORE", ignoreKind: "INTEREST" });
    expect(decide("SMS CHARGES T12 408", DUE)).toMatchObject({ kind: "IGNORE", ignoreKind: "BANK_CHARGE" });
    expect(decide("AMC CHARGES", 5000n)).toMatchObject({ kind: "IGNORE", ignoreKind: "BANK_CHARGE" });
  });

  it("a cheque return is QUEUE, as a debit and as a credit", () => {
    expect(decide("CHQ RET 123456 T12 408", 0n, { debitPaise: DUE })).toMatchObject({ kind: "QUEUE", plan: null });
    expect(decide("RETURNED CHEQUE 123456 T12 408", DUE)).toMatchObject({ kind: "QUEUE", plan: null });
  });
});
