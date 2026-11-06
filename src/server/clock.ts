import { dayStartInstant, isValidDate } from "@/domain/time/calendar";

const NOON_MS = 12 * 60 * 60 * 1000;

/**
 * The clock for BUSINESS questions: what is due today, how many days overdue, which visitors are expected today, when a
 * reply is due (D97). It is the real time, unless the optional DEMO_AS_OF (YYYY-MM-DD) is set, and then it is 12:00
 * India time on that date, so the sample numbers of the brief can be reproduced. The live deployment leaves it unset.
 *
 * Login, sessions, rate limits and audit rows never use this: they always use the real clock (`Date.now()`).
 * A value that is set but is not a real date throws, instead of quietly falling back to the real date.
 */
export function businessNow(env: Readonly<Record<string, string | undefined>> = process.env, realNow: number = Date.now()): number {
  const raw = env.DEMO_AS_OF?.trim() ?? "";
  if (raw === "") return realNow;
  if (!isValidDate(raw)) throw new RangeError("DEMO_AS_OF must be a real date written YYYY-MM-DD, or left unset");
  return dayStartInstant(raw) + NOON_MS;
}

/** Is a frozen demo date in force? The screens use it to say so. */
export function isBusinessClockFrozen(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.DEMO_AS_OF?.trim() ?? "") !== "";
}

/** Demo mode is on only when DEMO_MODE is exactly the text "true". */
export function isDemoMode(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.DEMO_MODE === "true";
}
