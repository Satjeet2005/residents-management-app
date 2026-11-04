import type { Prng } from "./prng";
import { WINDOW_START } from "./types";

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Day 56 after 2026-09-01 is 2026-10-27, the demo's "today". */
const LAST_DAY = 56;
/** Minutes after midnight in which things happen: 06:00 to 23:00. */
const FIRST_MINUTE = 360;
const LAST_MINUTE = 1380;
/** The default last minute of "today": 11:40, so every follow-up step stays before DEMO_NOW (12:00). */
const LAST_MINUTE_TODAY = 700;

/** A random moment between 2026-09-01 and DEMO_NOW, in the day's active hours. */
export function drawMoment(r: Prng, lastMinuteToday: number = LAST_MINUTE_TODAY): number {
  const day = r.int(0, LAST_DAY);
  return WINDOW_START + day * DAY + r.int(FIRST_MINUTE, day === LAST_DAY ? lastMinuteToday : LAST_MINUTE) * MINUTE;
}
