import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeLateFee } from "@/domain/billing/late-fee";
import { type BillPositionInput, billPosition } from "@/domain/billing/position";
import { addDays } from "@/domain/time/calendar";
import { base, int, policy, randomInput, seededRandom, t21 } from "./position-helpers";

describe("BP1 billPosition: a bill with principal open is the same as before (D26, D35)", () => {
  it("T12-0408: ₹6,370 due 10 Sep, nothing paid, on 27 Oct is PRINCIPAL_OPEN, ₹6,370 plus ₹98", () => {
    const p = billPosition(base());
    expect(p).toMatchObject({ kind: "PRINCIPAL_OPEN", principalOutstandingPaise: 637_000n, feeComputedPaise: 9_800n, feeOutstandingPaise: 9_800n, amountDuePaise: 646_800n, settledOn: null, anomalies: [] });
  });

  it("T21-1601: ₹5,000 paid on 12 Oct leaves ₹5,660 plus ₹38, ₹5,698", () => {
    expect(billPosition(t21())).toMatchObject({ kind: "PRINCIPAL_OPEN", principalOutstandingPaise: 566_000n, feeComputedPaise: 3_800n, amountDuePaise: 569_800n });
  });

  it("a bill not yet due has no fee", () => {
    expect(billPosition(base({ dueOn: "2026-11-10" }))).toMatchObject({ kind: "PRINCIPAL_OPEN", feeComputedPaise: 0n, amountDuePaise: 637_000n });
  });

  it("agrees with computeLateFee for the fee", () => {
    const input = t21();
    expect(billPosition(input).feeComputedPaise).toBe(computeLateFee({ ...input }).feePaise);
  });
});

describe("BP2 billPosition: the seeded settled-late shape is SETTLED", () => {
  const fee = computeLateFee({ billAmountPaise: 637_000n, dueOn: "2026-09-10", asOf: "2026-09-20", payments: [], holds: [], policy }).feePaise;

  it("a LATE_FEE plus a PAYMENT of bill plus fee is SETTLED, with the date it was settled", () => {
    expect(fee).toBe(2_100n);
    const p = billPosition(base({ payments: [{ date: "2026-09-20", amountPaise: 637_000n + fee }], postedFees: [{ date: "2026-09-20", amountPaise: fee }] }));
    expect(p).toMatchObject({ kind: "SETTLED", amountDuePaise: 0n, feeOutstandingPaise: 0n, settledOn: "2026-09-20", anomalies: [] });
  });

  it("a bill paid on time with no fee is SETTLED", () => {
    expect(billPosition(base({ payments: [{ date: "2026-09-05", amountPaise: 637_000n }] }))).toMatchObject({ kind: "SETTLED", settledOn: "2026-09-05", anomalies: [] });
  });
});

describe("BP3 billPosition: principal paid, fee owed (D107)", () => {
  const principalOnly = (): Partial<BillPositionInput> => ({
    asOf: "2026-10-27",
    payments: [
      { date: "2026-10-12", amountPaise: 500_000n },
      { date: "2026-10-27", amountPaise: 566_000n },
    ],
    postedFees: [{ date: "2026-10-27", amountPaise: 3_800n }],
  });

  it("principal-only is FEE_ONLY and the amount due is the posted fee", () => {
    expect(billPosition(t21(principalOnly()))).toMatchObject({ kind: "FEE_ONLY", principalOutstandingPaise: 0n, feeOutstandingPaise: 3_800n, amountDuePaise: 3_800n, settledOn: "2026-10-27", anomalies: [] });
  });

  it("the fee does not grow after the principal is paid", () => {
    expect(billPosition(t21({ ...principalOnly(), asOf: "2026-12-31" })).amountDuePaise).toBe(3_800n);
  });

  it("a later payment of the fee in two parts settles it", () => {
    const first = { date: "2026-10-28", amountPaise: 1_800n };
    const second = { date: "2026-10-29", amountPaise: 2_000n };
    const part = billPosition(t21({ ...principalOnly(), asOf: "2026-10-28", payments: [...principalOnly().payments!, first] }));
    expect(part).toMatchObject({ kind: "FEE_ONLY", amountDuePaise: 2_000n });
    const done = billPosition(t21({ ...principalOnly(), asOf: "2026-10-29", payments: [...principalOnly().payments!, first, second] }));
    expect(done).toMatchObject({ kind: "SETTLED", amountDuePaise: 0n, settledOn: "2026-10-27" });
  });

  it("as of the day before the principal was paid, the bill is still PRINCIPAL_OPEN with the fee to that day", () => {
    expect(billPosition(t21({ ...principalOnly(), asOf: "2026-10-26" }))).toMatchObject({ kind: "PRINCIPAL_OPEN", feeComputedPaise: 3_700n, amountDuePaise: 569_700n, anomalies: [] });
  });
});

