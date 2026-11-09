import type { Ageing } from "@/domain/reports/age";
import type { GoalKey, GoalRow, GoalStatus } from "@/domain/reports/goals";
import type { MoneyLine } from "@/domain/reports/money-line";
import type { MonthlyPoint, OnTimePoint } from "@/domain/reports/series";
import { percentOfPaise } from "@/domain/reports/stats";
import type { MonthlySlaPoint } from "@/domain/reports/monthly-sla";
import { formatRupeesShort } from "@/domain/money/short";
import { monthName } from "@/lib/format-date";
import { t } from "@/lib/messages";

/** A point of a card's sparkline: its short label ("Oct", "26 Oct") and its percent, null for a gap. */
export type TrendPoint = { label: string; value: number | null };
/** The goal next to a metric: the target in words and whether it was met, in words and an icon, never colour alone. */
export type GoalMark = { key: GoalKey; status: GoalStatus; targetPercent: number; text: string; /** "20 points short", "3 points above", "2 points over", "On the goal" or null with no data. */ gap: string | null };
/** The month before, beside this one: "September 73%" and how this month moved, in words and a direction for the icon ("down 3 points"). */
export type PreviousLine = { text: string; direction: "up" | "down" | "same"; change: string };

export type HeadlineCards = {
  collected: { percent: number | null; value: string; comparison: string; /** "October within 20 days: 79%" and "September, at the same age: 93%" (D173); null without data. */ within20: string | null; sameAge: string | null };
  /** `comparison` is the flats ("838 flats"), `detail` the part over 90 days, `split` the total as unpaid bills plus late fees (D175). */
  owed: { value: string; comparison: string; detail: string; split: string };
  /** `previous` is null without a previous figure; `trend` is every month of the "Last six months" table, a gap is null. */
  onTime: { percent: number | null; value: string; goal: GoalMark; previous: PreviousLine | null; trend: TrendPoint[] };
  sla: { percent: number | null; value: string; goal: GoalMark; previous: PreviousLine | null; trend: TrendPoint[] };
};

export type CardsInput = {
  money: MoneyLine | null;
  ageing: Ageing;
  /** The six months of the trend, the selected one last. */
  onTime: readonly OnTimePoint[];
  /** The last six months of the SLA share, the selected month last (`monthlySla`): the card's figure is the last point of its own line. */
  sla: { months: readonly MonthlySlaPoint[] };
  goals: readonly GoalRow[];
  /** The monthly series (the selected month last): the fair, same-age comparison of Collected. */
  monthly: readonly MonthlyPoint[];
};

/** A whole number with Indian grouping ("1,603"). */
export const countText = (n: number): string => n.toLocaleString("en-IN");

/** "No data" or "87%". */
export const percentText = (value: number | null): string => (value === null ? t("committee.noData") : t("committee.percent", { n: value }));

export const flatsText = (n: number): string => (n === 1 ? t("committee.count.flat") : t("committee.count.flats", { n: countText(n) }));

const pointsText = (n: number): string => (n === 1 ? t("committee.goal.point") : t("committee.goal.points", { n }));

/**
 * "20 points short", "3 points above", "2 points over", "3 points under" (D176): the gap in whole points, which the domain rounds so a miss is never zero points.
 * With no data it is null; a margin of exactly zero on a met goal is "On the goal".
 */
export const goalGap = (row: GoalRow): string | null => {
  if (row.gapPoints === null || row.status === "NO_DATA") return null;
  if (row.gapPoints === 0 && row.status === "MET") return t("committee.gap.onGoal");
  const points = pointsText(row.gapPoints);
  const ceiling = row.key === "reopenedMax";
  if (ceiling) return row.status === "MET" ? t("committee.gap.under", { points }) : t("committee.gap.over", { points });
  return row.status === "MET" ? t("committee.gap.above", { points }) : t("committee.gap.short", { points });
};

/** "Goal 90% · 20 points short", "Limit 8% · 2 points over": the target, then the gap when there is one. */
export const goalText = (row: GoalRow): string => {
  const goal = row.key === "reopenedMax" ? t("committee.goal.limit", { n: row.targetPercent }) : t("committee.goal.target", { n: row.targetPercent });
  const gap = goalGap(row);
  return gap === null || (row.gapPoints === 0 && row.status === "MET") ? goal : t("committee.goal.withGap", { goal, gap });
};

