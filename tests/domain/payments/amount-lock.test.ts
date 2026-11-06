import { describe, expect, it } from "vitest";
import { type DueBill, type DueEntry, computeDues } from "@/domain/billing/dues";
import { defaultLateFeePolicy } from "@/domain/billing/late-fee";
import { lockAmount, sameAmount } from "@/domain/payments/amount-lock";

const bill = (id: string, period: string, dueOn: string, amountPaise: bigint): DueBill => ({ id, period, issuedOn: period, dueOn, amountPaise });
const payment = (id: string, billId: string, effectiveDate: string, amountPaise: bigint): DueEntry => ({ id, entryType: "PAYMENT", direction: "PAYMENT", amountPaise, effectiveDate, billId, reversesEntryId: null });
const policy = defaultLateFeePolicy;

describe("PY1 lockAmount: the OLDEST open bill, worked out by the same function as the Home (D99)", () => {
  it("T12-0408: ₹6,370 due 10 Sep, as of 27 Oct, is ₹6,370 principal plus ₹98 fee, ₹6,468", () => {
    const locked = lockAmount({ openBills: [bill("sep", "2026-09-01", "2026-09-10", 637_000n)], asOf: "2026-10-27", policy, payments: [] });
    expect(locked).toEqual({ billId: "sep", principalPaise: 637_000n, feePaise: 9_800n, totalPaise: 646_800n });
  });

  it("T21-1601: ₹5,000 paid on 12 Oct leaves ₹5,660 principal and ₹38 fee, ₹5,698", () => {
    const locked = lockAmount({ openBills: [bill("sep", "2026-10-01", "2026-10-09", 1_066_000n)], asOf: "2026-10-27", policy, payments: [payment("p1", "sep", "2026-10-12", 500_000n)] });
    expect(locked).toMatchObject({ principalPaise: 566_000n, feePaise: 3_800n, totalPaise: 569_800n });
  });

  it("T15-0902: two open bills lock the OLDEST one only", () => {
    const locked = lockAmount({ openBills: [bill("oct", "2026-10-01", "2026-10-10", 700_000n), bill("sep", "2026-09-01", "2026-09-10", 637_000n)], asOf: "2026-10-27", policy, payments: [] });
    expect(locked?.billId).toBe("sep");
    expect(locked?.principalPaise).toBe(637_000n);
  });

  it("skips a bill that is already paid and locks the next one", () => {
    const locked = lockAmount({ openBills: [bill("sep", "2026-09-01", "2026-09-10", 637_000n), bill("oct", "2026-10-01", "2026-10-10", 700_000n)], asOf: "2026-10-27", policy, payments: [payment("p1", "sep", "2026-09-20", 637_000n)] });
    expect(locked?.billId).toBe("oct");
  });

  it("a reversed payment does not count", () => {
    const reversal: DueEntry = { id: "r1", entryType: "REVERSAL", direction: "CHARGE", amountPaise: 637_000n, effectiveDate: "2026-09-25", billId: "sep", reversesEntryId: "p1" };
    const locked = lockAmount({ openBills: [bill("sep", "2026-09-01", "2026-09-10", 637_000n)], asOf: "2026-10-27", policy, payments: [payment("p1", "sep", "2026-09-20", 637_000n), reversal] });
    expect(locked?.billId).toBe("sep");
  });

  it("a bill not yet due has a zero fee and the total is the principal", () => {
    const locked = lockAmount({ openBills: [bill("nov", "2026-10-27", "2026-11-10", 637_000n)], asOf: "2026-10-27", policy, payments: [] });
    expect(locked).toEqual({ billId: "nov", principalPaise: 637_000n, feePaise: 0n, totalPaise: 637_000n });
  });

  it("the amount changes with the date: the next day is a larger fee, which is why a stale amount is refused", () => {
    const bills = [bill("sep", "2026-09-01", "2026-09-10", 637_000n)];
    const today = lockAmount({ openBills: bills, asOf: "2026-10-27", policy, payments: [] });
    const tomorrow = lockAmount({ openBills: bills, asOf: "2026-10-28", policy, payments: [] });
    expect(tomorrow!.totalPaise).toBeGreaterThan(today!.totalPaise);
    expect(sameAmount(today!.totalPaise, tomorrow!.totalPaise)).toBe(false);
  });

  it("is null when nothing is open", () => {
    expect(lockAmount({ openBills: [], asOf: "2026-10-27", policy, payments: [] })).toBeNull();
    expect(lockAmount({ openBills: [bill("sep", "2026-09-01", "2026-09-10", 637_000n)], asOf: "2026-10-27", policy, payments: [payment("p1", "sep", "2026-09-20", 637_000n)] })).toBeNull();
  });

  it("a bill issued after the day is not open yet", () => {
    expect(lockAmount({ openBills: [bill("dec", "2026-12-01", "2026-12-10", 637_000n)], asOf: "2026-10-27", policy, payments: [] })).toBeNull();
  });

  it("agrees with computeDues for the first open bill", () => {
    const bills = [bill("sep", "2026-09-01", "2026-09-10", 1_066_000n), bill("oct", "2026-10-01", "2026-10-10", 700_000n)];
    const payments = [payment("p1", "sep", "2026-10-12", 500_000n)];
    const dues = computeDues({ bills, entries: payments, policy, today: "2026-10-27" });
    const locked = lockAmount({ openBills: bills, asOf: "2026-10-27", policy, payments });
    expect(locked?.totalPaise).toBe(dues.openBills[0].outstandingPaise + dues.openBills[0].feePaise);
  });
});

describe("PY1 sameAmount", () => {
  it.each<[bigint, bigint, boolean]>([
    [100n, 100n, true],
    [100n, 101n, false],
    [0n, 0n, true],
    [646_800n, 646_800n, true],
    [646_800n, 64_680n, false],
  ])("%s and %s: %s", (a, b, expected) => {
    expect(sameAmount(a, b)).toBe(expected);
  });
});
