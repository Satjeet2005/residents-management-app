import type { Paise } from "../money/money";
import { type CalendarDate, addDays } from "../time/calendar";
import { collectionQuality, moneyLine } from "./money-line";
import { monthStartOf } from "./periods";
import type { ReportPosition } from "./positions";
import { percent, percentOfPaise } from "./stats";

/** The month-to-month comparison is made at the same age: the share of the billed amount paid within this many days of the issue date (D173). */
export const COLLECTED_WITHIN_DAYS = 20;

export type CollectedByDay = {
  /** The amount paid within the days, in paise (never above the bills). */
  paise: Paise;
  /** Share of the billed amount paid within the days, whole percent half up; null without bills. */
  percent: number | null;
  /** True when the day-20 date has not come: the share is then read up to the as-of date, and is still growing. */
  inProgress: boolean;
};

/**
 * The share of the period's billed amount paid within `day` days after the bills' issue date (D173): per bill, the payments dated on or before the issue date
 * plus `day`, never more than the bill (a late fee paid above the bill is not counted, as in `moneyLine`); a reversed payment is not in the positions at all.
 * When the issue date plus `day` is after `asOf` the same measure is taken up to `asOf` and `inProgress` is true. `positions` are those of ONE period.
 */
export function collectedByDay(positions: readonly ReportPosition[], asOf: CalendarDate, day = COLLECTED_WITHIN_DAYS): CollectedByDay {
  let billed = 0n;
  let paid = 0n;
  let inProgress = false;
  for (const p of positions) {
    const cutoff = addDays(p.bill.issuedOn, day);
    if (cutoff > asOf) inProgress = true;
    const until = cutoff < asOf ? cutoff : asOf;
    const within = p.payments.filter((x) => x.date <= until).reduce((sum, x) => sum + x.amountPaise, 0n);
    billed += p.bill.amountPaise;
    paid += within < p.bill.amountPaise ? within : p.bill.amountPaise;
  }
  return { paise: paid, percent: percentOfPaise(paid, billed), inProgress };
}

export type MonthlyPoint = {
  period: CalendarDate;
  /** False when the period has no bills: its figures are zero and the chart shows a gap ("No data"), not a month that collected nothing. */
  hasBills: boolean;
  billedPaise: Paise;
  collectedPaise: Paise;
  outstandingPaise: Paise;
  /** Collected out of billed AS OF TODAY, whole percent; null without bills. Older months have had longer to pay, so this is not a fair comparison between months. */
  collectedPercent: number | null;
  /** Collected within 20 days of the issue date, the fair comparison (D173); null without bills. */
  byDay20Percent: number | null;
  /** The same amount in paise, for the stacked chart. */
  byDay20Paise: Paise;
  /** The month is younger than 20 days: `byDay20Percent` is read up to the as-of date. */
  inProgress: boolean;
};

/** The positions grouped by the period of their bill, built once so a series of any length reads the positions once. */
const byPeriod = (positions: readonly ReportPosition[]): Map<CalendarDate, ReportPosition[]> => Map.groupBy(positions, (p) => monthStartOf(p.bill.period));

/**
 * Billed, Collected and Outstanding of each period, as of the date the positions were built for. Each point is exactly the `moneyLine` of that period's
 * positions alone, so Billed = Collected + Outstanding holds in every point and the committee's figure for a month is the same wherever it is shown.
 */
export function monthlySeries(positions: readonly ReportPosition[], periods: readonly CalendarDate[], asOf: CalendarDate): MonthlyPoint[] {
  const groups = byPeriod(positions);
  return periods.map((period) => {
    const mine = groups.get(period) ?? [];
    const line = moneyLine(mine);
    const early = collectedByDay(mine, asOf);
    return {
      period,
      hasBills: mine.length > 0,
      billedPaise: line.billedPaise,
      collectedPaise: line.collectedPaise,
      outstandingPaise: line.outstandingPaise,
      collectedPercent: percentOfPaise(line.collectedPaise, line.billedPaise),
      byDay20Percent: early.percent,
      byDay20Paise: early.paise,
      inProgress: early.inProgress && mine.length > 0,
    };
  });
}

export type OnTimePoint = {
  period: CalendarDate;
  /** The D134 headline: on-time payments over ALL the period's bills that are due as of the business date. */
  due: number;
  dueOnTime: number;
  /** The secondary figure: on-time payments over the period's paid bills. */
  paid: number;
  paidOnTime: number;
  /** Whole percents; null when the denominator is zero (no bills, or none due yet, or none paid): a gap. */
  headlinePercent: number | null;
  ofPaidPercent: number | null;
};

/** The two on-time rates of each period (`collectionQuality`, so the six values and the Paid on time card cannot disagree). */
export function onTimeRateByPeriod(positions: readonly ReportPosition[], periods: readonly CalendarDate[], asOf: CalendarDate): OnTimePoint[] {
  const groups = byPeriod(positions);
  return periods.map((period) => {
    const mine = groups.get(period) ?? [];
    const q = collectionQuality(mine, asOf);
    return {
      period,
      due: q.due,
      dueOnTime: q.dueOnTime,
      paid: q.paid,
      paidOnTime: q.paidOnTime,
      headlinePercent: percent(q.dueOnTime, q.due),
      ofPaidPercent: percent(q.paidOnTime, q.paid),
    };
  });
}
