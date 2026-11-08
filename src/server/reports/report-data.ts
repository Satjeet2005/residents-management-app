import { type AgeBucket, type Ageing, ageingTable } from "@/domain/reports/age";
import { type ComplaintMetrics, complaintMetrics } from "@/domain/reports/complaints";
import { type GoalRow, evaluateGoals, goalsFromSetting } from "@/domain/reports/goals";
import { type CollectionQuality, type MoneyLine, collectionQuality, moneyLine } from "@/domain/reports/money-line";
import { type PaymentCurve, paymentCurve } from "@/domain/reports/payment-curve";
import { lastPeriods } from "@/domain/reports/periods";
import type { ReportPosition } from "@/domain/reports/positions";
import type { ReconciliationLine } from "@/domain/reports/reconciliation";
import { type MonthlySlaPoint, monthlySla } from "@/domain/reports/monthly-sla";
import { type MonthlyPoint, type OnTimePoint, monthlySeries, onTimeRateByPeriod } from "@/domain/reports/series";
import { type WeeklyPoint, isoWeekStart, weeklySla, WEEKS } from "@/domain/reports/weekly-sla";
import { type CalendarDate, addDays, dayStartInstant, istDateOf } from "@/domain/time/calendar";
import { type HeadlineCards, buildCards } from "@/lib/reports/cards";
import { type SectionHeadlines, sectionHeadlines } from "@/lib/reports/headlines";
import { choosePeriod, monthStart, periodOptions } from "@/lib/reports/period";
import type { Db } from "@/server/auth/db";
import type { SessionUser } from "@/server/auth/session-service";
import { countUnacknowledgedSafety } from "@/server/complaints/board-views";
import { requirePermission } from "@/server/statements/ui-data";
import { type AgeingPage, ageingPageOf } from "./ageing-page";
import { loadComplaintsBetween } from "./complaints";
import { loadReportPositions } from "./positions";
import { loadReconciliationLine } from "./reconciliation";

type Viewer = Pick<SessionUser, "id" | "role" | "active" | "permissions">;

/** What the committee page shows. Every number is computed from the database as of the business date. */
export type CommitteeReport = {
  /** The business date the report is as of. */
  asOf: CalendarDate;
  /** The month shown (its first day) and the months that can be picked, newest first. */
  period: CalendarDate;
  periods: CalendarDate[];
  /** The bills of the month and the money line over them; null when the month has no bills. */
  money: MoneyLine | null;
  /** What is owed, all open dues of all months, as of the business date. */
  ageing: Ageing;
  /** The first page of the drill-down of the bucket in the address (`?bucket=`), or null when none was asked for. */
  drilldown: AgeingPage | null;
  /** How promptly the month's bills were paid; null when the month has no bills. */
  quality: CollectionQuality | null;
  /** The complaints raised in the month, as counts and medians (the screen takes the shares with `percent`). */
  complaints: ComplaintMetrics;
  /** The last 30 days to the business date: bank rows by what became of them, the accounted check and the manual interventions. */
  reconciliation: ReconciliationLine;
  /** The committee's targets against the month's actuals. `source` says whether the targets are the `committee_goals` setting or the built-in defaults. */
  goals: { rows: GoalRow[]; source: "SETTING" | "DEFAULT" };
  /** The four headline cards and the one-sentence headline of each section: text and numbers worked out from the figures above. */
  cards: HeadlineCards;
  headlines: SectionHeadlines;
  /** The series behind the visuals: six months of money and on-time rates (the selected month last), the payment curve of the month, eight weeks of SLA. */
  series: { monthly: MonthlyPoint[]; onTime: OnTimePoint[]; monthlySla: MonthlySlaPoint[]; weeklySla: WeeklyPoint[]; curve: PaymentCurve | null };
  /** Safety complaints of any month that are not closed and have no acknowledgement by the duty manager: the alert at the top of the page. */
  safetyUnacknowledged: number;
  /** Does the viewer hold complaints:manage (the alert links to the safety view only for them)? */
  canManageComplaints: boolean;
};

/** The positions of the bills of one period. */
export const inPeriod = (positions: readonly ReportPosition[], period: CalendarDate): ReportPosition[] => positions.filter((p) => p.bill.period === period);

