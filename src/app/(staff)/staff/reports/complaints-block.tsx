import { LineChart } from "@/components/charts/line-chart";
import { Ledger, type LedgerRow } from "@/components/committee/ledger";
import { Support } from "@/components/committee/support";
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

const count = (n: number): LedgerRow["value"] => countText(n);

/** The parts of a ledger and, when they do not add up to the total, one extra "Other" part with the rest: a remainder is shown, never hidden (D208). */
const withOther = (parts: readonly LedgerRow[], values: readonly number[], total: number): LedgerRow[] => {
  const rest = total - values.reduce((sum, n) => sum + n, 0);
  return rest === 0 ? [...parts] : [...parts, { label: t("committee.complaints.other"), value: count(rest) }];
};

/** A block of the page: its h2 and its content. */
function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section data-block="" aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-title font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function AllMonthsRow({ unseenAllMonths }: { unseenAllMonths: number }) {
  return (
    <dl role={unseenAllMonths > 0 ? "status" : undefined} className={unseenAllMonths > 0 ? "rounded-control border-2 border-caution px-3 text-caution" : undefined}>
      <StatRow figure="seen" label={t("committee.complaints.safetyAllMonths")}>
        {countText(unseenAllMonths)}
      </StatRow>
    </dl>
  );
}

/**
 * The safety block (D171, D211): the month's safety complaints as a ledger (closed by the duty manager, open and seen, open and not yet seen, which add up to the
 * raised total, with "Other" for the rest), the time to the first sight only when there is one, and the all-months count of open ones nobody has seen ONLY when it
 * differs from this month's line, so the page reconciles with the alert strip at the top. A complaint nobody has seen is in alert styling with an icon.
 */
function SafetyBlock({ safety, period, unseenAllMonths }: { safety: ComplaintMetrics["safety"]; period: CalendarDate; unseenAllMonths: number }) {
  const title = t("committee.complaints.safetyHeading", { month: monthName(period) });
  if (safety.count === 0) {
    return (
      <Block id="committee-safety" title={title}>
        <p className="text-body">{t("committee.complaints.safetyNone")}</p>
        {unseenAllMonths !== 0 && <AllMonthsRow unseenAllMonths={unseenAllMonths} />}
      </Block>
    );
  }
  const parts = withOther(
    [
      { label: t("committee.complaints.closedDuty"), value: count(safety.closedByDutyManager) },
      { label: t("committee.complaints.safetyOpenSeen"), value: count(safety.openSeen) },
      { label: t("committee.complaints.safetyOpenNotSeen"), value: count(safety.openNotSeen), alert: safety.openNotSeen > 0 },
    ],
    [safety.closedByDutyManager, safety.openSeen, safety.openNotSeen],
    safety.count,
  );
  return (
    <Block id="committee-safety" title={title}>
      <Ledger figure="seen ledger" parts={parts} total={{ label: t("committee.complaints.raisedLabel"), value: count(safety.count) }} />
      {safety.medianMinutesToSeen !== null && (
        <dl>
          <StatRow figure="seen" label={t("committee.complaints.safetyMedian")}>
            {minutesText(safety.medianMinutesToSeen)}
          </StatRow>
        </dl>
      )}
      {unseenAllMonths !== safety.openNotSeen && <AllMonthsRow unseenAllMonths={unseenAllMonths} />}
    </Block>
  );
}

/**
 * The complaints raised in the month, in FOUR blocks (D211): Replies (the promise, replied in time, half of first replies within), Resolution (half marked resolved
 * within, reopened), where the month's complaints stand (a ledger that adds up to Raised) and the safety complaints (a ledger). From 768px the weekly chart of
 * the Replies block. Every share and median says "No data" when it has nothing to measure; a month with no complaints says so once.
 */
export function ComplaintsBlock({ complaints, goals, slaGoal, weeks, period, asOf, unseenAllMonths, slaMinutes }: { complaints: ComplaintMetrics; goals: readonly GoalRow[]; slaGoal: GoalMark; weeks: readonly WeeklyPoint[]; period: CalendarDate; asOf: CalendarDate; unseenAllMonths: number; slaMinutes: SlaMinutes }) {
  const visual = weeklyVisual(weeks, slaGoal, asOf);
  const chart = weeks.some((w) => w.sharePercent !== null) && (
    <div data-figure-form="weekly" className="hidden md:block">
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
  const month = monthName(period);
  const stand = withOther(
    [
      { label: t("committee.complaints.closedResident"), value: count(closed.byResident) },
      { label: t("committee.complaints.closedAuto"), value: count(closed.automatically) },
      { label: t("committee.complaints.closedDuty"), value: count(closed.byDutyManager) },
      { label: t("committee.complaints.stillOpen"), value: count(complaints.openNow) },
    ],
    [closed.byResident, closed.automatically, closed.byDutyManager, complaints.openNow],
    complaints.raised,
  );
  return (
    <>
      <Block id="committee-replies" title={t("committee.complaints.repliesHeading")}>
        <Support>{promiseText(slaMinutes)}</Support>
        <dl className="flex flex-col border-t border-hairline">
          <StatRow figure="repliedInTime" label={t("committee.complaints.repliedInTime")} detail={firstReply.decided === 0 ? undefined : t("committee.complaints.withinSla.detail", { n: countText(firstReply.withinSla), d: countText(firstReply.decided) })} extra={<GoalLine mark={slaGoal} />}>
            {shareText(firstReply.withinSla, firstReply.decided)}
          </StatRow>
          <StatRow figure="firstReply" label={t("committee.complaints.firstReply")}>
            {minutesText(firstReply.medianMinutes)}
          </StatRow>
        </dl>
        {chart}
      </Block>
      <Block id="committee-resolution" title={t("committee.complaints.resolutionHeading")}>
        <dl className="flex flex-col border-t border-hairline">
          <StatRow figure="resolved" label={t("committee.complaints.resolved")}>
            {minutesText(resolved.medianMinutes)}
          </StatRow>
          <StatRow figure="reopened" label={t("committee.complaints.reopened")} detail={resolved.count === 0 ? undefined : t("committee.complaints.reopened.detail", { n: countText(resolved.reopened), d: countText(resolved.count) })} extra={<GoalLine mark={goalMark(goals, "reopenedMax")} />}>
            {shareText(resolved.reopened, resolved.count)}
          </StatRow>
        </dl>
      </Block>
      <Block id="committee-stand" title={t("committee.complaints.standHeading", { month })}>
        <Ledger figure="closedAuto closedDuty ledger" parts={stand} total={{ label: t("committee.complaints.raisedLabel"), value: count(complaints.raised) }} />
      </Block>
      <SafetyBlock safety={safety} period={period} unseenAllMonths={unseenAllMonths} />
    </>
  );
}