describe("BP4 billPosition: excess, reversals-as-input, adjustments", () => {
  const settledWithFee = (extra: Partial<BillPositionInput>) =>
    billPosition(t21({ payments: [{ date: "2026-10-12", amountPaise: 500_000n }, { date: "2026-10-27", amountPaise: 566_000n }], postedFees: [{ date: "2026-10-27", amountPaise: 3_800n }], ...extra }));

  it("a payment above the bill counts toward the fee", () => {
    const p = settledWithFee({ payments: [{ date: "2026-10-12", amountPaise: 500_000n }, { date: "2026-10-27", amountPaise: 567_000n }] });
    expect(p).toMatchObject({ kind: "FEE_ONLY", amountDuePaise: 2_800n });
  });

  it("an excess of the whole fee settles it, and a larger excess still reads SETTLED, never negative", () => {
    expect(settledWithFee({ payments: [{ date: "2026-10-12", amountPaise: 500_000n }, { date: "2026-10-27", amountPaise: 569_800n }] }).kind).toBe("SETTLED");
    expect(settledWithFee({ payments: [{ date: "2026-10-12", amountPaise: 500_000n }, { date: "2026-10-27", amountPaise: 700_000n }] }).amountDuePaise).toBe(0n);
  });

  it("a payment dated after asOf is ignored (a reversed payment is simply not passed in)", () => {
    const p = billPosition(t21({ asOf: "2026-10-27", payments: [{ date: "2026-10-12", amountPaise: 500_000n }, { date: "2026-10-28", amountPaise: 566_000n }] }));
    expect(p.kind).toBe("PRINCIPAL_OPEN");
  });

  it("a charge adjustment adds to the fee owed, a payment adjustment takes from it", () => {
    expect(settledWithFee({ adjustments: [{ date: "2026-10-28", direction: "CHARGE", amountPaise: 500n }], asOf: "2026-10-28" }).amountDuePaise).toBe(4_300n);
    expect(settledWithFee({ adjustments: [{ date: "2026-10-28", direction: "PAYMENT", amountPaise: 800n }], asOf: "2026-10-28" }).amountDuePaise).toBe(3_000n);
    expect(settledWithFee({ adjustments: [{ date: "2026-10-28", direction: "PAYMENT", amountPaise: 9_000n }], asOf: "2026-10-28" })).toMatchObject({ kind: "SETTLED", amountDuePaise: 0n });
  });

  it("an adjustment dated after asOf is ignored", () => {
    expect(settledWithFee({ adjustments: [{ date: "2026-10-30", direction: "PAYMENT", amountPaise: 800n }] }).amountDuePaise).toBe(3_800n);
  });

  it("adjustments move the fee of an open bill too, never below zero", () => {
    expect(billPosition(t21({ adjustments: [{ date: "2026-10-20", direction: "PAYMENT", amountPaise: 1_000n }] }))).toMatchObject({ feeOutstandingPaise: 2_800n, amountDuePaise: 568_800n });
    expect(billPosition(t21({ adjustments: [{ date: "2026-10-20", direction: "PAYMENT", amountPaise: 90_000n }] }))).toMatchObject({ feeOutstandingPaise: 0n, amountDuePaise: 566_000n });
  });
});

describe("BP5 billPosition: anomalies are flagged, not hidden", () => {
  it("FEE_POSTED_ON_OPEN_BILL: a posted fee on an open bill is flagged and not trusted", () => {
    const p = billPosition(t21({ postedFees: [{ date: "2026-10-20", amountPaise: 9_999n }] }));
    expect(p.anomalies).toEqual(["FEE_POSTED_ON_OPEN_BILL"]);
    expect(p).toMatchObject({ kind: "PRINCIPAL_OPEN", amountDuePaise: 569_800n });
  });

  it("FEE_NOT_POSTED: principal paid late with no fee posted still owes the computed fee", () => {
    const p = billPosition(t21({ asOf: "2026-10-27", payments: [{ date: "2026-10-12", amountPaise: 500_000n }, { date: "2026-10-27", amountPaise: 566_000n }] }));
    expect(p).toMatchObject({ kind: "FEE_ONLY", amountDuePaise: 3_800n, anomalies: ["FEE_NOT_POSTED"] });
  });

  it("no anomaly when the principal was paid on time and no fee was posted", () => {
    expect(billPosition(base({ payments: [{ date: "2026-09-10", amountPaise: 637_000n }] })).anomalies).toEqual([]);
  });

  it("a fee dated after asOf is not yet posted, so it is not an anomaly on the earlier date", () => {
    const p = billPosition(t21({ asOf: "2026-10-20", postedFees: [{ date: "2026-10-27", amountPaise: 3_800n }] }));
    expect(p.anomalies).toEqual([]);
  });
});