const minDate = (dates: readonly CalendarDate[]): CalendarDate => dates.reduce((a, b) => (a < b ? a : b));

/**
 * The data of /staff/reports (D5, D131). The permission is checked here, at the data (the page has already sent anyone else away). The business clock decides
 * "as of". Every figure comes from `billPosition` through `positionsForFlat`, the function the Home uses. TEN reads however many flats, bills and complaints
 * there are: the policy, the bills and the ledger entries (three), one window of complaints and its events (two), the bank rows (three), the goals setting
 * and the safety complaints nobody has acknowledged. Every series is cut from those in memory.
 */
export async function loadCommitteeReport(input: { db: Db; user: Viewer; requestedPeriod: CalendarDate | null; bucket?: AgeBucket | null; now: number }): Promise<CommitteeReport> {
  requirePermission(input.user, "reports:view");
  const asOf = istDateOf(input.now);
  const { positions } = await loadReportPositions(input.db, asOf);
  const periods = periodOptions(positions.map((p) => p.bill.period), asOf);
  const period = choosePeriod({ requested: input.requestedPeriod, options: periods, asOf });
  const monthPositions = inPeriod(positions, period);
  const until = monthStart(addDays(period, 31));
  const chartEnd = minDate([asOf, addDays(until, -1)]);
  const months = lastPeriods(period, asOf);
  const from = minDate([addDays(isoWeekStart(chartEnd), -7 * (WEEKS - 1)), months[0]]);
  const [window, reconciliation, goalSetting, safetyUnacknowledged] = await Promise.all([
    loadComplaintsBetween(input.db, from, until),
    loadReconciliationLine(input.db, asOf),
    input.db.societySetting.findUnique({ where: { key: "committee_goals" }, select: { value: true } }),
    countUnacknowledgedSafety(input.db),
  ]);
  const inMonth = (start: CalendarDate) => window.filter((c) => c.createdAt >= dayStartInstant(start) && c.createdAt < dayStartInstant(monthStart(addDays(start, 31))));
  const complaints = inMonth(period);
  const quality = monthPositions.length === 0 ? null : collectionQuality(monthPositions, asOf);
  const metrics = complaintMetrics(complaints, input.now);
  const { goals, source } = goalsFromSetting(goalSetting?.value);
  const goalRows = evaluateGoals(goals, {
    onTime: { n: quality?.dueOnTime ?? 0, d: quality?.due ?? 0 },
    firstReply: { n: metrics.firstReply.withinSla, d: metrics.firstReply.decided },
    reopened: { n: metrics.resolved.reopened, d: metrics.resolved.count },
  });
  const onTime = onTimeRateByPeriod(positions, months, asOf);
  const slaMonths = monthlySla(window, months, input.now);
  const weeks = weeklySla(window, chartEnd, input.now);
  const ageing = ageingTable(positions, asOf);
  const money = monthPositions.length === 0 ? null : moneyLine(monthPositions);
  return {
    asOf,
    period,
    periods,
    money,
    ageing,
    drilldown: input.bucket === undefined || input.bucket === null ? null : ageingPageOf(positions, asOf, input.bucket, null),
    quality,
    complaints: metrics,
    reconciliation,
    goals: { source, rows: goalRows },
    cards: buildCards({ money, ageing, onTime, sla: { months: slaMonths }, goals: goalRows }),
    headlines: sectionHeadlines({ money, ageing, quality, complaints: metrics, reconciliation }),
    series: {
      monthly: monthlySeries(positions, months, asOf),
      onTime,
      monthlySla: slaMonths,
      weeklySla: weeks,
      curve:
        monthPositions.length === 0
          ? null
          : paymentCurve({
              bills: monthPositions.map((p) => ({ amountPaise: p.bill.amountPaise, payments: p.payments })),
              issueDate: minDate(monthPositions.map((p) => p.bill.issuedOn)),
              dueDate: minDate(monthPositions.map((p) => p.bill.dueOn)),
              asOf,
            }),
    },
    safetyUnacknowledged,
    canManageComplaints: input.user.permissions.includes("complaints:manage"),
  };
}
