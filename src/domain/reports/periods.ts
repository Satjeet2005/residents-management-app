import { type CalendarDate, parseDate } from "../time/calendar";

/** The first day of the month of a date: "2026-10-27" gives "2026-10-01". */
export const monthStartOf = (date: CalendarDate): CalendarDate => `${date.slice(0, 7)}-01`;

/** The month before a period (its first day): "2026-01-01" gives "2025-12-01". */
export function previousPeriod(period: CalendarDate): CalendarDate {
  const { year, month } = parseDate(period);
  const y = month === 1 ? year - 1 : year;
  const m = month === 1 ? 12 : month - 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
}

/**
 * The calendar months of a trend, oldest first, that end at the selected month: `count` of them (six by default). A month after the business month is never
 * included: a selected month in the future ends the list at the business month. A month without bills stays in the list; its figure is a gap, never a zero.
 */
export function lastPeriods(selected: CalendarDate, asOf: CalendarDate, count = 6): CalendarDate[] {
  const current = monthStartOf(asOf);
  let period = selected < current ? monthStartOf(selected) : current;
  const periods: CalendarDate[] = [];
  for (let i = 0; i < count; i++) {
    periods.unshift(period);
    period = previousPeriod(period);
  }
  return periods;
}
