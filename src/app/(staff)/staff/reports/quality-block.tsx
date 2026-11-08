import { LineChart } from "@/components/charts/line-chart";
import type { CollectionQuality } from "@/domain/reports/money-line";
import type { PaymentCurve } from "@/domain/reports/payment-curve";
import type { CalendarDate } from "@/domain/time/calendar";
import { monthName } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { type GoalMark, countText } from "@/lib/reports/cards";
import { daysText, shareText } from "@/lib/reports/share";
import { curvePlainNumbers, curveVisual } from "@/lib/reports/visuals";
import { GoalLine } from "./goal-mark";
import { StatRow } from "./stat-row";

/**
 * How promptly the month's bills were paid, in THREE rows: the headline on-time rate (on-time payments out of ALL the month's bills that are due so far, D132) with its
 * goal and Met or Not met, the same counted out of the paid bills only, and the median days to pay. Then three plain numbers (paid by the due date, by day 20, now)
 * and, from 768px, the payment curve. There is no "paid late" row: it is the other side of "on time" and would say the same thing twice. A share with nothing to
 * measure says "No data", never 0%.
 */
export function QualityBlock({ quality, curve, goal, period }: { quality: CollectionQuality; curve: PaymentCurve | null; goal: GoalMark; period: CalendarDate }) {
  const visual = curveVisual(curve, goal.targetPercent, period);
  const plain = curve === null ? null : curvePlainNumbers(curve);
  const month = monthName(period);
  return (
    <>
      <dl className="flex flex-col border-t border-hairline">
        <StatRow label={t("committee.quality.onTime")} detail={quality.due === 0 ? undefined : t("committee.quality.onTime.detail", { n: countText(quality.dueOnTime), d: countText(quality.due) })} extra={<GoalLine mark={goal} />}>
          {shareText(quality.dueOnTime, quality.due)}
        </StatRow>
        <StatRow label={t("committee.quality.onTimeOfPaid")} detail={quality.paid === 0 ? undefined : t("committee.quality.onTimeOfPaid.detail", { n: countText(quality.paidOnTime), d: countText(quality.paid), u: countText(quality.bills - quality.paid) })}>
          {shareText(quality.paidOnTime, quality.paid)}
        </StatRow>
        <StatRow label={t("committee.quality.median")} detail={quality.paid === 0 ? undefined : t("committee.quality.median.detail", { n: countText(quality.paid) })}>
          {daysText(quality.medianDaysToPay)}
        </StatRow>
      </dl>
      {plain !== null && <p className="tnum text-body">{plain.day20 === null ? t("committee.quality.plainEarly", { month, due: plain.due, now: plain.now }) : t("committee.quality.plain", { month, due: plain.due, day20: plain.day20, now: plain.now })}</p>}
      {curve !== null && (
        <div className="hidden md:block">
          <LineChart text={visual.text} series={visual.series} xMax={visual.xMax} xTicks={visual.ticks} xLabel={visual.xLabel} goal={visual.goal} marker={visual.marker} />
          {visual.note !== null && <p className="pt-2 text-body text-ink-2">{visual.note}</p>}
        </div>
      )}
    </>
  );
}
