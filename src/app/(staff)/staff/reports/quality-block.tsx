import type { CollectionQuality } from "@/domain/reports/money-line";
import type { CalendarDate } from "@/domain/time/calendar";
import { t } from "@/lib/messages";
import { periodLabel } from "@/lib/reports/period";
import { daysText, shareText } from "@/lib/reports/share";
import { StatRow } from "./stat-row";

/**
 * How promptly the month's bills were paid: the headline on-time rate (on-time payments out of ALL the month's bills that are due so far, D134), the same
 * counted out of the paid bills only as a secondary line, the median days to pay (from the issue date) and the share paid late (out of the paid bills). A share
 * with nothing to measure says "No data", never 0%.
 */
export function QualityBlock({ period, quality }: { period: CalendarDate; quality: CollectionQuality }) {
  return (
    <section aria-labelledby="committee-quality" className="flex flex-col gap-2">
      <h2 id="committee-quality" className="text-title font-semibold">
        {t("committee.quality.heading", { month: periodLabel(period) })}
      </h2>
      <dl className="flex flex-col border-t border-hairline">
        <StatRow label={t("committee.quality.onTime")} detail={quality.due === 0 ? undefined : t("committee.quality.onTime.detail", { n: quality.dueOnTime, d: quality.due })}>
          {shareText(quality.dueOnTime, quality.due)}
        </StatRow>
        <StatRow label={t("committee.quality.onTimeOfPaid")} detail={quality.paid === 0 ? undefined : t("committee.quality.onTimeOfPaid.detail", { n: quality.paidOnTime, d: quality.paid })}>
          {shareText(quality.paidOnTime, quality.paid)}
        </StatRow>
        <StatRow label={t("committee.quality.median")} detail={quality.paid === 0 ? undefined : t("committee.quality.median.detail", { n: quality.paid })}>
          {daysText(quality.medianDaysToPay)}
        </StatRow>
        <StatRow label={t("committee.quality.late")} detail={quality.paid === 0 ? undefined : t("committee.quality.late.detail", { n: quality.paidLate, d: quality.paid })}>
          {shareText(quality.paidLate, quality.paid)}
        </StatRow>
      </dl>
    </section>
  );
}
