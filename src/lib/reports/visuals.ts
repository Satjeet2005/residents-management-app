import type { ChartText } from "@/components/charts/chart-parts";
import { formatRupees } from "@/domain/money/money";
import { formatRupeesShort } from "@/domain/money/short";
import type { MoneyLine } from "@/domain/reports/money-line";
import type { GoalStatus } from "@/domain/reports/goals";
import { t } from "@/lib/messages";
import type { GoalMark, HeadlineCards, TrendPoint } from "./cards";
import { percentText } from "./cards";

/** The words of the collected bar (M1): the title, the takeaway computed from the money line, and the table of the month's three figures in full Indian grouping. */
export function collectedBarText(cards: HeadlineCards["collected"], money: MoneyLine | null): ChartText {
  const table = {
    caption: t("committee.progress.caption"),
    columns: [t("committee.progress.col.figure"), t("committee.progress.col.amount")],
    rows:
      money === null
        ? []
        : [
            { header: t("committee.money.billed"), cells: [formatRupees(money.billedPaise)] },
            { header: t("committee.money.collected"), cells: [formatRupees(money.collectedPaise)] },
            { header: t("committee.money.outstanding"), cells: [formatRupees(money.outstandingPaise)] },
          ],
  };
  return {
    id: "m1-collected",
    caption: t("committee.card.collected"),
    captionHidden: true,
    title: t("committee.progress.title"),
    description:
      money === null
        ? t("committee.progress.none")
        : t("committee.progress.desc", { collected: formatRupeesShort(money.collectedPaise), billed: formatRupeesShort(money.billedPaise), percent: cards.value, outstanding: formatRupeesShort(money.outstandingPaise) }),
    table,
  };
}

const verdict = (status: GoalStatus): string | null => (status === "MET" ? t("committee.goals.met") : status === "NOT_MET" ? t("committee.goals.notMet") : null);

/**
 * The takeaway of a trend, worked out from its points: the latest value with its movement from the one before (gaps skipped), then the goal and whether it was
 * met. "No data in this period" when every point is a gap.
 */
export function trendDescription(points: readonly TrendPoint[], goal: GoalMark): string {
  const known = points.filter((p): p is { label: string; value: number } => p.value !== null);
  const last = known.at(-1);
  if (last === undefined) return t("committee.trend.none");
  const before = known.at(-2);
  const base = { label: last.label, value: last.value };
  const against = before === undefined ? null : { ...base, previousLabel: before.label, previous: before.value };
  const movement =
    against === null || before === undefined
      ? t("committee.trend.only", base)
      : last.value > before.value
        ? t("committee.trend.up", against)
        : last.value < before.value
          ? t("committee.trend.down", against)
          : t("committee.trend.same", against);
  const word = verdict(goal.status);
  return word === null ? movement : `${movement} ${t("committee.trend.goal", { goal: goal.text, verdict: word })}`;
}

/** The words of a sparkline: its title, the computed takeaway, and a table of every point ("No data" for a gap). */
export function trendText(input: { id: string; caption: string; title: string; points: readonly TrendPoint[]; goal: GoalMark }): ChartText {
  return {
    id: input.id,
    caption: input.caption,
    captionHidden: true,
    title: input.title,
    description: trendDescription(input.points, input.goal),
    table: {
      caption: input.title,
      columns: [t("committee.trend.col.period"), t("committee.trend.col.share")],
      rows: input.points.map((p) => ({ header: p.label, cells: [percentText(p.value)] })),
    },
  };
}
