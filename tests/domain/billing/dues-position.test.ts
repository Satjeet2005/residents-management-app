import { describe, expect, it } from "vitest";
import { type DueBill, type DueEntry, computeDues, positionsForFlat } from "@/domain/billing/dues";
import { defaultLateFeePolicy } from "@/domain/billing/late-fee";

const policy = defaultLateFeePolicy;
const bill = (id: string, period: string, dueOn: string, amountPaise: bigint): DueBill => ({ id, period, issuedOn: period, dueOn, amountPaise });
const entry = (id: string, entryType: DueEntry["entryType"], direction: DueEntry["direction"], amountPaise: bigint, effectiveDate: string, billId: string | null, reversesEntryId: string | null = null): DueEntry => ({
  id,
  entryType,
  direction,
  amountPaise,
  effectiveDate,
  billId,
  reversesEntryId,
});
const pay = (id: string, billId: string, date: string, amount: bigint) => entry(id, "PAYMENT", "PAYMENT", amount, date, billId);
const fee = (id: string, billId: string, date: string, amount: bigint) => entry(id, "LATE_FEE", "CHARGE", amount, date, billId);

const oct = bill("oct", "2026-10-01", "2026-10-09", 1_066_000n);
const T21_PART = pay("p1", "oct", "2026-10-12", 500_000n);
/** What a principal-only payment of ₹5,660 on 27 Oct leaves in the ledger: a PAYMENT and a LATE_FEE of ₹38 dated the same day. */
const PRINCIPAL_ONLY = [pay("p2", "oct", "2026-10-27", 566_000n), fee("f1", "oct", "2026-10-27", 3_800n)];

describe("DP1 computeDues: figures that were right before are unchanged (FA3)", () => {
  it("T12-0408 owes ₹6,468, 47 days overdue", () => {
    const dues = computeDues({ bills: [bill("sep", "2026-09-01", "2026-09-10", 637_000n)], entries: [], policy, today: "2026-10-27" });
    expect(dues).toMatchObject({ status: "OVERDUE", amountDuePaise: 646_800n, oldest: { overdueDays: 47 } });
    expect(dues.openBills[0]).toMatchObject({ kind: "PRINCIPAL_OPEN", outstandingPaise: 637_000n, feePaise: 9_800n, anomalies: [] });
  });

  it("T21-1601 owes ₹5,698, partly paid, 18 days overdue", () => {
    const dues = computeDues({ bills: [oct], entries: [T21_PART], policy, today: "2026-10-27" });
    expect(dues).toMatchObject({ status: "PARTLY_PAID", amountDuePaise: 569_800n, oldest: { overdueDays: 18 } });
    expect(dues.partlyPaid).toMatchObject({ paidPaise: 500_000n, stillDuePaise: 566_000n, feePaise: 3_800n });
  });
});

