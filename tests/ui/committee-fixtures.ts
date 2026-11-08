import { complaintMetrics } from "@/domain/reports/complaints";
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
    ageing: { buckets: [], total: { flats: 0, bills: 0, amountDuePaise: 0n } },
    drilldown: null,
    quality: null,
    complaints: complaintMetrics([], NOW),
    reconciliation: reconciliationLine({ states: { QUEUED: 0, AUTO_MATCHED: 0, AWAITING_APPROVAL: 0, MANUALLY_MATCHED: 0, IGNORED: 0 }, imports: [], decisions: [] }),
    goals: { rows: evaluateGoals(defaultGoals, { onTime: { n: 0, d: 0 }, firstReply: { n: 0, d: 0 }, reopened: { n: 0, d: 0 } }), source: "SETTING" as const },
    safetyUnacknowledged: 0,
    canManageComplaints: false,
    ...over,
  };
  const onTime = onTimeRateByPeriod([], ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"], base.asOf);
  const weeks = weeklySla([], base.asOf, NOW);
  return {
    ...base,
    series: { monthly: monthlySeries([], onTime.map((p) => p.period), base.asOf), onTime, monthlySla: monthlySla([], onTime.map((p) => p.period), NOW), weeklySla: weeks, curve: null, ...over.series },
    cards: over.cards ?? buildCards({ money: base.money, ageing: base.ageing, onTime, sla: { months: monthlySla([], onTime.map((p) => p.period), NOW) }, goals: base.goals.rows }),
    headlines: over.headlines ?? sectionHeadlines(base),
  };
}
