/** A calendar day as "YYYY-MM-DD" (years 1000 to 9999). It carries no time zone. */
export type CalendarDate = string;

export type DateParts = { year: number; month: number; day: number };

const MS_PER_DAY = 86_400_000;
/** India Standard Time is UTC+05:30 all year (no daylight saving). */
const IST_OFFSET_MS = 19_800_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 1000;
const MAX_YEAR = 9999;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function tryParse(value: string): DateParts | null {
  const match = DATE_PATTERN.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isValidDate(value: string): boolean {
  return tryParse(value) !== null;
}

export function parseDate(value: CalendarDate): DateParts {
  const parts = tryParse(value);
  if (parts === null) throw new RangeError(`"${value}" is not a valid calendar date (YYYY-MM-DD)`);
  return parts;
}

function formatUtcDate(date: Date): CalendarDate {
  const year = date.getUTCFullYear();
  if (!(year >= MIN_YEAR && year <= MAX_YEAR)) throw new RangeError("Date is outside the supported years 1000 to 9999");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function utcMidnight({ year, month, day }: DateParts): number {
  return Date.UTC(year, month - 1, day);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  if (!Number.isSafeInteger(days)) throw new RangeError(`addDays needs a whole number of days, got ${days}`);
  const { year, month, day } = parseDate(date);
  return formatUtcDate(new Date(Date.UTC(year, month - 1, day + days)));
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function diffDays(from: CalendarDate, to: CalendarDate): number {
  return (utcMidnight(parseDate(to)) - utcMidnight(parseDate(from))) / MS_PER_DAY;
}

/** Epoch milliseconds of 00:00 on `date` in India Standard Time. */
export function dayStartInstant(date: CalendarDate): number {
  return utcMidnight(parseDate(date)) - IST_OFFSET_MS;
}

/** The India Standard Time calendar date that contains the epoch-millisecond `instant`. */
export function istDateOf(instant: number): CalendarDate {
  if (!Number.isFinite(instant)) throw new RangeError(`istDateOf needs a finite instant, got ${instant}`);
  return formatUtcDate(new Date(instant + IST_OFFSET_MS));
}
