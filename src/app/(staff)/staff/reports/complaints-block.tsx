import { WarningIcon } from "@/components/icons";
import type { ComplaintMetrics } from "@/domain/reports/complaints";
import type { CalendarDate } from "@/domain/time/calendar";
import { t } from "@/lib/messages";
import { periodLabel } from "@/lib/reports/period";
import { minutesText, shareText } from "@/lib/reports/share";
import { StatRow } from "./stat-row";

/**
 * The complaints raised in the month (by the day they were raised): how many, how fast the first reply came and how often it was within the SLA, how long to
 * "marked resolved", how many of those came back, who closed them, how many are open now, and the safety complaints with the time to acknowledgement and any
 * that nobody has acknowledged. Every share and median says "No data" when it has nothing to measure; a month with no complaints says so once.
 */
export function ComplaintsBlock({ period, complaints }: { period: CalendarDate; complaints: ComplaintMetrics }) {
  const heading = (
    <h2 id="committee-complaints" className="text-title font-semibold">
      {t("committee.complaints.heading", { month: periodLabel(period) })}
    </h2>
  );
  if (complaints.raised === 0) {
    return (
      <section aria-labelledby="committee-complaints" className="flex flex-col gap-2">
        {heading}
        <p className="text-body">{t("committee.complaints.none")}</p>
      </section>
    );
  }
  const { firstReply, resolved, closed, safety } = complaints;
  return (
    <section aria-labelledby="committee-complaints" className="flex flex-col gap-2">
      {heading}
      <dl className="flex flex-col border-t border-hairline">
        <StatRow label={t("committee.complaints.raised")}>{complaints.raised}</StatRow>
        <StatRow label={t("committee.complaints.firstReply")} detail={firstReply.replied === 0 ? undefined : t("committee.complaints.firstReply.detail", { n: firstReply.replied })}>
          {minutesText(firstReply.medianMinutes)}
        </StatRow>
        <StatRow label={t("committee.complaints.withinSla")} detail={firstReply.decided === 0 ? undefined : t("committee.complaints.withinSla.detail", { n: firstReply.withinSla, d: firstReply.decided })}>
          {shareText(firstReply.withinSla, firstReply.decided)}
        </StatRow>
        <StatRow label={t("committee.complaints.resolved")} detail={resolved.count === 0 ? undefined : t("committee.complaints.resolved.detail", { n: resolved.count })}>
          {minutesText(resolved.medianMinutes)}
        </StatRow>
        <StatRow label={t("committee.complaints.reopened")} detail={resolved.count === 0 ? undefined : t("committee.complaints.reopened.detail", { n: resolved.reopened, d: resolved.count })}>
          {shareText(resolved.reopened, resolved.count)}
        </StatRow>
        <StatRow label={t("committee.complaints.byResident")}>{closed.byResident}</StatRow>
        <StatRow label={t("committee.complaints.automatically")} detail={t("committee.complaints.automatically.hint")}>
          {closed.automatically}
        </StatRow>
        <StatRow label={t("committee.complaints.openNow")}>{complaints.openNow}</StatRow>
      </dl>
      <h3 className="pt-2 text-body font-semibold">{t("committee.complaints.safety.heading")}</h3>
      <dl className="flex flex-col border-t border-hairline">
        <StatRow label={t("committee.complaints.safety.count")}>{safety.count}</StatRow>
        <StatRow label={t("committee.complaints.safety.ack")} detail={safety.acknowledged === 0 ? undefined : t("committee.complaints.safety.ack.detail", { n: safety.acknowledged })}>
          {minutesText(safety.medianMinutesToAcknowledge)}
        </StatRow>
        <StatRow label={t("committee.complaints.safety.unacked")}>{safety.unacknowledgedNow}</StatRow>
      </dl>
      {safety.unacknowledgedNow > 0 && (
        <p role="status" className="flex items-center gap-2 rounded-control border-2 border-caution p-3 text-body font-semibold text-caution">
          <WarningIcon size={20} />
          {safety.unacknowledgedNow === 1 ? t("committee.complaints.safety.warnOne") : t("committee.complaints.safety.warnMany", { n: safety.unacknowledgedNow })}
        </p>
      )}
    </section>
  );
}
