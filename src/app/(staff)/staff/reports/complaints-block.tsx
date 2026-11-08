import { LineChart } from "@/components/charts/line-chart";
import { WarningIcon } from "@/components/icons";
import type { SlaMinutes } from "@/domain/complaints/lifecycle";
import type { ComplaintMetrics } from "@/domain/reports/complaints";
import type { GoalRow } from "@/domain/reports/goals";
import type { WeeklyPoint } from "@/domain/reports/weekly-sla";
import type { CalendarDate } from "@/domain/time/calendar";
import { monthName } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { type GoalMark, countText, goalMark } from "@/lib/reports/cards";
import { minutesText, promiseText, shareText } from "@/lib/reports/share";
import { weeklyVisual } from "@/lib/reports/visuals";
import { GoalLine } from "./goal-mark";
import { StatRow } from "./stat-row";

/**
 * The safety lines (D171): the month's safety complaints by what became of them, and the all-months count of open ones nobody has seen (the number of the strip at
 * the top), so the two reconcile. Any not seen is in alert styling with an icon. The median time to the first sight only when there is one.
 */
function SafetyLine({ safety, period, unseenAllMonths }: { safety: ComplaintMetrics["safety"]; period: CalendarDate; unseenAllMonths: number }) {
  if (safety.count === 0) return <p className="text-body">{t("committee.complaints.safetyNone")}</p>;
  const month = monthName(period);
  const raised = t("committee.complaints.safetyRaised", { month, n: countText(safety.count), a: countText(safety.closedByDutyManager), b: countText(safety.openSeen), c: countText(safety.openNotSeen) });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body">{raised}</p>
      {safety.closedOtherWay > 0 && <p className="text-body">{t("committee.complaints.safetyOther", { n: safety.closedOtherWay })}</p>}
      {unseenAllMonths > 0 ? (
        <p role="status" className="flex items-center gap-2 rounded-control border-2 border-caution p-3 text-body font-semibold text-caution">
          <WarningIcon size={20} />
          {t("committee.complaints.safetyAllMonths", { k: countText(unseenAllMonths) })}
        </p>
      ) : (
        <p className="text-body">{t("committee.complaints.safetyAllMonths", { k: 0 })}</p>
      )}
      {safety.medianMinutesToSeen !== null && <p className="text-body">{t("committee.complaints.safetyMedian", { time: minutesText(safety.medianMinutesToSeen) })}</p>}
    </div>
  );
}

/**
 * The complaints raised in the month, in SIX lines: how many were raised; the first reply (median time and the share in time, with the SLA goal and Met or Not
 * met); the time to marked resolved; the reopened share with its goal; who closed them; how many are open now. Then ONE safety line, and from 768px the weekly SLA
 * chart. Every share and median says "No data" when it has nothing to measure; a month with no complaints says so once.
 */
export function ComplaintsBlock({ complaints, goals, slaGoal, weeks, period, asOf, unseenAllMonths, slaMinutes }: { complaints: ComplaintMetrics; goals: readonly GoalRow[]; slaGoal: GoalMark; weeks: readonly WeeklyPoint[]; period: CalendarDate; asOf: CalendarDate; unseenAllMonths: number; slaMinutes: SlaMinutes }) {
  const visual = weeklyVisual(weeks, slaGoal, asOf);
  const chart = weeks.some((w) => w.sharePercent !== null) && (
    <div className="hidden md:block">
      <LineChart text={visual.text} series={visual.series} xMax={visual.xMax} xTicks={visual.ticks} xLabel={visual.xLabel} goal={visual.goal} marker={null} />
    </div>
  );
  if (complaints.raised === 0) {
    return (
      <>
        <p className="text-body">{t("committee.complaints.none")}</p>
        {chart}
      </>
    );
  }
  const { firstReply, resolved, closed, safety } = complaints;
  const closedTotal = closed.byResident + closed.automatically + closed.byDutyManager + closed.other;
  const closedSum = t("committee.complaints.sum", { raised: countText(complaints.raised), closed: countText(closedTotal), open: countText(complaints.openNow) });
  return (
    <>
      <div className="flex flex-col">
        <p className="text-body font-semibold">{t("committee.complaints.promiseTitle")}</p>
        <p className="text-body text-ink-2">{promiseText(slaMinutes)}</p>
      </div>
      <dl className="flex flex-col border-t border-hairline">
        <StatRow label={t("committee.complaints.raisedLabel")}>{countText(complaints.raised)}</StatRow>
        <StatRow label={t("committee.complaints.typicalReply")} detail={firstReply.replied === 0 ? undefined : t("committee.complaints.typicalReply.detail", { n: countText(firstReply.replied) })}>
          {minutesText(firstReply.medianMinutes)}
        </StatRow>
        <StatRow label={t("committee.complaints.repliedInTime")} detail={firstReply.decided === 0 ? undefined : t("committee.complaints.withinSla.detail", { n: countText(firstReply.withinSla), d: countText(firstReply.decided) })} extra={<GoalLine mark={slaGoal} />}>
          {shareText(firstReply.withinSla, firstReply.decided)}
        </StatRow>
        <StatRow label={t("committee.complaints.resolved")} detail={resolved.count === 0 ? undefined : t("committee.complaints.resolved.detail", { n: countText(resolved.count) })}>
          {minutesText(resolved.medianMinutes)}
        </StatRow>
        <StatRow label={t("committee.complaints.reopened")} detail={resolved.count === 0 ? undefined : t("committee.complaints.reopened.detail", { n: countText(resolved.reopened), d: countText(resolved.count) })} extra={<GoalLine mark={goalMark(goals, "reopenedMax")} />}>
          {shareText(resolved.reopened, resolved.count)}
        </StatRow>
        <StatRow label={t("committee.complaints.closed")} detail={closedSum}>
          {t("committee.complaints.closedSplit", { a: countText(closed.byResident), b: countText(closed.automatically), c: countText(closed.byDutyManager) })}
          {closed.other > 0 && `, ${t("committee.complaints.closedOther", { n: closed.other })}`}
        </StatRow>
        <StatRow label={t("committee.complaints.openNow")}>{countText(complaints.openNow)}</StatRow>
      </dl>
      <SafetyLine safety={safety} period={period} unseenAllMonths={unseenAllMonths} />
      {chart}
    </>
  );
}
