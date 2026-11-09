import { Support } from "@/components/committee/support";
import { HorizontalBars } from "@/components/charts/horizontal-bars";
import { StackedBars } from "@/components/charts/stacked-bars";
import type { MonthlyPoint } from "@/domain/reports/series";
import { monthName } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { monthlyVisual } from "@/lib/reports/visuals";

const STEADY_POINTS = 5;

const pointsText = (n: number): string => (n === 1 ? t("committee.goal.point") : t("committee.goal.points", { n }));

/**
 * The ONE takeaway sentence of the monthly chart (D210), worked out from the months shown (the months with bills and a figure at day 20): when the highest and the
 * lowest are at most 5 points apart, "Steady: 83 to 93% in every month."; otherwise the last month against the one before it ("October is 10 points lower than
 * September (83% vs 93%)."). A last month younger than 20 days says "so far". Null when fewer than two months have a figure.
 */
export function monthlyTakeaway(series: readonly MonthlyPoint[]): string | null {
  const billed = series.filter((p) => p.hasBills && p.byDay20Percent !== null);
  const [before, now] = billed.slice(-2);
  if (before === undefined || now === undefined) return null;
  const values = billed.map((p) => p.byDay20Percent as number);
  const [low, high] = [Math.min(...values), Math.max(...values)];
  const soFar = now.inProgress;
  if (high - low <= STEADY_POINTS) return soFar ? t("committee.monthly.steadySoFar", { low, high }) : t("committee.monthly.steady", { low, high });
  const [a, b] = [now.byDay20Percent as number, before.byDay20Percent as number];
  const args = { month: monthName(now.period), before: monthName(before.period), a, b, points: pointsText(Math.abs(a - b)) };
  if (a === b) return soFar ? t("committee.monthly.sameSoFar", args) : t("committee.monthly.same", args);
  if (a > b) return soFar ? t("committee.monthly.higherSoFar", args) : t("committee.monthly.higher", args);
  return soFar ? t("committee.monthly.lowerSoFar", args) : t("committee.monthly.lower", args);
}

/** "Collected within 20 days, by month": the bars below 768px and the columns from 768px (the same data and table), and the one takeaway sentence. */
export function MonthlyBlock({ series }: { series: readonly MonthlyPoint[] }) {
  const visual = monthlyVisual(series);
  const takeaway = monthlyTakeaway(series);
  return (
    <section data-block="" aria-labelledby="committee-monthly" className="flex flex-col gap-3">
      <h2 id="committee-monthly" className="text-title font-semibold">
        {t("committee.monthly.heading")}
      </h2>
      {takeaway !== null && (
        <Support takeaway className="font-semibold">
          {takeaway}
        </Support>
      )}
      <div data-figure="within20" className="md:hidden">
        <HorizontalBars text={{ ...visual.phoneText, id: "monthly-bars" }} rows={visual.rows} scaleMax={100} />
      </div>
      <div data-figure-form="within20" className="hidden md:block">
        <StackedBars text={{ ...visual.text, id: "monthly-columns" }} columns={visual.columns} labels={visual.labels} />
      </div>
    </section>
  );
}
