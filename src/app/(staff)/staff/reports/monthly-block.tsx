import { HorizontalBars } from "@/components/charts/horizontal-bars";
import { StackedBars } from "@/components/charts/stacked-bars";
import type { MonthlyPoint } from "@/domain/reports/series";
import { monthName } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { monthlyVisual } from "@/lib/reports/visuals";

/**
 * One takeaway sentence for the monthly chart, worked out from its last two months with bills ("October is 83% at day 20; September was 93%."), or null when there
 * are not two such months. A month younger than 20 days says "so far".
 */
export function monthlyTakeaway(series: readonly MonthlyPoint[]): string | null {
  const billed = series.filter((p) => p.hasBills && p.byDay20Percent !== null);
  const [before, now] = billed.slice(-2);
  if (before === undefined || now === undefined) return null;
  const args = { month: monthName(now.period), n: now.byDay20Percent as number, before: monthName(before.period), m: before.byDay20Percent as number };
  return now.inProgress ? t("committee.monthly.takeawaySoFar", args) : t("committee.monthly.takeaway", args);
}

/** "Collected within 20 days, by month": the bars below 768px and the columns from 768px (the same data and table), one takeaway sentence, and the notes. */
export function MonthlyBlock({ series }: { series: readonly MonthlyPoint[] }) {
  const visual = monthlyVisual(series);
  const takeaway = monthlyTakeaway(series);
  return (
    <section aria-labelledby="committee-monthly" className="flex flex-col gap-3">
      <h2 id="committee-monthly" className="text-title font-semibold">
        {t("committee.monthly.heading")}
      </h2>
      {takeaway !== null && <p className="text-body">{takeaway}</p>}
      <div className="md:hidden">
        <HorizontalBars text={{ ...visual.phoneText, id: "monthly-bars" }} rows={visual.rows} scaleMax={100} />
      </div>
      <div className="hidden md:block">
        <StackedBars text={{ ...visual.text, id: "monthly-columns" }} columns={visual.columns} labels={visual.labels} />
      </div>
      <ul className="flex list-none flex-col gap-1 p-0 text-body text-ink-2">
        {visual.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}
