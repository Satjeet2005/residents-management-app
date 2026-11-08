import type { Paise } from "../money/money";
import { type CalendarDate, diffDays } from "../time/calendar";
import { type ReportPosition, isOpen } from "./positions";

export const AGE_BUCKETS = ["NOT_YET_DUE", "DAYS_1_30", "DAYS_31_60", "DAYS_61_90", "OVER_90"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

/** Days from the bill's due date to `asOf`: zero on the due date itself, negative before it. */
export const daysPastDue = (dueOn: CalendarDate, asOf: CalendarDate): number => diffDays(dueOn, asOf);

/**
 * The bucket of an age in days past the due date: 0 or less is "Not yet due" (a bill is on time on its due date), 1 to 30, 31 to 60, 61 to 90 and over 90.
 * The boundaries are 0 and 1, 30 and 31, 60 and 61, 90 and 91.
 */
export function ageBucket(days: number): AgeBucket {
  if (days <= 0) return "NOT_YET_DUE";
  if (days <= 30) return "DAYS_1_30";
  if (days <= 60) return "DAYS_31_60";
  if (days <= 90) return "DAYS_61_90";
  return "OVER_90";
}

/** Unpaid bills (principal still owed) and late fees (posted and owing, or building up) are kept apart: amountDuePaise = unpaidBillsPaise + lateFeesPaise, exactly (D175). */
export type AgeAmounts = { flats: number; bills: number; unpaidBillsPaise: Paise; lateFeesPaise: Paise; amountDuePaise: Paise };
export type AgeingBucketRow = AgeAmounts & { bucket: AgeBucket };
export type Ageing = { buckets: AgeingBucketRow[]; total: AgeAmounts };

const sumOf = (positions: readonly ReportPosition[], pick: (p: ReportPosition) => Paise): Paise => positions.reduce((sum, p) => sum + pick(p), 0n);

/** The figures of a set of open positions: flats counted once, bills, and the amount split into unpaid bills and late fees. */
function amountsOf(positions: readonly ReportPosition[]): AgeAmounts {
  const unpaidBillsPaise = sumOf(positions, (p) => p.position.principalOutstandingPaise);
  const lateFeesPaise = sumOf(positions, (p) => p.position.feeOutstandingPaise);
  return { flats: new Set(positions.map((p) => p.flatId)).size, bills: positions.length, unpaidBillsPaise, lateFeesPaise, amountDuePaise: unpaidBillsPaise + lateFeesPaise };
}

/**
 * What is owed as of `asOf`, in five age buckets, from the positions of ALL open bills of ALL months (not only one month). A position's age is the days since
 * its bill's due date (a FEE_ONLY position too: the fee is still owed). Each bucket has its number of flats (a flat counts once in a bucket), its number of
 * bills, its unpaid bills (principal outstanding) and its late fees, and the amount due that is their sum. The buckets' amounts add up to the total exactly, and
 * `total.flats` counts each flat once, so the flats of the buckets add up to MORE than it when a flat has bills of several ages.
 */
export function ageingTable(positions: readonly ReportPosition[], asOf: CalendarDate): Ageing {
  const open = positions.filter(isOpen);
  const buckets = AGE_BUCKETS.map((bucket): AgeingBucketRow => ({ bucket, ...amountsOf(open.filter((p) => ageBucket(daysPastDue(p.bill.dueOn, asOf)) === bucket)) }));
  return { buckets, total: amountsOf(open) };
}

export type AgeingRow = { flatId: string; flatCode: string; billId: string; period: CalendarDate; daysPastDue: number; amountDuePaise: Paise };

/**
 * The open positions of one bucket as rows for the drill-down: the oldest first (most days past due), then by flat code, then by bill id, so the order is the
 * same on every read and a cursor can name a place in it. No name and no phone number: only the flat code, the bill's month, the age and the amount.
 */
export function ageingRows(positions: readonly ReportPosition[], asOf: CalendarDate, bucket: AgeBucket): AgeingRow[] {
  return positions
    .filter(isOpen)
    .map((p): AgeingRow => ({ flatId: p.flatId, flatCode: p.flatCode, billId: p.bill.id, period: p.bill.period, daysPastDue: daysPastDue(p.bill.dueOn, asOf), amountDuePaise: p.position.amountDuePaise }))
    .filter((row) => ageBucket(row.daysPastDue) === bucket)
    .sort((a, b) => b.daysPastDue - a.daysPastDue || (a.flatCode < b.flatCode ? -1 : a.flatCode > b.flatCode ? 1 : 0) || (a.billId < b.billId ? -1 : a.billId > b.billId ? 1 : 0));
}
