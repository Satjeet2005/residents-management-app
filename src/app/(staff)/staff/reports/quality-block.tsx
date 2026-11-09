import { LineChart } from "@/components/charts/line-chart";
import { Support } from "@/components/committee/support";
import type { CollectionQuality } from "@/domain/reports/money-line";
import type { PaymentCurve } from "@/domain/reports/payment-curve";
import type { CalendarDate } from "@/domain/time/calendar";
import { t } from "@/lib/messages";
import type { GoalMark } from "@/lib/reports/cards";
import { countText } from "@/lib/reports/cards";
import { daysText, shareText } from "@/lib/reports/share";
import { curvePlainNumbers, curveVisual } from "@/lib/reports/visuals";
import { GoalLine } from "./goal-mark";
import { StatRow } from "./stat-row";

/**
 * How promptly the month's bills were paid, in exactly THREE rows (D209): the bills paid by the due date out of ALL the month's bills that are due so far (D132) with
 * its count and its goal and Met or Not met; half of paid bills are paid within so many days; the money collected by the due date, by rupees. From 768px the payment
 * curve follows. The figure "of bills that were paid" is in the expander only. A share with nothing to measure says "No data", never 0%.
 */
export function QualityBlock({ quality, curve, goal, period }: { quality: CollectionQuality; curve: PaymentCurve | null; goal: GoalMark; period: CalendarDate }) {
  const visual = curveVisual(curve, goal.targetPercent, period);
  const byDue = curve === null ? t("committee.noData") : curvePlainNumbers(curve).due;
  return (
    <>
      <dl className="flex flex-col border-t border-hairline">
        <StatRow figure="paidByDue" label={t("committee.quality.onTime")} detail={quality.due === 0 ? undefined : t("committee.quality.onTime.detail", { n: countText(quality.dueOnTime), d: countText(quality.due) })} extra={<GoalLine mark={goal} />}>
          {shareText(quality.dueOnTime, quality.due)}
        </StatRow>
        <StatRow figure="medianDays" label={t("committee.quality.median")}>
          {daysText(quality.medianDaysToPay)}
        </StatRow>
        <StatRow figure="moneyByDue" label={t("committee.quality.byDueMoney")}>
          {byDue}
        </StatRow>
      </dl>
      {curve !== null && (
        <div data-figure-form="moneyByDue" className="hidden md:block">
          <LineChart text={visual.text} series={visual.series} xMax={visual.xMax} xTicks={visual.ticks} xLabel={visual.xLabel} goal={visual.goal} marker={visual.marker} />
          {visual.note !== null && <Support className="pt-2">{visual.note}</Support>}
        </div>
      )}
    </>
  );
}
