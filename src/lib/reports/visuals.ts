import type { BarRow } from "@/components/charts/horizontal-bars";
import type { ChartText } from "@/components/charts/chart-parts";
import type { LineSeries } from "@/components/charts/line-chart";
import type { StackColumn } from "@/components/charts/stacked-bars";
import { formatRupees } from "@/domain/money/money";
import { formatRupeesShort } from "@/domain/money/short";
import type { Ageing } from "@/domain/reports/age";
import type { GoalStatus } from "@/domain/reports/goals";
import type { MoneyLine } from "@/domain/reports/money-line";
import { CURVE_DAYS, type PaymentCurve } from "@/domain/reports/payment-curve";
import type { MonthlyPoint } from "@/domain/reports/series";
import type { WeeklyPoint } from "@/domain/reports/weekly-sla";
import { type CalendarDate, addDays } from "@/domain/time/calendar";
import { formatDay, monthName } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { bucketLabel } from "./ageing";
import { type GoalMark, type HeadlineCards, type TrendPoint, countText, percentText } from "./cards";

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
export function trendDescription(points: readonly TrendPoint[], goal: GoalMark | null): string {
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
  const word = goal === null ? null : verdict(goal.status);
  return goal === null || word === null ? movement : `${movement} ${t("committee.trend.goal", { goal: goal.text, verdict: word })}`;
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

const monthLabel = (period: string): string => monthName(period).slice(0, 3);

/** The monthly collection (M3 below 768px and C1 from 768px draw the same data): the points of the six months. */
export type MonthlyVisual = { text: ChartText; rows: BarRow[]; columns: StackColumn[]; labels: { collected: string; outstanding: string } };

/**
 * One description, one table and one set of numbers for the monthly collection, so the phone bars and the laptop columns can never disagree. The takeaway is the
 * movement of the collected share over the months that have bills; the table has Billed, Collected, Outstanding and the share of each month in full Indian grouping.
 */
export function monthlyVisual(series: readonly MonthlyPoint[]): MonthlyVisual {
  const points = series.map((p) => ({ label: monthLabel(p.period), value: p.collectedPercent }));
  return {
    text: {
      id: "monthly",
      caption: t("committee.monthly.caption"),
      title: t("committee.monthly.title"),
      description: t("committee.monthly.desc", { movement: trendDescription(points, null) }),
      table: {
        caption: t("committee.monthly.caption"),
        columns: [t("committee.monthly.col.month"), t("committee.monthly.col.billed"), t("committee.monthly.col.collected"), t("committee.monthly.col.outstanding"), t("committee.monthly.col.share")],
        rows: series.map((p) => ({
          header: `${monthName(p.period)} ${p.period.slice(0, 4)}`,
          cells: p.hasBills ? [formatRupees(p.billedPaise), formatRupees(p.collectedPaise), formatRupees(p.outstandingPaise), percentText(p.collectedPercent)] : Array.from({ length: 4 }, () => t("committee.noData")),
        })),
      },
    },
    rows: series.map((p) => ({ label: monthLabel(p.period), valueText: percentText(p.collectedPercent), value: p.collectedPercent ?? 0 })),
    labels: { collected: t("committee.monthly.collected"), outstanding: t("committee.monthly.outstanding") },
    columns: series.map((p) => ({ label: monthLabel(p.period), collected: Number(p.collectedPaise), outstanding: Number(p.outstandingPaise), hasData: p.hasBills, percentText: percentText(p.collectedPercent) })),
  };
}

/** The ageing chart (M4): the five age groups as bars of amount due (the oldest group hatched), the largest group named in the takeaway, and a table with flats and bills. */
export function ageingVisual(ageing: Ageing): { text: ChartText; rows: BarRow[] } {
  const largest = ageing.buckets.reduce((a, b) => (b.amountDuePaise > a.amountDuePaise ? b : a), ageing.buckets[0]);
  return {
    text: {
      id: "ageing",
      caption: t("committee.ageing.chart.caption"),
      title: t("committee.ageing.chart.title"),
      description:
        ageing.total.bills === 0 || largest === undefined
          ? t("committee.ageing.chart.none")
          : t("committee.ageing.chart.desc", { bucket: bucketLabel(largest.bucket), amount: formatRupeesShort(largest.amountDuePaise), total: formatRupeesShort(ageing.total.amountDuePaise) }),
      table: {
        caption: t("committee.ageing.chart.caption"),
        columns: [t("committee.ageing.col.age"), t("committee.ageing.col.flats"), t("committee.ageing.col.bills"), t("committee.ageing.col.amount")],
        rows: ageing.buckets.map((b) => ({ header: bucketLabel(b.bucket), cells: [countText(b.flats), countText(b.bills), formatRupees(b.amountDuePaise)] })),
      },
    },
    rows: ageing.buckets.map((b) => ({ label: bucketLabel(b.bucket), valueText: formatRupeesShort(b.amountDuePaise), value: Number(b.amountDuePaise), emphasis: b.bucket === "OVER_90" ? ("warning" as const) : undefined })),
  };
}

/** "Paid by the due date 70%, by day 20 80%, now 85%" as plain numbers: the due date reads "not yet due" before it has come and day 20 is left out before it has come. */
export function curvePlainNumbers(curve: PaymentCurve): { due: string; day20: string | null; now: string } {
  return { due: curve.byDueDay === null ? t("committee.curve.notYet") : percentText(curve.byDueDay), day20: curve.byDay20 === null ? null : percentText(curve.byDay20), now: percentText(curve.now) };
}

/** The payment curve (C3): collected share by day since issue, a dotted marker at the due day and the on-time goal as a dashed line; the table lists every day. */
export function curveVisual(
  curve: PaymentCurve | null,
  goalPercent: number,
): { text: ChartText; series: LineSeries[]; xMax: number; ticks: { x: number; label: string }[]; xLabel: string; marker: { x: number; label: string } | null; goal: { percent: number; label: string } } {
  const plain = curve === null ? null : curvePlainNumbers(curve);
  return {
    text: {
      id: "curve",
      caption: t("committee.curve.caption"),
      title: t("committee.curve.title"),
      description:
        curve === null || plain === null
          ? t("committee.curve.descNone")
          : plain.day20 === null
            ? t("committee.curve.descEarly", { due: plain.due, now: plain.now })
            : t("committee.curve.desc", { due: plain.due, day20: plain.day20, now: plain.now }),
      table: {
        caption: t("committee.curve.caption"),
        columns: [t("committee.curve.col.day"), t("committee.curve.col.collected"), t("committee.curve.col.share")],
        rows: (curve?.points ?? []).map((p) => ({ header: String(p.day), cells: [formatRupees(p.collectedPaise), percentText(p.percent)] })),
      },
    },
    series: [{ label: t("committee.curve.series"), points: (curve?.points ?? []).map((p) => ({ x: p.day, y: p.percent })) }],
    xMax: CURVE_DAYS,
    xLabel: t("committee.curve.xLabel"),
    ticks: [0, 10, 20, 30, 40].filter((day) => curve !== null && day <= curve.asOfDay).map((day) => ({ x: day, label: String(day) })),
    marker: curve === null || curve.asOfDay < curve.dueDay ? null : { x: curve.dueDay, label: t("committee.curve.dueDay") },
    goal: { percent: goalPercent, label: t("committee.sparkline.goal", { n: goalPercent }) },
  };
}

/** The weekly SLA chart (C4): the share of first replies within the SLA for each of the eight weeks, gaps where nothing was due; the table lists raised and the share. */
export function weeklyVisual(
  weeks: readonly WeeklyPoint[],
  goal: GoalMark,
  asOf: CalendarDate,
): { text: ChartText; series: LineSeries[]; xMax: number; ticks: { x: number; label: string }[]; xLabel: string; goal: { percent: number; label: string } } {
  const points = weeks.map((w) => ({ label: formatDay(w.weekStart), value: w.sharePercent }));
  const last = weeks.at(-1);
  const partialLabel = last === undefined || !last.partial ? null : asOf >= last.weekStart && asOf <= addDays(last.weekStart, 6) ? t("committee.weekly.soFar") : t("committee.weekly.partWeek");
  const rowHeader = (w: WeeklyPoint, index: number) => (partialLabel !== null && index === weeks.length - 1 ? `${formatDay(w.weekStart)} (${partialLabel})` : formatDay(w.weekStart));
  return {
    text: {
      id: "weekly",
      caption: t("committee.weekly.caption"),
      title: t("committee.weekly.title"),
      description: trendDescription(points, goal),
      table: {
        caption: t("committee.weekly.caption"),
        columns: [t("committee.weekly.col.week"), t("committee.weekly.col.raised"), t("committee.weekly.col.share")],
        rows: weeks.map((w, index) => ({ header: rowHeader(w, index), cells: [countText(w.raised), percentText(w.sharePercent)] })),
      },
    },
    series: [
      {
        label: t("committee.weekly.series"),
        points: weeks.map((w, index) => ({ x: index, y: w.sharePercent })),
        dots: true,
        ...(partialLabel === null ? {} : { partialIndex: weeks.length - 1, partialLabel }),
      },
    ],
    xMax: weeks.length - 1,
    xLabel: t("committee.weekly.xLabel"),
    ticks: weeks.map((w, index) => ({ x: index, label: formatDay(w.weekStart) })),
    goal: { percent: goal.targetPercent, label: t("committee.sparkline.goal", { n: goal.targetPercent }) },
  };
}
