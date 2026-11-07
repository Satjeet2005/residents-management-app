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

export type AgeingBucketRow = { bucket: AgeBucket; flats: number; bills: number; amountDuePaise: Paise };
export type Ageing = { buckets: AgeingBucketRow[]; total: { flats: number; bills: number; amountDuePaise: Paise } };

/**
 * What is owed as of `asOf`, in five age buckets, from the positions of ALL open bills of ALL months (not only one month). A position's age is the days since
 * its bill's due date (a FEE_ONLY position too: the fee is still owed). Each bucket has its number of flats (a flat counts once in a bucket), its number of
 * bills and its amount due (principal outstanding plus fee). The buckets' amounts add up to `total.amountDuePaise` exactly; `total.flats` counts each flat once.
 */
export function ageingTable(positions: readonly ReportPosition[], asOf: CalendarDate): Ageing {
  const open = positions.filter(isOpen);
  const buckets = AGE_BUCKETS.map((bucket): AgeingBucketRow => {
    const inBucket = open.filter((p) => ageBucket(daysPastDue(p.bill.dueOn, asOf)) === bucket);
    return { bucket, flats: new Set(inBucket.map((p) => p.flatId)).size, bills: inBucket.length, amountDuePaise: inBucket.reduce((sum, p) => sum + p.position.amountDuePaise, 0n) };
  });
  return {
    buckets,
    total: { flats: new Set(open.map((p) => p.flatId)).size, bills: open.length, amountDuePaise: open.reduce((sum, p) => sum + p.position.amountDuePaise, 0n) },
  };
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
