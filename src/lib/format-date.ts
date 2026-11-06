import { type CalendarDate, IST_OFFSET_MS, parseDate } from "@/domain/time/calendar";

/** English month names, abbreviated. No Intl: the text is the same on every machine (D2, and the late-fee rules do the same for dates). */
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** "27 Oct" */
export function formatDay(date: CalendarDate): string {
  const { month, day } = parseDate(date);
  return `${day} ${MONTHS_SHORT[month - 1]}`;
}

/** "27 Oct 2026" */
export function formatDayYear(date: CalendarDate): string {
  return `${formatDay(date)} ${parseDate(date).year}`;
}

/** "September": the long month name of a date. */
export function monthName(date: CalendarDate): string {
  return MONTHS_LONG[parseDate(date).month - 1];
}

/** The time of day in India Standard Time: "5 pm", "5:30 pm", "12 am", "12 pm". Minutes are shown only when they are not zero. */
export function formatTimeIst(instant: number): string {
  if (!Number.isFinite(instant)) throw new RangeError(`formatTimeIst needs a finite instant, got ${instant}`);
  const msOfDay = (((instant + IST_OFFSET_MS) % 86_400_000) + 86_400_000) % 86_400_000;
  const hour24 = Math.floor(msOfDay / 3_600_000);
  const minute = Math.floor((msOfDay % 3_600_000) / 60_000);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}${minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`} ${hour24 < 12 ? "am" : "pm"}`;
}

/** The time of day in India Standard Time with minutes always: "11:00 am", "4:30 pm". */
export function formatClockIst(instant: number): string {
  if (!Number.isFinite(instant)) throw new RangeError(`formatClockIst needs a finite instant, got ${instant}`);
  const msOfDay = (((instant + IST_OFFSET_MS) % 86_400_000) + 86_400_000) % 86_400_000;
  const hour24 = Math.floor(msOfDay / 3_600_000);
  const minute = Math.floor((msOfDay % 3_600_000) / 60_000);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${hour24 < 12 ? "am" : "pm"}`;
}