describe("DP2 computeDues: principal paid, fee owed (D107)", () => {
  const today = "2026-10-27";

  it("is a LATE_FEE_DUE position of ₹38 with the working at the settling date", () => {
    const dues = computeDues({ bills: [oct], entries: [T21_PART, ...PRINCIPAL_ONLY], policy, today });
    expect(dues).toMatchObject({ status: "LATE_FEE_DUE", amountDuePaise: 3_800n, partlyPaid: null });
    expect(dues.openBills[0]).toMatchObject({ kind: "FEE_ONLY", outstandingPaise: 0n, feePaise: 3_800n, feeAccruedPaise: 3_800n, feePaidPaise: 0n, settledOn: "2026-10-27", overdueDays: 18, anomalies: [] });
    expect(dues.openBills[0].working?.roundedPaise).toBe(3_800n);
  });

  it("stays ₹38 later, and the working stays as of the day the principal was paid", () => {
    const dues = computeDues({ bills: [oct], entries: [T21_PART, ...PRINCIPAL_ONLY], policy, today: "2026-12-31" });
    expect(dues.amountDuePaise).toBe(3_800n);
    expect(dues.openBills[0]).toMatchObject({ settledOn: "2026-10-27", overdueDays: 18 });
  });

  it("a payment of part of the fee shows what was paid and what remains", () => {
    const dues = computeDues({ bills: [oct], entries: [T21_PART, ...PRINCIPAL_ONLY, pay("p3", "oct", "2026-10-28", 1_800n)], policy, today: "2026-10-28" });
    expect(dues.amountDuePaise).toBe(2_000n);
    expect(dues.openBills[0]).toMatchObject({ kind: "FEE_ONLY", feeAccruedPaise: 3_800n, feePaidPaise: 1_800n, feePaise: 2_000n });
  });

  it("paying the whole fee settles the bill: ALL_PAID, no open bill", () => {
    const dues = computeDues({ bills: [oct], entries: [entry("b0", "BILL", "CHARGE", 1_066_000n, "2026-10-01", "oct"), T21_PART, ...PRINCIPAL_ONLY, pay("p3", "oct", "2026-10-28", 3_800n)], policy, today: "2026-10-28" });
    expect(dues).toMatchObject({ status: "ALL_PAID", amountDuePaise: 0n, balancePaise: 0n });
    expect(dues.openBills).toEqual([]);
  });

  it("an older fee-only bill and a newer open bill are both open, the fee-only one first", () => {
    const sep = bill("sep", "2026-09-01", "2026-09-10", 637_000n);
    const entries = [pay("a", "sep", "2026-09-25", 637_000n), fee("b", "sep", "2026-09-25", 3_100n)];
    const dues = computeDues({ bills: [oct, sep], entries, policy, today });
    expect(dues.openBills.map((b) => [b.billId, b.kind])).toEqual([["sep", "FEE_ONLY"], ["oct", "PRINCIPAL_OPEN"]]);
    expect(dues.status).toBe("OVERDUE");
    expect(dues.amountDuePaise).toBe(3_100n + 1_066_000n + 6_300n);
  });

  it("an unposted fee is flagged FEE_NOT_POSTED but still owed", () => {
    const dues = computeDues({ bills: [oct], entries: [T21_PART, PRINCIPAL_ONLY[0]], policy, today });
    expect(dues.amountDuePaise).toBe(3_800n);
    expect(dues.openBills[0].anomalies).toEqual(["FEE_NOT_POSTED"]);
  });

  it("a reversed principal payment makes the bill PRINCIPAL_OPEN again, and its posted fee is flagged", () => {
    const reversal = entry("r1", "REVERSAL", "CHARGE", 566_000n, "2026-10-28", null, "p2");
    const dues = computeDues({ bills: [oct], entries: [T21_PART, ...PRINCIPAL_ONLY, reversal], policy, today: "2026-10-28" });
    expect(dues.openBills[0]).toMatchObject({ kind: "PRINCIPAL_OPEN", outstandingPaise: 566_000n, anomalies: ["FEE_POSTED_ON_OPEN_BILL"] });
  });
});

describe("DP3 positionsForFlat", () => {
  it("returns every issued bill oldest due date first, SETTLED ones too, and leaves out future bills", () => {
    const sep = bill("sep", "2026-09-01", "2026-09-10", 637_000n);
    const dec = bill("dec", "2026-12-01", "2026-12-10", 637_000n);
    const result = positionsForFlat({ bills: [oct, dec, sep], entries: [pay("a", "sep", "2026-09-05", 637_000n)], policy, asOf: "2026-10-27" });
    expect(result.map((p) => [p.bill.id, p.position.kind])).toEqual([["sep", "SETTLED"], ["oct", "PRINCIPAL_OPEN"]]);
  });

  it("ignores entries dated after asOf and entries of another bill", () => {
    const result = positionsForFlat({ bills: [oct], entries: [pay("x", "other", "2026-10-12", 1_066_000n), pay("y", "oct", "2026-11-12", 1_066_000n)], policy, asOf: "2026-10-27" });
    expect(result[0].position.kind).toBe("PRINCIPAL_OPEN");
    expect(result[0].payments).toEqual([]);
  });
});
