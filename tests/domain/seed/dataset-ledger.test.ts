import { describe, expect, it } from "vitest";
import { computeLateFee, defaultLateFeePolicy } from "@/domain/billing/late-fee";
import { DEMO_AS_OF, type DemoBill, type DemoDataset, type DemoLedgerEntry } from "@/domain/seed/types";
import { diffDays } from "@/domain/time/calendar";
import { FORCED_CODES, defaultDataset } from "./default-dataset";

const dataset = defaultDataset();
const bill = (code: string, period: string) => dataset.bills.find((b) => b.key === `bill:${code}:${period}`)!;

function entriesOfBill(data: DemoDataset, billKey: string): DemoLedgerEntry[] {
  return data.ledgerEntries.filter((e) => e.billKey === billKey);
}

function lateFeeOf(b: DemoBill, asOf: string, data: DemoDataset) {
  const payments = entriesOfBill(data, b.key)
    .filter((e) => e.entryType === "PAYMENT")
    .map((e) => ({ date: e.effectiveDate, amountPaise: e.amountPaise }));
  return computeLateFee({
    billAmountPaise: b.amountPaise,
    dueOn: b.dueOn,
    asOf,
    payments,
    holds: [],
    policy: defaultLateFeePolicy,
  });
}

/** What a flat owes as of the demo date: for each bill with something outstanding, that plus its computed fee. */
function position(code: string) {
  const flatKey = `flat:${code}`;
  const open = dataset.bills
    .filter((b) => b.flatKey === flatKey)
    .map((b) => ({ bill: b, result: lateFeeOf(b, DEMO_AS_OF, dataset) }))
    .filter(({ result }) => result.outstandingPaise > 0n);
  const amountDue = open.reduce((sum, { result }) => sum + result.outstandingPaise + result.feePaise, 0n);
  return { open, amountDue };
}

/** Independent of computeLateFee: 12% a year, 365-day year, rounded once to whole rupees, half up. */
function expectedFee(billPaise: bigint, overdueDays: bigint): bigint {
  const rupees = (2n * billPaise * 1200n * overdueDays + 3_650_000n * 100n) / (2n * 3_650_000n * 100n);
  return rupees * 100n;
}

describe("S4 fixtures through the domain code, as of 2026-10-27", () => {
  it("S4 T12-0408 owes 646800: one unpaid bill, 47 days overdue", () => {
    const { open, amountDue } = position("T12-0408");
    expect(open).toHaveLength(1);
    expect(open[0].bill.period).toBe("2026-09-01");
    expect(open[0].result.overdueDays).toBe(47);
    expect(open[0].result.feePaise).toBe(9800n);
    expect(amountDue).toBe(646800n);
  });

  it("S4 T21-1601 owes 569800: due 2026-10-09, 18 days overdue, 500000 paid on 2026-10-12", () => {
    const { open, amountDue } = position("T21-1601");
    expect(open).toHaveLength(1);
    expect(open[0].bill.dueOn).toBe("2026-10-09");
    expect(open[0].result.overdueDays).toBe(18);
    expect(open[0].result.outstandingPaise).toBe(566000n);
    expect(open[0].result.feePaise).toBe(3800n);
    expect(amountDue).toBe(569800n);
    const payments = dataset.ledgerEntries.filter((e) => e.flatKey === "flat:T21-1601" && e.effectiveDate >= "2026-10-01");
    expect(payments.filter((e) => e.entryType === "PAYMENT").map((e) => [e.amountPaise, e.effectiveDate])).toEqual([[500000n, "2026-10-12"]]);
  });

  it("S4 T07-1203 owes nothing", () => {
    expect(position("T07-1203").amountDue).toBe(0n);
    expect(position("T07-1203").open).toHaveLength(0);
    const october = dataset.ledgerEntries.find((e) => e.key === "payment:T07-1203:2026-10-01")!;
    expect([october.amountPaise, october.effectiveDate]).toEqual([747500n, "2026-10-03"]);
  });

  it("S4 T15-0902 has two unpaid bills, 47 and 17 days overdue", () => {
    const { open, amountDue } = position("T15-0902");
    expect(open.map(({ bill: b }) => b.period)).toEqual(["2026-09-01", "2026-10-01"]);
    expect(open.map(({ result }) => result.overdueDays)).toEqual([47, 17]);
    const bills = open.map(({ bill: b }) => b.amountPaise);
    expect(bills).toEqual([858000n, 858000n]);
    expect(amountDue).toBe(858000n + expectedFee(858000n, 47n) + 858000n + expectedFee(858000n, 17n));
    expect(amountDue).toBe(1_734_100n);
  });

  it.each(["T03-0702", "T18-1105", "T26-0301"])("S4 %s owes 1066000 plus the fee for 17 days", (code) => {
    const { open, amountDue } = position(code);
    expect(open).toHaveLength(1);
    expect(open[0].result.overdueDays).toBe(17);
    expect(amountDue).toBe(1066000n + expectedFee(1066000n, 17n));
    expect(amountDue).toBe(1_072_000n);
  });
});