describe("BP6 billPosition: input order and validity", () => {
  it("the order of payments, fees and adjustments does not change the answer", () => {
    const payments = [{ date: "2026-10-12", amountPaise: 500_000n }, { date: "2026-10-27", amountPaise: 300_000n }, { date: "2026-10-27", amountPaise: 266_000n }];
    const adjustments = [{ date: "2026-10-27", direction: "CHARGE" as const, amountPaise: 100n }, { date: "2026-10-26", direction: "PAYMENT" as const, amountPaise: 50n }];
    const postedFees = [{ date: "2026-10-27", amountPaise: 1_000n }, { date: "2026-10-27", amountPaise: 2_800n }];
    const a = billPosition(t21({ payments, adjustments, postedFees }));
    const b = billPosition(t21({ payments: [...payments].reverse(), adjustments: [...adjustments].reverse(), postedFees: [...postedFees].reverse() }));
    expect(b).toEqual(a);
    expect(a.kind).toBe("FEE_ONLY");
  });

  it("two payments on the settling day settle on that day", () => {
    const p = billPosition(base({ payments: [{ date: "2026-09-20", amountPaise: 300_000n }, { date: "2026-09-20", amountPaise: 337_000n }], postedFees: [{ date: "2026-09-20", amountPaise: 2_100n }] }));
    expect(p.settledOn).toBe("2026-09-20");
  });

  it("holds still skip fee days", () => {
    const hold = { startedAt: Date.parse("2026-09-12T00:00:00+05:30"), endedAt: null };
    expect(billPosition(base({ holds: [hold] })).feeComputedPaise).toBeLessThan(billPosition(base()).feeComputedPaise);
  });

  it("a bad policy or a non-positive payment throws RangeError", () => {
    expect(() => billPosition(base({ policy: { ...policy, annualRateBps: 5000 } }))).toThrow(RangeError);
    expect(() => billPosition(base({ payments: [{ date: "2026-09-20", amountPaise: 0n }] }))).toThrow(RangeError);
  });
});

describe("BP7 billPosition: properties over 2,000 seeded random cases", () => {
  const r = seededRandom(20261107);
  const cases = Array.from({ length: 2000 }, () => randomInput(r));

  it("amount due is never negative and equals principal plus fee outstanding", () => {
    for (const input of cases) {
      const p = billPosition(input);
      expect(p.amountDuePaise >= 0n && p.feeOutstandingPaise >= 0n && p.principalOutstandingPaise >= 0n).toBe(true);
      expect(p.amountDuePaise).toBe(p.principalOutstandingPaise + p.feeOutstandingPaise);
      expect(p.kind === "SETTLED").toBe(p.amountDuePaise === 0n);
      expect((p.kind === "PRINCIPAL_OPEN") === (p.settledOn === null)).toBe(true);
    }
  });

  it("shuffling the input does not change the answer", () => {
    const s = seededRandom(7);
    for (const input of cases.slice(0, 500)) {
      const shuffled = { ...input, payments: [...input.payments].sort(() => s() - 0.5) };
      expect(billPosition(shuffled)).toEqual(billPosition(input));
    }
  });

  it("a settled bill never reopens as the date moves on, and the fee owed never grows once the principal is paid", () => {
    const s = seededRandom(11);
    for (const input of cases) {
      const first = billPosition(input);
      if (first.kind === "PRINCIPAL_OPEN") continue;
      const later = billPosition({ ...input, asOf: addDays(input.asOf, 1 + int(s, 60)) });
      expect(later.kind === "PRINCIPAL_OPEN").toBe(false);
      expect(later.amountDuePaise).toBe(first.amountDuePaise);
    }
  });

  it("the fee computed after the principal is paid equals the fee on the settling day", () => {
    for (const input of cases) {
      const p = billPosition(input);
      if (p.settledOn === null) continue;
      expect(p.feeComputedPaise).toBe(billPosition({ ...input, asOf: p.settledOn }).feeComputedPaise);
    }
  });
});

describe("BP8 billPosition: the domain rules", () => {
  it("is fast: 2,000 positions in well under a second", () => {
    const r = seededRandom(3);
    const inputs = Array.from({ length: 2000 }, () => randomInput(r));
    const start = performance.now();
    for (const input of inputs) billPosition(input);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("position.ts imports only inside src/domain and uses no Intl, node: modules, Math.random or Date.now", () => {
    const source = readFileSync("src/domain/billing/position.ts", "utf8");
    for (const match of source.matchAll(/from "([^"]+)"/g)) expect(match[1].startsWith(".")).toBe(true);
    expect(source).not.toMatch(/Intl\.|node:|Math\.random|Date\.now|Number\(/);
  });
});
