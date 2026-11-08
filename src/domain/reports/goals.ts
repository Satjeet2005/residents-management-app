import { atLeastPercent, atMostPercent, percent } from "./stats";

/** The committee's targets (the `committee_goals` setting). They are ASSUMPTIONS, set by the committee and changed by the owner of the database (R67). */
export type Goals = { onTimeCollectionPercent: number; firstReplyWithinSlaPercent: number; reopenedPercentMax: number };

export const defaultGoals: Goals = { onTimeCollectionPercent: 90, firstReplyWithinSlaPercent: 90, reopenedPercentMax: 8 };

const isPercent = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

/**
 * The goals from the setting's value. A missing or invalid setting (not an object, a target that is not a number from 0 to 100) gives the built-in defaults and says
 * so (`source` is "DEFAULT"), so the page still opens before the owner has inserted the row, and never shows a made-up number as if it were the committee's.
 */
export function goalsFromSetting(value: unknown): { goals: Goals; source: "SETTING" | "DEFAULT" } {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (record !== null && isPercent(record.onTimeCollectionPercent) && isPercent(record.firstReplyWithinSlaPercent) && isPercent(record.reopenedPercentMax)) {
    return { goals: { onTimeCollectionPercent: record.onTimeCollectionPercent, firstReplyWithinSlaPercent: record.firstReplyWithinSlaPercent, reopenedPercentMax: record.reopenedPercentMax }, source: "SETTING" };
  }
  return { goals: defaultGoals, source: "DEFAULT" };
}

export type GoalKey = "onTimeCollection" | "firstReplyWithinSla" | "reopenedMax";
export type GoalStatus = "MET" | "NOT_MET" | "NO_DATA";
export type GoalRow = {
  key: GoalKey;
  /** The target in percent. For "reopenedMax" it is a ceiling: the actual must be at or below it. */
  targetPercent: number;
  /** The actual in whole percent, or null with no data. */
  actualPercent: number | null;
  status: GoalStatus;
  /**
   * The distance to the target in whole percentage points, null with no data. NOT_MET: points short of an "at least" goal, or over a "most" ceiling, at least 1.
   * MET: points above the goal, or under the ceiling, possibly 0.
   */
  gapPoints: number | null;
};

/**
 * Whole points between the share n/d and the target, worked out on the counts so the rounding cannot flip a verdict (D176): a miss is rounded UP, so a missed
 * goal is never "0 points short" (89.6% against 90 is 1 point short); a margin is rounded DOWN, so a goal is never said to be beaten by more than it was.
 */
export function gapInPoints(n: number, d: number, targetPercent: number, higherIsBetter: boolean): number | null {
  if (d === 0) return null;
  const good = higherIsBetter ? 100 * n - targetPercent * d : targetPercent * d - 100 * n;
  return good >= 0 ? Math.floor(good / d) : Math.ceil(-good / d);
}

/** The three counts the goals are taken from: n out of d. */
export type GoalActuals = { onTime: { n: number; d: number }; firstReply: { n: number; d: number }; reopened: { n: number; d: number } };

/**
 * Each goal against its actual, on the COUNTS (so 89.6 percent does not pass a 90 percent target on rounding): Met, Not met, or No data when there is nothing
 * to measure (a zero denominator is never "0 percent" and never "Met").
 */
export function evaluateGoals(goals: Goals, actuals: GoalActuals): GoalRow[] {
  const row = (key: GoalKey, targetPercent: number, { n, d }: { n: number; d: number }, meets: boolean): GoalRow => ({
    key,
    targetPercent,
    actualPercent: percent(n, d),
    status: d === 0 ? "NO_DATA" : meets ? "MET" : "NOT_MET",
    gapPoints: gapInPoints(n, d, targetPercent, key !== "reopenedMax"),
  });
  return [
    row("onTimeCollection", goals.onTimeCollectionPercent, actuals.onTime, atLeastPercent(actuals.onTime.n, actuals.onTime.d, goals.onTimeCollectionPercent)),
    row("firstReplyWithinSla", goals.firstReplyWithinSlaPercent, actuals.firstReply, atLeastPercent(actuals.firstReply.n, actuals.firstReply.d, goals.firstReplyWithinSlaPercent)),
    row("reopenedMax", goals.reopenedPercentMax, actuals.reopened, atMostPercent(actuals.reopened.n, actuals.reopened.d, goals.reopenedPercentMax)),
  ];
}
