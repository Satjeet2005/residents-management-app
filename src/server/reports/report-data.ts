import { type Ageing, ageingTable } from "@/domain/reports/age";
import { type ComplaintMetrics, complaintMetrics } from "@/domain/reports/complaints";
import { type CollectionQuality, type MoneyLine, collectionQuality, moneyLine } from "@/domain/reports/money-line";
import type { ReportPosition } from "@/domain/reports/positions";
import { type CalendarDate, istDateOf } from "@/domain/time/calendar";
import { choosePeriod, periodOptions } from "@/lib/reports/period";
import type { Db } from "@/server/auth/db";
import type { SessionUser } from "@/server/auth/session-service";
import { requirePermission } from "@/server/statements/ui-data";
import { loadMonthComplaints } from "./complaints";
import { loadReportPositions } from "./positions";

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
  /** How promptly the month's bills were paid; null when the month has no bills. */
  quality: CollectionQuality | null;
  /** The complaints raised in the month, as counts and medians (the screen takes the shares with `percent`). */
  complaints: ComplaintMetrics;
};

/** The positions of the bills of one period. */
export const inPeriod = (positions: readonly ReportPosition[], period: CalendarDate): ReportPosition[] => positions.filter((p) => p.bill.period === period);

/**
 * The data of /staff/reports (D5, D131). The permission is checked here, at the data (the page has already sent anyone else away). The business clock decides
 * "as of". Every figure comes from `billPosition` through `positionsForFlat`, the function the Home uses.
 */
export async function loadCommitteeReport(input: { db: Db; user: Viewer; requestedPeriod: CalendarDate | null; now: number }): Promise<CommitteeReport> {
  requirePermission(input.user, "reports:view");
  const asOf = istDateOf(input.now);
  const { positions } = await loadReportPositions(input.db, asOf);
  const periods = periodOptions(positions.map((p) => p.bill.period), asOf);
  const period = choosePeriod({ requested: input.requestedPeriod, options: periods, asOf });
  const monthPositions = inPeriod(positions, period);
  const complaints = await loadMonthComplaints(input.db, period);
  return {
    asOf,
    period,
    periods,
    money: monthPositions.length === 0 ? null : moneyLine(monthPositions),
    ageing: ageingTable(positions, asOf),
    quality: monthPositions.length === 0 ? null : collectionQuality(monthPositions, asOf),
    complaints: complaintMetrics(complaints, input.now),
  };
}