describe("S5 ledger rules", () => {
  it("S5 only BILL, LATE_FEE and PAYMENT entries; every amount is positive; types map to directions", () => {
    for (const entry of dataset.ledgerEntries) {
      expect(entry.amountPaise > 0n).toBe(true);
      expect(["BILL", "LATE_FEE", "PAYMENT"]).toContain(entry.entryType);
      expect(entry.direction).toBe(entry.entryType === "PAYMENT" ? "PAYMENT" : "CHARGE");
    }
  });

  it("S5 idempotency keys are unique and references are unique where present, and look fictional", () => {
    expect(new Set(dataset.ledgerEntries.map((e) => e.idempotencyKey)).size).toBe(dataset.ledgerEntries.length);
    const references = dataset.ledgerEntries.map((e) => e.reference).filter((r): r is string => r !== null);
    expect(new Set(references).size).toBe(references.length);
    for (const reference of references) expect(reference).toMatch(/^SEED-(UPI|NEFT|CHQ)-T\d\d-\d{4}-\d{4}-\d\d-\d\d$/);
    for (const entry of dataset.ledgerEntries) {
      expect(entry.idempotencyKey.startsWith("seed:")).toBe(true);
      expect(entry.reference !== null).toBe(entry.entryType === "PAYMENT");
    }
  });

  it("S5 no entry is dated after 2026-10-27 or before its bill's issue date", () => {
    const bills = new Map(dataset.bills.map((b) => [b.key, b]));
    for (const entry of dataset.ledgerEntries) {
      expect(entry.effectiveDate <= DEMO_AS_OF).toBe(true);
      expect(entry.effectiveDate >= bills.get(entry.billKey!)!.issuedOn).toBe(true);
    }
  });

  it("S5 every bill has exactly one BILL charge on its issue date, for its amount", () => {
    for (const b of dataset.bills) {
      const charges = entriesOfBill(dataset, b.key).filter((e) => e.entryType === "BILL");
      expect(charges).toHaveLength(1);
      expect([charges[0].amountPaise, charges[0].effectiveDate, charges[0].key]).toEqual([b.amountPaise, b.issuedOn, b.key]);
    }
  });

  it("S5 for every fully settled bill, payments equal the bill plus its late fees", () => {
    let settled = 0;
    for (const b of dataset.bills) {
      const entries = entriesOfBill(dataset, b.key);
      const paid = entries.filter((e) => e.entryType === "PAYMENT").reduce((sum, e) => sum + e.amountPaise, 0n);
      if (paid < b.amountPaise) continue;
      settled++;
      const fees = entries.filter((e) => e.entryType === "LATE_FEE").reduce((sum, e) => sum + e.amountPaise, 0n);
      expect(paid).toBe(b.amountPaise + fees);
    }
    expect(settled).toBeGreaterThan(9000);
  });

  it("S5 each LATE_FEE equals computeLateFee as of its payment date, and a bill paid on time has none", () => {
    let fees = 0;
    for (const b of dataset.bills) {
      const entries = entriesOfBill(dataset, b.key);
      const fee = entries.find((e) => e.entryType === "LATE_FEE");
      const payment = entries.find((e) => e.entryType === "PAYMENT");
      if (fee === undefined) {
        if (payment !== undefined && payment.amountPaise >= b.amountPaise) expect(payment.effectiveDate <= b.dueOn).toBe(true);
        continue;
      }
      fees++;
      expect(fee.effectiveDate).toBe(payment!.effectiveDate);
      expect(fee.effectiveDate > b.dueOn).toBe(true);
      expect(fee.amountPaise).toBe(
        computeLateFee({ billAmountPaise: b.amountPaise, dueOn: b.dueOn, asOf: fee.effectiveDate, payments: [], holds: [], policy: defaultLateFeePolicy }).feePaise,
      );
      expect(fee.amountPaise).toBe(expectedFee(b.amountPaise, BigInt(diffDays(b.dueOn, fee.effectiveDate))));
    }
    expect(fees).toBeGreaterThan(1000);
  });

  it("S5 a part payment is a single PAYMENT of 40% to 70% in whole rupees with no LATE_FEE (the sample flat's 500000 aside)", () => {
    let partial = 0;
    for (const b of dataset.bills) {
      const entries = entriesOfBill(dataset, b.key);
      const payments = entries.filter((e) => e.entryType === "PAYMENT");
      if (payments.length === 0 || payments[0].amountPaise >= b.amountPaise) continue;
      partial++;
      expect(payments).toHaveLength(1);
      expect(entries.some((e) => e.entryType === "LATE_FEE")).toBe(false);
      expect(payments[0].amountPaise % 100n).toBe(0n);
      if (b.key === "bill:T21-1601:2026-10-01") continue;
      expect(payments[0].amountPaise * 100n >= b.amountPaise * 40n - 5000n).toBe(true);
      expect(payments[0].amountPaise * 100n <= b.amountPaise * 70n + 5000n).toBe(true);
    }
    expect(partial).toBeGreaterThan(100);
  });

  it("S5 for each flat charges minus payments is never negative: no flat has prepaid", () => {
    const balance = new Map<string, bigint>();
    for (const e of dataset.ledgerEntries) {
      const delta = e.direction === "CHARGE" ? e.amountPaise : -e.amountPaise;
      balance.set(e.flatKey, (balance.get(e.flatKey) ?? 0n) + delta);
    }
    expect(balance.size).toBe(2400);
    for (const [flatKey, value] of balance) expect(value >= 0n, flatKey).toBe(true);
  });

  it("S5 the forced flats' ledgers match their scenarios exactly", () => {
    const summary = (code: string) =>
      dataset.ledgerEntries.filter((e) => e.flatKey === `flat:${code}` && e.entryType !== "BILL").map((e) => `${e.entryType}:${e.amountPaise}@${e.effectiveDate}`);
    expect(summary("T12-0408")).toEqual(["PAYMENT:637000@2026-06-05", "PAYMENT:637000@2026-07-05", "PAYMENT:637000@2026-08-05"]);
    expect(summary("T15-0902")).toEqual(["PAYMENT:858000@2026-06-05", "PAYMENT:858000@2026-07-05", "PAYMENT:858000@2026-08-05"]);
    expect(summary("T03-0702")).toHaveLength(4);
    expect(summary("T21-1601").at(-1)).toBe("PAYMENT:500000@2026-10-12");
    expect(summary("T07-1203").at(-1)).toBe("PAYMENT:747500@2026-10-03");
    expect(bill("T12-0408", "2026-09-01").dueOn).toBe("2026-09-10");
    for (const code of FORCED_CODES) expect(dataset.bills.some((b) => b.flatKey === `flat:${code}`)).toBe(true);
  });
});