export const goalMark = (rows: readonly GoalRow[], key: GoalKey): GoalMark => {
  const row = rows.find((r) => r.key === key) as GoalRow;
  return { key, status: row.status, targetPercent: row.targetPercent, text: goalText(row), gap: goalGap(row) };
};

/** "September 73%" and the move to this month's figure: up, down or the same, in whole points. Null when either month has no figure. */
const previousLine = (before: { period: string; value: number | null } | undefined, now: number | null): PreviousLine | null => {
  if (before === undefined || before.value === null || now === null) return null;
  const text = t("committee.card.prevValue", { month: monthName(before.period), n: before.value });
  if (now === before.value) return { text, direction: "same", change: t("committee.change.same") };
  const points = pointsText(Math.abs(now - before.value));
  return now > before.value ? { text, direction: "up", change: t("committee.change.up", { points }) } : { text, direction: "down", change: t("committee.change.down", { points }) };
};

/** The words an assistive technology reads for a goal bar: the value, the goal or limit, and the gap ("70 percent. Goal 90 percent. 20 points short."). */
export const goalBarLabel = (percent: number | null, mark: GoalMark): string => {
  if (percent === null) return t("committee.goalBar.noData");
  if (mark.gap === null) return t("committee.goalBar.plain", { value: percent });
  const words = { value: percent, goal: mark.targetPercent, gap: mark.gap };
  return mark.key === "reopenedMax" ? t("committee.goalBar.limit", words) : t("committee.goalBar.goal", words);
};

/**
 * The four headline cards, from the numbers the loader already has (no second calculation): collected out of billed, the total owed, the on-time rate against
 * its goal with six months of trend, and the first replies within the SLA against its goal with eight weeks of trend. A share with nothing to measure is
 * "No data" with no goal verdict; "last month" is left out when last month has no data.
 */
export function buildCards(input: CardsInput): HeadlineCards {
  const { money, ageing, onTime, sla, goals, monthly } = input;
  const over90 = ageing.buckets.find((b) => b.bucket === "OVER_90")?.amountDuePaise ?? 0n;
  const collectedPercent = money === null ? null : percentOfPaise(money.collectedPaise, money.billedPaise);
  const thisMonth = onTime.at(-1) as OnTimePoint;
  const lastMonth = onTime.at(-2);
  const slaPercent = sla.months.at(-1)?.sharePercent ?? null;
  const slaPrevious = sla.months.at(-2);
  const sameMonth = monthly.at(-1);
  const sameAge = monthly.at(-2);
  return {
    collected: {
      percent: collectedPercent,
      value: percentText(collectedPercent),
      comparison: money === null ? t("committee.headline.moneyNone") : t("committee.card.collectedOf", { a: formatRupeesShort(money.collectedPaise), b: formatRupeesShort(money.billedPaise) }),
      within20: sameMonth === undefined || sameMonth.byDay20Percent === null ? null : (sameMonth.inProgress ? t("committee.card.within20Open", { month: monthName(sameMonth.period), n: sameMonth.byDay20Percent }) : t("committee.card.within20", { month: monthName(sameMonth.period), n: sameMonth.byDay20Percent })),
      sameAge: sameAge === undefined || sameAge.byDay20Percent === null ? null : t("committee.card.sameAge", { month: monthName(sameAge.period), n: sameAge.byDay20Percent }),
    },
    owed: {
      value: formatRupeesShort(ageing.total.amountDuePaise),
      comparison: flatsText(ageing.total.flats),
      detail: t("committee.card.owed.over90", { amount: formatRupeesShort(over90) }),
      split: t("committee.card.owed.split", { bills: formatRupeesShort(ageing.total.unpaidBillsPaise), fees: formatRupeesShort(ageing.total.lateFeesPaise) }),
    },
    onTime: {
      percent: thisMonth.headlinePercent,
      value: percentText(thisMonth.headlinePercent),
      goal: goalMark(goals, "onTimeCollection"),
      previous: previousLine(lastMonth && { period: lastMonth.period, value: lastMonth.headlinePercent }, thisMonth.headlinePercent),
      trend: onTime.map((p) => ({ label: monthName(p.period).slice(0, 3), value: p.headlinePercent })),
    },
    sla: {
      percent: slaPercent,
      value: percentText(slaPercent),
      goal: goalMark(goals, "firstReplyWithinSla"),
      previous: previousLine(slaPrevious && { period: slaPrevious.period, value: slaPrevious.sharePercent }, slaPercent),
      trend: sla.months.map((m) => ({ label: monthName(m.period).slice(0, 3), value: m.sharePercent })),
    },
  };
}
