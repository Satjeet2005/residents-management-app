import { dayStartInstant, isValidDate } from "@/domain/time/calendar";

const NOON_MS = 12 * 60 * 60 * 1000;

/**
 * The clock for BUSINESS questions: what is due today, how many days overdue, which visitors are expected today, when a
 * reply is due (D97). It is the real time, unless the optional DEMO_AS_OF (YYYY-MM-DD) is set, and then it is 12:00
 * India time on that date, so the sample numbers of the brief can be reproduced. The override works ONLY in demo mode
 * (DEMO_MODE=true): with demo mode off, DEMO_AS_OF is ignored and the real clock is used everywhere. The live demo sets it to 2026-10-27 (D226).
 *
 * Login, sessions, rate limits and audit rows never use this: they always use the real clock (`Date.now()`).
 * A value that is set but is not a real date throws, instead of quietly falling back to the real date.
 */
export function businessNow(env: Readonly<Record<string, string | undefined>> = process.env, realNow: number = Date.now()): number {
  if (!isDemoMode(env)) return realNow;
  const raw = env.DEMO_AS_OF?.trim() ?? "";
  if (raw === "") return realNow;
  if (!isValidDate(raw)) throw new RangeError("DEMO_AS_OF must be a real date written YYYY-MM-DD, or left unset");
  return dayStartInstant(raw) + NOON_MS;
}

/** The real clock (D97): sessions, audit rows and the times of payment events. Never the business clock. */
export const realNow = (): number => Date.now();

/** Is a frozen demo date in force? True only in demo mode with DEMO_AS_OF set. The screens use it to say so. */
export function isBusinessClockFrozen(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return isDemoMode(env) && (env.DEMO_AS_OF?.trim() ?? "") !== "";
}

/** Demo mode is on only when DEMO_MODE is exactly the text "true". */
export function isDemoMode(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.DEMO_MODE === "true";
}
