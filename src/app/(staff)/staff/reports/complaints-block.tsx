import { LineChart } from "@/components/charts/line-chart";
import { WarningIcon } from "@/components/icons";
import type { ComplaintMetrics } from "@/domain/reports/complaints";
import type { GoalRow } from "@/domain/reports/goals";
import type { WeeklyPoint } from "@/domain/reports/weekly-sla";
import { t } from "@/lib/messages";
import { type GoalMark, countText, goalMark } from "@/lib/reports/cards";
import { minutesText, shareText } from "@/lib/reports/share";
import { weeklyVisual } from "@/lib/reports/visuals";
import { GoalLine } from "./goal-mark";
import { StatRow } from "./stat-row";

/** The one safety line: how many were raised and whether all were acknowledged (the ones not acknowledged in alert styling, with an icon), and the median time to acknowledgement only when there is one. */
function SafetyLine({ safety }: { safety: ComplaintMetrics["safety"] }) {
  if (safety.count === 0) return <p className="text-body">{t("committee.complaints.safetyNone")}</p>;
  const waiting = safety.count - safety.acknowledged;
  return (
    <div className="flex flex-col gap-2">
      {waiting > 0 ? (
        <p role="status" className="flex items-center gap-2 rounded-control border-2 border-caution p-3 text-body font-semibold text-caution">
          <WarningIcon size={20} />
          {t("committee.complaints.safetyWaiting", { u: waiting, n: safety.count })}
        </p>
      ) : (
        <p className="text-body">{safety.count === 1 ? t("committee.complaints.safetyOne") : t("committee.complaints.safetyAll", { n: countText(safety.count) })}</p>
      )}
      {safety.medianMinutesToAcknowledge !== null && <p className="text-body">{t("committee.complaints.safetyMedian", { time: minutesText(safety.medianMinutesToAcknowledge) })}</p>}
    </div>
  );
}

/**
 * The complaints raised in the month, in SIX lines: how many were raised; the first reply (median time and the share in time, with the SLA goal and Met or Not
 * met); the time to marked resolved; the reopened share with its goal; who closed them; how many are open now. Then ONE safety line, and from 768px the weekly SLA
 * chart. Every share and median says "No data" when it has nothing to measure; a month with no complaints says so once.
 */
export function ComplaintsBlock({ complaints, goals, slaGoal, weeks }: { complaints: ComplaintMetrics; goals: readonly GoalRow[]; slaGoal: GoalMark; weeks: readonly WeeklyPoint[] }) {
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
        <StatRow label={t("committee.complaints.closed")}>{t("committee.complaints.closedSplit", { a: closed.byResident, b: closed.automatically })}</StatRow>
        <StatRow label={t("committee.complaints.openNow")}>{countText(complaints.openNow)}</StatRow>
      </dl>
      <SafetyLine safety={safety} />
      {chart}
    </>
  );
}
