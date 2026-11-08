import { LineChart } from "@/components/charts/line-chart";
import { WarningIcon } from "@/components/icons";
import type { ComplaintMetrics } from "@/domain/reports/complaints";
import type { GoalRow } from "@/domain/reports/goals";
import type { WeeklyPoint } from "@/domain/reports/weekly-sla";
import type { CalendarDate } from "@/domain/time/calendar";
import { monthName } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { type GoalMark, countText, goalMark } from "@/lib/reports/cards";
import { minutesText, shareText } from "@/lib/reports/share";
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
  const raised = t("committee.complaints.safetyRaised", { month, n: countText(safety.count), a: safety.closedByDutyManager, b: safety.openSeen, c: safety.openNotSeen });
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
export function ComplaintsBlock({ complaints, goals, slaGoal, weeks, period, unseenAllMonths }: { complaints: ComplaintMetrics; goals: readonly GoalRow[]; slaGoal: GoalMark; weeks: readonly WeeklyPoint[]; period: CalendarDate; unseenAllMonths: number }) {
  const visual = weeklyVisual(weeks, slaGoal);
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
      <dl className="flex flex-col border-t border-hairline">
        <StatRow label={t("committee.complaints.raisedLabel")}>{countText(complaints.raised)}</StatRow>
        <StatRow label={t("committee.complaints.firstReplyLabel")} detail={firstReply.decided === 0 ? undefined : t("committee.complaints.withinSla.detail", { n: firstReply.withinSla, d: firstReply.decided })} extra={<GoalLine mark={slaGoal} />}>
          {t("committee.complaints.firstReplyValue", { median: minutesText(firstReply.medianMinutes), share: shareText(firstReply.withinSla, firstReply.decided) })}
        </StatRow>
        <StatRow label={t("committee.complaints.resolved")} detail={resolved.count === 0 ? undefined : t("committee.complaints.resolved.detail", { n: resolved.count })}>
          {minutesText(resolved.medianMinutes)}
        </StatRow>
        <StatRow label={t("committee.complaints.reopened")} detail={resolved.count === 0 ? undefined : t("committee.complaints.reopened.detail", { n: resolved.reopened, d: resolved.count })} extra={<GoalLine mark={goalMark(goals, "reopenedMax")} />}>
          {shareText(resolved.reopened, resolved.count)}
        </StatRow>
        <StatRow label={t("committee.complaints.closed")} detail={closedSum}>
          {t("committee.complaints.closedSplit", { a: closed.byResident, b: closed.automatically, c: closed.byDutyManager })}
          {closed.other > 0 && `, ${t("committee.complaints.closedOther", { n: closed.other })}`}
        </StatRow>
        <StatRow label={t("committee.complaints.openNow")}>{countText(complaints.openNow)}</StatRow>
      </dl>
      <SafetyLine safety={safety} period={period} unseenAllMonths={unseenAllMonths} />
      {chart}
    </>
  );
}
