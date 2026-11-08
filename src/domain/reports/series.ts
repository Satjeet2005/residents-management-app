import type { Paise } from "../money/money";
import type { CalendarDate } from "../time/calendar";
import { collectionQuality, moneyLine } from "./money-line";
import { monthStartOf } from "./periods";
import type { ReportPosition } from "./positions";
import { percent, percentOfPaise } from "./stats";

export type MonthlyPoint = {
  period: CalendarDate;
  /** False when the period has no bills: its figures are zero and the chart shows a gap ("No data"), not a month that collected nothing. */
  hasBills: boolean;
  billedPaise: Paise;
  collectedPaise: Paise;
  outstandingPaise: Paise;
  /** Collected out of billed, whole percent; null without bills. */
  collectedPercent: number | null;
};

/** The positions grouped by the period of their bill, built once so a series of any length reads the positions once. */
const byPeriod = (positions: readonly ReportPosition[]): Map<CalendarDate, ReportPosition[]> => Map.groupBy(positions, (p) => monthStartOf(p.bill.period));

/**
 * Billed, Collected and Outstanding of each period, as of the date the positions were built for. Each point is exactly the `moneyLine` of that period's
 * positions alone, so Billed = Collected + Outstanding holds in every point and the committee's figure for a month is the same wherever it is shown.
 */
export function monthlySeries(positions: readonly ReportPosition[], periods: readonly CalendarDate[]): MonthlyPoint[] {
  const groups = byPeriod(positions);
  return periods.map((period) => {
    const mine = groups.get(period) ?? [];
    const line = moneyLine(mine);
    return {
      period,
      hasBills: mine.length > 0,
      billedPaise: line.billedPaise,
      collectedPaise: line.collectedPaise,
      outstandingPaise: line.outstandingPaise,
      collectedPercent: percentOfPaise(line.collectedPaise, line.billedPaise),
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
