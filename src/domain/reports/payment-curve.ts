import type { Paise } from "../money/money";
import { type CalendarDate, diffDays } from "../time/calendar";
import { percentOfPaise } from "./stats";

/** The days of the curve: day 0 is the issue date, and the curve stops at day 45 (an assumption: A-curve-range) or the as-of day, whichever is earlier. */
export const CURVE_DAYS = 45;
/** The second plain number of the curve is read at this day. */
export const CURVE_CHECK_DAY = 20;

export type CurveBill = { amountPaise: Paise; payments: readonly { date: CalendarDate; amountPaise: Paise }[] };
export type CurvePoint = { day: number; collectedPaise: Paise; /** Whole percent of billed, half up. */ percent: number };

export type PaymentCurve = {
  billedPaise: Paise;
  /** Day 0 to min(45, as-of day). */
  points: CurvePoint[];
  /** The due date as a day since issue (the marker). */
  dueDay: number;
  /** The as-of date as a day since issue. */
  asOfDay: number;
  /** Percent of billed collected by the due day; null while the due day has not come. */
  byDueDay: number | null;
  /** Percent collected by day 20; null when the as-of day is before day 20. */
  byDay20: number | null;
  /** Percent collected as of today (all payments up to the as-of date). */
  now: number;
};

/**
 * How a month's billing was collected as the days went by: for each day since the issue date, the share of the billed amount collected by then.
 *
 * Collected is PRINCIPAL ONLY and counted per bill: the payments of a bill add up day by day and are capped at the bill's amount, so a payment above the
 * bill (a late fee) never counts, exactly as in `moneyLine`. `bills` are the bills of ONE month and the month has one issue date and one due date
 * (`issueDate`, `dueDate`). A payment dated before the issue date counts on day 0. Payments dated after `asOf` must not be passed.
 *
 * RELATIONSHIP TO "PAID ON TIME": the curve at the due day (`byDueDay`) is weighted by MONEY and counts part payments; the "Paid on time" figure is weighted by
 * BILLS and counts a bill only when it was paid in full by its due date. They are the same number when every bill has the same amount and every payment is a
 * whole payment, and otherwise `byDueDay` is never below the money of the on-time bills as a share of billed. `now` equals the Collected percent of the money line.
 * Returns null when nothing was billed or the as-of date is before the issue date.
 */
export function paymentCurve(input: { bills: readonly CurveBill[]; issueDate: CalendarDate; dueDate: CalendarDate; asOf: CalendarDate }): PaymentCurve | null {
  const { bills, issueDate, dueDate, asOf } = input;
  const billedPaise = bills.reduce((sum, b) => sum + b.amountPaise, 0n);
  const asOfDay = diffDays(issueDate, asOf);
  if (billedPaise === 0n || asOfDay < 0) return null;
  const dueDay = diffDays(issueDate, dueDate);
  const horizon = Math.min(asOfDay, Math.max(CURVE_DAYS, dueDay));
  const added: Paise[] = Array.from({ length: horizon + 1 }, () => 0n);
  let total = 0n;
  for (const bill of bills) {
    let paid = 0n;
    for (const payment of [...bill.payments].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
      const before = paid < bill.amountPaise ? paid : bill.amountPaise;
      paid += payment.amountPaise;
      const newly = (paid < bill.amountPaise ? paid : bill.amountPaise) - before;
      total += newly;
      const day = Math.max(0, diffDays(issueDate, payment.date));
      if (day <= horizon) added[day] += newly;
    }
  }
  const cumulative: Paise[] = [];
  added.reduce((running, amount, day) => {
    cumulative[day] = running + amount;
    return cumulative[day];
  }, 0n);
  const at = (day: number): number => percentOfPaise(cumulative[day], billedPaise) as number;
  const last = Math.min(CURVE_DAYS, asOfDay);
  return {
    billedPaise,
    points: Array.from({ length: last + 1 }, (_, day) => ({ day, collectedPaise: cumulative[day], percent: at(day) })),
    dueDay,
    asOfDay,
    byDueDay: asOfDay >= dueDay ? at(dueDay) : null,
    byDay20: asOfDay >= CURVE_CHECK_DAY ? at(CURVE_CHECK_DAY) : null,
    now: percentOfPaise(total, billedPaise) as number,
  };
}
