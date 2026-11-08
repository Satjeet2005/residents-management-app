import { type CalendarDate, parseDate } from "@/domain/time/calendar";
import { monthName } from "@/lib/format-date";

/** The first day of the month of a date: "2026-10-27" gives "2026-10-01". */
export const monthStart = (date: CalendarDate): CalendarDate => `${date.slice(0, 7)}-01`;

/** The period named by `?period=YYYY-MM` (a real month), as its first day; anything else is null. */
export function periodFromQuery(value: string | string[] | undefined): CalendarDate | null {
  const text = Array.isArray(value) ? value[0] : value;
  const match = typeof text === "string" ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text) : null;
  return match === null ? null : `${match[1]}-${match[2]}-01`;
}

/** The `?period=` value of a period: "2026-10-01" gives "2026-10". */
export const periodQuery = (period: CalendarDate): string => period.slice(0, 7);

/** The months a person may pick: the distinct periods that have bills, none after the business month, newest first. */
export function periodOptions(billedPeriods: readonly CalendarDate[], asOf: CalendarDate): CalendarDate[] {
  const latest = monthStart(asOf);
  return [...new Set(billedPeriods.map(monthStart))].filter((p) => p <= latest).sort().reverse();
}

/**
 * The month the report shows. A month in the address wins (it may have no bills: the page then says so), except a FUTURE month, which is ignored. With none,
 * the month of the business date; when that month has no bills yet (a new month before its bills are issued), the newest month that has some, so the committee
 * does not open on an empty page. With no bills at all, the month of the business date.
 */
export function choosePeriod(input: { requested: CalendarDate | null; options: readonly CalendarDate[]; asOf: CalendarDate }): CalendarDate {
  const current = monthStart(input.asOf);
  if (input.requested !== null && input.requested <= current) return input.requested;
  return input.options.includes(current) ? current : (input.options[0] ?? current);
}

/**
 * The address of the report for a period, and for a bucket of the ageing drill-down with the order of its flats. `anchor` is where the page lands: the drill-down
 * when a bucket is asked for, otherwise the list of age groups when `toAges` is set. The default period is written out: the page decides it.
 */
export function reportHref(input: { period: CalendarDate; bucket?: string | null; sort?: string | null; toAges?: boolean }): string {
  const params = new URLSearchParams({ period: periodQuery(input.period) });
  const bucket = input.bucket ?? null;
  if (bucket !== null) {
    params.set("bucket", bucket);
    if (input.sort !== undefined && input.sort !== null) params.set("sort", input.sort);
  }
  return `/staff/reports?${params.toString()}${bucket !== null ? "#ageing-detail" : input.toAges === true ? "#owed" : ""}`;
}

/** "October 2026": a period as the page names it. */
export const periodLabel = (period: CalendarDate): string => `${monthName(period)} ${parseDate(period).year}`;

/** "27 October 2026": a date in words, for the "as of" line. */
export const dateWords = (date: CalendarDate): string => `${parseDate(date).day} ${monthName(date)} ${parseDate(date).year}`;
