import { describe, expect, it } from "vitest";
import { computeLateFee } from "@/domain/billing/late-fee";
import { buildMatchContext, defaultMatchSettings } from "@/domain/matching/context";
import { matchRow } from "@/domain/matching/decide";
import { parseNarration } from "@/domain/matching/narration";
import { planPayment } from "@/domain/matching/plan";
import type { FlatContext, OpenBill } from "@/domain/matching/types";
import { addDays } from "@/domain/time/calendar";
import { createPrng, type Prng } from "@/domain/seed/prng";

const policy = defaultMatchSettings.lateFeePolicy;

/** A random flat with 1 to 3 open bills, some part paid, and a row date from a month before the first due date to 3 months after. */
function randomCase(rng: Prng, index: number): { flat: FlatContext; txnDate: string } {
  const first = addDays("2026-03-10", rng.int(0, 150));
  const bills: OpenBill[] = Array.from({ length: rng.int(1, 3) }, (_, i) => {
    const amountPaise = BigInt(rng.int(2_000, 20_000)) * 100n;
    const dueOn = addDays(first, 30 * i);
    const paid = rng.chance(0.4) ? BigInt(rng.int(1, Number(amountPaise / 100n) - 1)) * 100n : 0n;
    return { billKey: `bill-${index}-${i}`, amountPaise, dueOn, paymentsOnBill: paid === 0n ? [] : [{ date: addDays(dueOn, rng.int(-5, 40)), amountPaise: paid }] };
  });
  return { flat: { code: "T12-0408", residents: [], knownPayers: [], openBills: bills }, txnDate: addDays(first, rng.int(-30, 90 + 60)) };
}

/** What the credit must be: the first bill with principal unpaid, worked out straight from computeLateFee. */
function expectedDue(flat: FlatContext, txnDate: string) {
  for (const bill of flat.openBills) {
    const payments = bill.paymentsOnBill.filter((p) => p.date <= txnDate);
    const result = computeLateFee({ billAmountPaise: bill.amountPaise, dueOn: bill.dueOn, asOf: txnDate, payments, holds: [], policy });
    if (result.outstandingPaise > 0n) return { bill, result };
  }
  return null;
}

describe("X9 plan reconciliation", () => {
  it("500 random flats and dates: every AUTO row has one PAYMENT equal to the credit and a LATE_FEE equal to computeLateFee", () => {
    const rng = createPrng(20261105);
    let autos = 0;
    for (let i = 0; i < 500; i++) {
      const { flat, txnDate } = randomCase(rng, i);
      const expected = expectedDue(flat, txnDate);
      if (expected === null) continue;
      const credit = expected.result.outstandingPaise + expected.result.feePaise;
      const context = buildMatchContext([flat]);
      const narration = "UPI/402200118877/T12 408/maint";
      const d = matchRow(context, { txnDate, narrationRaw: narration, creditPaise: credit, debitPaise: 0n }, parseNarration(narration));
      expect(d.kind).toBe("AUTO_MATCH");
      autos++;
      const plan = d.plan?.entries ?? [];
      const payments = plan.filter((e) => e.entryType === "PAYMENT");
      const fees = plan.filter((e) => e.entryType === "LATE_FEE");
      expect(payments).toHaveLength(1);
      expect(payments[0].amountPaise).toBe(credit);
      expect(fees.map((e) => e.amountPaise)).toEqual(expected.result.feePaise > 0n ? [expected.result.feePaise] : []);
      expect(payments[0].amountPaise - (fees[0]?.amountPaise ?? 0n)).toBe(expected.result.outstandingPaise);
      expect(plan.every((e) => e.billKey === expected.bill.billKey && e.effectiveDate === txnDate)).toBe(true);
      expect(plan.map((e) => e.entryType)).toEqual(fees.length === 1 ? ["LATE_FEE", "PAYMENT"] : ["PAYMENT"]);
    }
    expect(autos).toBeGreaterThan(400);
  });

  it("a credit one paisa off the amount due is never AUTO, and planPayment refuses it", () => {
    const rng = createPrng(77);
    for (let i = 0; i < 200; i++) {
      const { flat, txnDate } = randomCase(rng, i);
      const expected = expectedDue(flat, txnDate);
      if (expected === null) continue;
      const due = expected.result.outstandingPaise + expected.result.feePaise;
      for (const credit of [due - 1n, due + 1n]) {
        if (credit <= 0n) continue;
        const narration = "UPI/402200118877/T12 408/maint";
        const d = matchRow(buildMatchContext([flat]), { txnDate, narrationRaw: narration, creditPaise: credit, debitPaise: 0n }, parseNarration(narration));
        expect(d.kind).toBe("QUEUE");
        expect(() => planPayment(flat, credit, txnDate, defaultMatchSettings)).toThrow(RangeError);
      }
    }
  });
});
