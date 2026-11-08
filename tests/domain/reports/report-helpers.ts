import { type DueBill, type DueEntry, positionsForFlat } from "@/domain/billing/dues";
import { defaultLateFeePolicy } from "@/domain/billing/late-fee";
import type { Paise } from "@/domain/money/money";
import type { ReportPosition } from "@/domain/reports/positions";
import { addDays } from "@/domain/time/calendar";
import type { Prng } from "@/domain/seed/prng";

export const policy = defaultLateFeePolicy;
let counter = 0;
export const nextId = (prefix: string): string => `${prefix}-${(counter += 1)}`;

export type FlatSpec = { flatId: string; flatCode: string; /** The flat's tower; the part of the code before the dash when not given. */ tower?: string; bills: DueBill[]; entries: DueEntry[] };

/** A bill due on `dueOn` (the 10th of the period's month in the tests), issued on the 1st of that month. */
export function bill(period: string, amountPaise: Paise, dueOn = `${period.slice(0, 8)}10`): DueBill {
  return { id: nextId("bill"), period, issuedOn: period, dueOn, amountPaise };
}

export function entry(input: Partial<DueEntry> & Pick<DueEntry, "entryType" | "direction" | "amountPaise" | "effectiveDate" | "billId">): DueEntry {
  return { id: nextId("entry"), reversesEntryId: null, ...input };
}

export const payment = (billId: string, amountPaise: Paise, effectiveDate: string): DueEntry => entry({ entryType: "PAYMENT", direction: "PAYMENT", amountPaise, effectiveDate, billId });
export const lateFee = (billId: string, amountPaise: Paise, effectiveDate: string): DueEntry => entry({ entryType: "LATE_FEE", direction: "CHARGE", amountPaise, effectiveDate, billId });

/** The positions of the given flats as of a date, the way the report's loader builds them: `positionsForFlat` per flat. */
export function positionsOf(flats: readonly FlatSpec[], asOf: string): ReportPosition[] {
  return flats.flatMap((f) => positionsForFlat({ bills: f.bills, entries: f.entries, policy, asOf }).map((p) => ({ ...p, flatId: f.flatId, flatCode: f.flatCode, tower: f.tower ?? f.flatCode.split("-")[0] })));
}

/**
 * A random flat for the properties: one to three bills (the first is "the month"), payments of any size (some above the bill), a late fee posted when the
 * payments reach a bill, and now and then a reversed payment. Dates stay near the due dates so every age bucket is reached.
 */
export function randomFlat(r: Prng, index: number): FlatSpec {
  const flatId = `flat-${index}`;
  const bills: DueBill[] = [];
  const entries: DueEntry[] = [];
  const count = r.int(1, 3);
  for (let i = 0; i < count; i++) {
    const period = addDays("2026-05-01", 31 * i + r.int(0, 3)).slice(0, 8) + "01";
    if (bills.some((b) => b.period === period)) continue;
    const b = bill(period, BigInt(r.int(100_000, 2_000_000)));
    bills.push(b);
    let paid = 0n;
    for (let k = r.int(0, 3); k > 0; k--) {
      const room = b.amountPaise - paid;
      const amount = room > 1n && r.chance(0.7) ? BigInt(r.int(1, Number(room))) : BigInt(r.int(1, 40_000));
      const date = addDays(b.dueOn, r.int(-12, 70));
      const p = payment(b.id, amount, date);
      entries.push(p);
      paid += amount;
      if (r.chance(0.08)) entries.push(entry({ entryType: "REVERSAL", direction: "CHARGE", amountPaise: amount, effectiveDate: addDays(date, 1), billId: b.id, reversesEntryId: p.id }));
      if (paid >= b.amountPaise && r.chance(0.7)) entries.push(lateFee(b.id, BigInt(r.int(0, 30_000)) + 1n, date));
    }
  }
  return { flatId, flatCode: `T01-${String(index).padStart(4, "0")}`, bills, entries };
}
