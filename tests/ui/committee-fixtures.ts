import { AGE_BUCKETS } from "@/domain/reports/age";
import { paymentCurve } from "@/domain/reports/payment-curve";
import { type TowerRow, towerRollup } from "@/domain/reports/towers";
import { type ReportComplaint, complaintMetrics } from "@/domain/reports/complaints";
import { defaultGoals, evaluateGoals } from "@/domain/reports/goals";
import { reconciliationLine } from "@/domain/reports/reconciliation";
import { monthlySeries, onTimeRateByPeriod } from "@/domain/reports/series";
import { monthlySla } from "@/domain/reports/monthly-sla";
import { weeklySla } from "@/domain/reports/weekly-sla";
import { buildCards } from "@/lib/reports/cards";
import { sectionHeadlines } from "@/lib/reports/headlines";
import type { CommitteeReport } from "@/server/reports/report-data";

export const NOW = Date.UTC(2026, 9, 27, 6, 30);

/**
 * The report with every block empty: no complaints, no imports, no data for the goals. Tests change the parts they look at; the cards, the headlines and the
 * series are worked out from the merged report unless the test gives its own.
 */
export function emptyReport(over: Partial<CommitteeReport> = {}): CommitteeReport {
  const base = {
    asOf: "2026-10-27",
    period: "2026-10-01",
    periods: ["2026-10-01"],
    money: null,
    lateFees: { postedPaidPaise: 0n, postedOwingPaise: 0n, accruingPaise: 0n },
    ageing: { buckets: [], total: { flats: 0, bills: 0, unpaidBillsPaise: 0n, lateFeesPaise: 0n, amountDuePaise: 0n } },
    towers: towerRollup([], "2026-10-27"),
    drilldown: null,
    quality: null,
    complaints: complaintMetrics([], NOW),
    reconciliation: reconciliationLine({ states: { QUEUED: 0, AUTO_MATCHED: 0, AWAITING_APPROVAL: 0, MANUALLY_MATCHED: 0, IGNORED: 0 }, imports: [], decisions: [] }),
    goals: { rows: evaluateGoals(defaultGoals, { onTime: { n: 0, d: 0 }, firstReply: { n: 0, d: 0 }, reopened: { n: 0, d: 0 } }), source: "SETTING" as const },
    safetyUnacknowledged: 0,
    slaMinutes: { CRITICAL: 15, HIGH: 120, NORMAL: 1440, LOW: 4320 },
    autoCloseDays: 7,
    canManageComplaints: false,
    ...over,
  };
  const onTime = onTimeRateByPeriod([], ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"], base.asOf);
  const weeks = weeklySla([], base.asOf, NOW);
  return {
    ...base,
    series: { monthly: monthlySeries([], onTime.map((p) => p.period), base.asOf), onTime, monthlySla: monthlySla([], onTime.map((p) => p.period), NOW), weeklySla: weeks, curve: null, ...over.series },
    cards: over.cards ?? buildCards({ money: base.money, ageing: base.ageing, onTime, sla: { months: monthlySla([], onTime.map((p) => p.period), NOW) }, goals: base.goals.rows, monthly: monthlySeries([], onTime.map((p) => p.period), base.asOf) }),
    headlines: over.headlines ?? sectionHeadlines(base),
  };
}

const minute = 60_000;
const T0 = Date.UTC(2026, 9, 5, 6, 30);
const complaint = (over: Partial<ReportComplaint> = {}): ReportComplaint => ({ createdAt: T0, safetyFlag: false, status: "ASSIGNED", closeKind: null, responseDueAt: T0 + 1440 * minute, firstResponseAt: null, reopenCount: 0, resolvedAt: null, acknowledgedAt: null, closedAt: null, ...over });

const towerRow = (n: number): TowerRow => ({ tower: `T${String(n).padStart(2, "0")}`, flats: 10 + n, bills: 12 + n, unpaidBillsPaise: BigInt(n) * 1_000_000n, lateFeesPaise: BigInt(n) * 10_000n, amountDuePaise: BigInt(n) * 1_010_000n, flatsOver90: n % 3 });

/**
 * A report that shows EVERY figure of every committee page: the money line, the quality of collection with the payment curve, the age groups with their towers, the
 * complaints (with safety ones, closed and open), the bank ledger with approvals waiting, default goals (so the targets line shows) and a weekly share to draw.
 * The text budget and the registry tests render the pages from it.
 */
export function richReport(over: Partial<CommitteeReport> = {}): CommitteeReport {
  const states = { QUEUED: 42, AUTO_MATCHED: 25, AWAITING_APPROVAL: 1, MANUALLY_MATCHED: 3, IGNORED: 35 };
  const week = (weekStart: string, share: number) => ({ weekStart, raised: 3, decided: 3, met: 2, sharePercent: share, partial: false });
  const base = emptyReport();
  const month = (period: string, byDay20Percent: number | null, inProgress = false) => ({ period, hasBills: byDay20Percent !== null, billedPaise: 1_000_000n, collectedPaise: 800_000n, outstandingPaise: 200_000n, collectedPercent: 80, byDay20Percent, byDay20Paise: 800_000n, inProgress });
  // The 1 to 30 days group holds exactly the month's Still unpaid (the same bills), as on the demo data, so the Dues expander has its reconciling line.
  const bucketRow = (bucket: (typeof AGE_BUCKETS)[number], bills: number, unpaid: bigint, fees: bigint) => ({ bucket, flats: bills, bills, unpaidBillsPaise: unpaid, lateFeesPaise: fees, amountDuePaise: unpaid + fees });
  const buckets = [bucketRow("NOT_YET_DUE", 4, 5_000_000n, 0n), bucketRow("DAYS_1_30", 484, 320_947_600n, 3_075_100n), bucketRow("DAYS_31_60", 5, 5_000_000n, 50_000n), bucketRow("DAYS_61_90", 5, 5_000_000n, 50_000n), bucketRow("OVER_90", 5, 5_000_000n, 50_000n)];
  const sum = (pick: (b: (typeof buckets)[number]) => bigint): bigint => buckets.reduce((a, b) => a + pick(b), 0n);
  const ageing = { buckets, total: { flats: 503, bills: 503, unpaidBillsPaise: sum((b) => b.unpaidBillsPaise), lateFeesPaise: sum((b) => b.lateFeesPaise), amountDuePaise: sum((b) => b.amountDuePaise) } };
  const complaints = complaintMetrics(
    [
      complaint({ firstResponseAt: T0 + 30 * minute, resolvedAt: T0 + 120 * minute, status: "CLOSED", closeKind: "CONFIRMED" }),
      complaint({ firstResponseAt: T0 + 90 * minute, resolvedAt: T0 + 600 * minute, reopenCount: 1, status: "CLOSED", closeKind: "AUTO_CLOSED" }),
      complaint({ firstResponseAt: T0 + 2000 * minute }),
      complaint({ safetyFlag: true, firstResponseAt: T0 + 5 * minute, acknowledgedAt: T0 + 5 * minute }),
      complaint({ safetyFlag: true }),
    ],
    NOW,
  );
  return emptyReport({
    periods: ["2026-10-01", "2026-09-01"],
    money: { billedPaise: 1_805_219_000n, collectedPaise: 1_484_271_400n, outstandingPaise: 320_947_600n, flatsBilled: 2399, flatsPaidInFull: 1915, flatsOutstanding: 484, fees: { postedPaidPaise: 380_000n, postedOwingPaise: 190_000n, accruingPaise: 12_345_600n } },
    lateFees: { postedPaidPaise: 380_000n, postedOwingPaise: 190_000n, accruingPaise: 12_345_600n },
    ageing,
    towers: { towers: Array.from({ length: 12 }, (_, i) => towerRow(12 - i)), total: { flats: 100, bills: 100, unpaidBillsPaise: 1n, lateFeesPaise: 0n, amountDuePaise: 1n, flatsOver90: 3 } },
    quality: { bills: 2399, due: 2399, dueOnTime: 1687, paidOnTime: 1687, paid: 1915, paidLate: 228, medianDaysToPay: 3 },
    complaints,
    reconciliation: reconciliationLine({ states, imports: [{ rowsRead: 106, stored: 106, invalidRows: 0, alreadyImported: 0 }], decisions: [{ decision: "MANUAL", importedAt: T0, decidedAt: T0 + 20 * minute }] }),
    goals: { ...base.goals, source: "DEFAULT" },
    safetyUnacknowledged: 1,
    series: {
      ...base.series,
      curve: paymentCurve({ bills: [{ amountPaise: 1_000_000n, payments: [{ date: "2026-10-03", amountPaise: 700_000n }] }], issueDate: "2026-10-01", dueDate: "2026-10-10", asOf: "2026-10-27" }),
      monthly: [month("2026-05-01", null), month("2026-06-01", null), month("2026-07-01", 80), month("2026-08-01", 84), month("2026-09-01", 93), month("2026-10-01", 83)],
      weeklySla: [week("2026-10-12", 67), week("2026-10-19", 80), week("2026-10-26", 75)],
    },
    ...over,
  });
}
