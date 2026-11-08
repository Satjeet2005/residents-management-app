import { type CalendarDate, istDateOf } from "../time/calendar";
import { monthStartOf } from "./periods";
import { percent } from "./stats";
import { type SlaComplaint, type SlaShare, slaShare } from "./weekly-sla";

export type MonthlySlaPoint = SlaShare & {
  period: CalendarDate;
  /** Whole percent met out of decided; null for a month with nothing due: a gap, "No data". */
  sharePercent: number | null;
};

/**
 * The share of first replies within the promised time for each month, oldest first (D174). It uses `slaShare`, the one SLA rule, on the complaints RAISED in
 * each month, exactly as the Replies card does for the selected month, so the last point of the card's line IS the card's figure. A complaint raised outside the
 * given months is not counted.
 */
export function monthlySla(complaints: readonly SlaComplaint[], periods: readonly CalendarDate[], now: number): MonthlySlaPoint[] {
  const groups = Map.groupBy(complaints, (c) => monthStartOf(istDateOf(c.createdAt)));
  return periods.map((period) => {
    const share = slaShare(groups.get(period) ?? [], now);
    return { period, ...share, sharePercent: percent(share.met, share.decided) };
  });
}