describe("S6 behaviour mix for the October period over the non-forced flats", () => {
  const forced = new Set<string>(FORCED_CODES);
  const october = dataset.bills.filter((b) => b.period === "2026-10-01" && !forced.has(b.flatKey.slice(5)));

  const classify = (b: DemoBill) => {
    const entries = entriesOfBill(dataset, b.key);
    const payment = entries.find((e) => e.entryType === "PAYMENT");
    if (payment === undefined) return "unpaid";
    if (payment.amountPaise < b.amountPaise) return "partial";
    return entries.some((e) => e.entryType === "LATE_FEE") ? "late" : "onTime";
  };

  const share = (kind: string) => (100 * october.filter((b) => classify(b) === kind).length) / october.length;

  it("S6 covers 2,393 flats (2,400 less the 7 forced flats)", () => {
    expect(october).toHaveLength(2393);
  });

  it("S6 on-time share is 66% to 74%", () => {
    expect(share("onTime")).toBeGreaterThanOrEqual(66);
    expect(share("onTime")).toBeLessThanOrEqual(74);
  });

  it("S6 late-paid share is 7% to 13%", () => {
    expect(share("late")).toBeGreaterThanOrEqual(7);
    expect(share("late")).toBeLessThanOrEqual(13);
  });

  it("S6 partial share is 2% to 7%", () => {
    expect(share("partial")).toBeGreaterThanOrEqual(2);
    expect(share("partial")).toBeLessThanOrEqual(7);
  });

  it("S6 unpaid share is 13% to 19%", () => {
    expect(share("unpaid")).toBeGreaterThanOrEqual(13);
    expect(share("unpaid")).toBeLessThanOrEqual(19);
  });

  it("S6 older periods are paid more reliably than October", () => {
    const unpaidShare = (period: string) => {
      const bills = dataset.bills.filter((b) => b.period === period && !forced.has(b.flatKey.slice(5)));
      return bills.filter((b) => entriesOfBill(dataset, b.key).every((e) => e.entryType !== "PAYMENT")).length / bills.length;
    };
    expect(unpaidShare("2026-06-01")).toBeLessThan(unpaidShare("2026-09-01"));
    expect(unpaidShare("2026-09-01")).toBeLessThan(unpaidShare("2026-10-01"));
  });
});
