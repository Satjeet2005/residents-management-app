import type { Ageing } from "@/domain/reports/age";
import type { GoalKey, GoalRow, GoalStatus } from "@/domain/reports/goals";
import type { MoneyLine } from "@/domain/reports/money-line";
import type { MonthlyPoint, OnTimePoint } from "@/domain/reports/series";
import { percentOfPaise } from "@/domain/reports/stats";
import type { MonthlySlaPoint } from "@/domain/reports/monthly-sla";
import { formatRupees } from "@/domain/money/money";
import { formatRupeesShort } from "@/domain/money/short";
import { monthName } from "@/lib/format-date";
import { t } from "@/lib/messages";

/** A point of a card's sparkline: its short label ("Oct", "26 Oct") and its percent, null for a gap. */
export type TrendPoint = { label: string; value: number | null };
/** The goal next to a metric: the target in words and whether it was met, in words and an icon, never colour alone. */
export type GoalMark = { key: GoalKey; status: GoalStatus; targetPercent: number; text: string };

export type HeadlineCards = {
  collected: { percent: number | null; value: string; comparison: string; exact: string | null; /** "October within 20 days: 79%" and "September, at the same age: 93%" (D173); null without data. */ within20: string | null; sameAge: string | null };
  owed: { value: string; comparison: string; detail: string };
  onTime: { percent: number | null; value: string; goal: GoalMark; lastMonth: string | null; trend: TrendPoint[] };
  sla: { percent: number | null; value: string; goal: GoalMark; lastMonth: string | null; trend: TrendPoint[] };
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
 * "Goal 90% · 20 points short", "Goal 90% · 3 points above", "Limit 8% · 2 points over", "Limit 8% · 3 points under" (D176): the target and the gap in whole points, which
 * the domain rounds so a miss is never zero points. With no data, or a margin of exactly zero, only the target is said.
 */
export const goalText = (row: GoalRow): string => {
  const ceiling = row.key === "reopenedMax";
  const goal = ceiling ? t("committee.goal.limit", { n: row.targetPercent }) : t("committee.goal.target", { n: row.targetPercent });
  if (row.gapPoints === null || row.status === "NO_DATA" || (row.gapPoints === 0 && row.status === "MET")) return goal;
  const points = pointsText(row.gapPoints);
  if (ceiling) return row.status === "MET" ? t("committee.goal.under", { goal, points }) : t("committee.goal.over", { goal, points });
  return row.status === "MET" ? t("committee.goal.above", { goal, points }) : t("committee.goal.short", { goal, points });
};

export const goalMark = (rows: readonly GoalRow[], key: GoalKey): GoalMark => {
  const row = rows.find((r) => r.key === key) as GoalRow;
  return { key, status: row.status, targetPercent: row.targetPercent, text: goalText(row) };
};

/** "September: 73%", the previous period named (D177); null when it has no figure, so the line is left out. */
const previousText = (point: { period: string; value: number | null } | undefined): string | null => (point === undefined || point.value === null ? null : t("committee.card.previous", { month: monthName(point.period), n: point.value }));

/**
 * The four headline cards, from the numbers the loader already has (no second calculation): collected out of billed, the total owed, the on-time rate against
 * its goal with six months of trend, and the first replies within the SLA against its goal with eight weeks of trend. A share with nothing to measure is
 * "No data" with no goal verdict; "last month" is left out when last month has no data.
 */
export function buildCards(input: CardsInput): HeadlineCards {
  const { money, ageing, onTime, sla, goals, monthly } = input;
  const over90 = ageing.buckets.find((b) => b.bucket === "OVER_90")?.flats ?? 0;
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
      comparison: money === null ? t("committee.headline.moneyNone") : t("committee.of", { a: formatRupeesShort(money.collectedPaise), b: formatRupeesShort(money.billedPaise) }),
      exact: money === null ? null : t("committee.of", { a: formatRupees(money.collectedPaise), b: formatRupees(money.billedPaise) }),
      within20: sameMonth === undefined || sameMonth.byDay20Percent === null ? null : (sameMonth.inProgress ? t("committee.card.within20Open", { month: monthName(sameMonth.period), n: sameMonth.byDay20Percent }) : t("committee.card.within20", { month: monthName(sameMonth.period), n: sameMonth.byDay20Percent })),
      sameAge: sameAge === undefined || sameAge.byDay20Percent === null ? null : t("committee.card.sameAge", { month: monthName(sameAge.period), n: sameAge.byDay20Percent }),
    },
    owed: {
      value: formatRupeesShort(ageing.total.amountDuePaise),
      comparison: flatsText(ageing.total.flats),
      detail: over90 === 1 ? t("committee.card.owed.over90One") : t("committee.card.owed.over90Many", { n: countText(over90) }),
    },
    onTime: {
      percent: thisMonth.headlinePercent,
      value: percentText(thisMonth.headlinePercent),
      goal: goalMark(goals, "onTimeCollection"),
      lastMonth: previousText(lastMonth && { period: lastMonth.period, value: lastMonth.headlinePercent }),
      trend: onTime.map((p) => ({ label: monthName(p.period).slice(0, 3), value: p.headlinePercent })),
    },
    sla: {
      percent: slaPercent,
      value: percentText(slaPercent),
      goal: goalMark(goals, "firstReplyWithinSla"),
      lastMonth: previousText(slaPrevious && { period: slaPrevious.period, value: slaPrevious.sharePercent }),
      trend: sla.months.map((m) => ({ label: monthName(m.period).slice(0, 3), value: m.sharePercent })),
    },
  };
}
