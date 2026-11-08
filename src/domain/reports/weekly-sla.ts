import { isDecided, slaOutcome } from "../complaints/sla";
import { type CalendarDate, addDays, diffDays, istDateOf, parseDate } from "../time/calendar";
import { percent } from "./stats";

export const WEEKS = 8;

/** What the SLA series needs of a complaint. Times are milliseconds since the epoch. */
export type SlaComplaint = { createdAt: number; responseDueAt: number | null; firstResponseAt: number | null };

export type SlaShare = { raised: number; /** MET + MISSED_LATE + MISSED_OPEN (NOT_DUE is left out). */ decided: number; /** MET only: a late first reply is not within the SLA. */ met: number };

/**
 * The one SLA count (D150): of the complaints given, how many were decided by `slaOutcome` and how many of those were MET. The cards (selected and previous
 * month) and every week of the weekly series use this function, so a late first reply is missed in all of them.
 */
export function slaShare(complaints: readonly SlaComplaint[], now: number): SlaShare {
  const outcomes = complaints.map((c) => slaOutcome({ responseDueAt: c.responseDueAt, firstResponseAt: c.firstResponseAt, now }));
  return { raised: complaints.length, decided: outcomes.filter(isDecided).length, met: outcomes.filter((o) => o === "MET").length };
}

/** The Monday (ISO week start) of the week that contains a date. */
export function isoWeekStart(date: CalendarDate): CalendarDate {
  const { year, month, day } = parseDate(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export type WeeklyPoint = SlaShare & {
  /** The Monday of the week (India time). */
  weekStart: CalendarDate;
  /** Whole percent met out of decided; null for a week with no due complaints: a gap, "No data". */
  sharePercent: number | null;
};

/**
 * The last 8 ISO weeks (Monday to Sunday, India time) that end with the week of `endDate`, oldest first: the complaints raised in each and the share replied
 * within the SLA. Complaints raised outside the eight weeks are not counted, so the weeks' `raised` add up to the complaints in the window exactly.
 */
export function weeklySla(complaints: readonly SlaComplaint[], endDate: CalendarDate, now: number, weeks = WEEKS): WeeklyPoint[] {
  const firstStart = addDays(isoWeekStart(endDate), -7 * (weeks - 1));
  const buckets: SlaComplaint[][] = Array.from({ length: weeks }, () => []);
  for (const c of complaints) {
    const index = Math.floor(diffDays(firstStart, istDateOf(c.createdAt)) / 7);
    if (index >= 0 && index < weeks) buckets[index].push(c);
  }
  return buckets.map((mine, i) => {
    const share = slaShare(mine, now);
    return { weekStart: addDays(firstStart, 7 * i), ...share, sharePercent: percent(share.met, share.decided) };
  });
}
