import type { Paise } from "../money/money";
import { type CalendarDate, diffDays } from "../time/calendar";
import { type ReportPosition, isOpen } from "./positions";

export const AGE_BUCKETS = ["NOT_YET_DUE", "DAYS_1_30", "DAYS_31_60", "DAYS_61_90", "OVER_90"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

/** A bill is in "Over 90 days" from this many days past its due date. */
export const OVER_90_FROM_DAYS = 91;

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
  if (days < OVER_90_FROM_DAYS) return "DAYS_61_90";
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

/** How the flats of an age group are listed: the largest amount first (the default) or the oldest bill first. */
export type AgeingSort = "LARGEST" | "OLDEST";

/** One FLAT in an age group: the bills it has in the group, the age of the oldest of them and what it owes in the group (unpaid bills plus late fees). */
export type AgeingFlatRow = { flatId: string; flatCode: string; bills: number; oldestDaysPastDue: number; amountDuePaise: Paise };

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const compareAmount = (a: Paise, b: Paise): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The order of the drill-down, a TOTAL order so a cursor can name a place in it and a page never repeats or skips a flat (D180). LARGEST: the amount, biggest first.
 * OLDEST: the age of the oldest bill, oldest first. Both break a tie by flat code and then flat id, which no two flats share. A negative number puts `a` first.
 */
export const compareFlats = (sort: AgeingSort) => (a: AgeingFlatRow, b: AgeingFlatRow): number =>
  (sort === "LARGEST" ? compareAmount(b.amountDuePaise, a.amountDuePaise) : b.oldestDaysPastDue - a.oldestDaysPastDue) || compareText(a.flatCode, b.flatCode) || compareText(a.flatId, b.flatId);

/**
 * The flats of one age group for the drill-down, in the order asked for: each flat once with the number of its open bills in the group, the days overdue of the
 * oldest of them and the total it owes in the group. No name and no phone number: only the flat code. Their amounts add up to the group's amount due, and their
 * number is the group's flats, exactly.
 */
export function ageingFlats(positions: readonly ReportPosition[], asOf: CalendarDate, bucket: AgeBucket, sort: AgeingSort): AgeingFlatRow[] {
  const mine = positions.filter((p) => isOpen(p) && ageBucket(daysPastDue(p.bill.dueOn, asOf)) === bucket);
  const rows = [...Map.groupBy(mine, (p) => p.flatId)].map(
    ([flatId, own]): AgeingFlatRow => ({
      flatId,
      flatCode: own[0].flatCode,
      bills: own.length,
      oldestDaysPastDue: Math.max(...own.map((p) => daysPastDue(p.bill.dueOn, asOf))),
      amountDuePaise: own.reduce((sum, p) => sum + p.position.amountDuePaise, 0n),
    }),
  );
  return rows.sort(compareFlats(sort));
}
