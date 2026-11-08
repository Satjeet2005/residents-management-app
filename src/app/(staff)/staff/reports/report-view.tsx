import { t } from "@/lib/messages";
import { dateWords } from "@/lib/reports/period";
import type { CommitteeReport } from "@/server/reports/report-data";
import { AgeingBlock } from "./ageing-block";
import { AlertStrip } from "./alert-strip";
import { AgeingDetail } from "./ageing-detail";
import { ComplaintsBlock } from "./complaints-block";
import { GoalsBlock } from "./goals-block";
import { HeadlineCards } from "./headline-cards";
import { MoneyBlock } from "./money-block";
import { QualityBlock } from "./quality-block";
import { ReconciliationBlock } from "./reconciliation-block";
import { PeriodForm } from "./period-form";

/**
 * The committee report: one h1, the month selector and the "as of" date in words, then the blocks in a grid (two columns from 1024px, stacked below): the money
 * line, what is owed (with its drill-down), collection quality, complaints, the reconciliation line and the goals. Read only: there is no control on the page but
 * the selector's Show button, the links of the ageing and the drill-down's Load more, and none is filled. A month with no bills says so in words and draws no
 * money line (never zeros).
 */
export function ReportView({ report }: { report: CommitteeReport }) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 p-4">
      <AlertStrip count={report.safetyUnacknowledged} canManageComplaints={report.canManageComplaints} />
      <header className="flex flex-col gap-3">
        <h1 className="text-heading font-semibold">{t("committee.title")}</h1>
        <p className="text-body text-ink-2">{t("committee.asOf", { date: dateWords(report.asOf) })}</p>
        <PeriodForm period={report.period} periods={report.periods} />
      </header>
      <HeadlineCards report={report} />
      <div className="grid items-start gap-8 lg:grid-cols-2">
        {report.money === null ? (
          <section aria-labelledby="committee-empty" className="flex flex-col gap-2">
            <h2 id="committee-empty" className="text-title font-semibold">
              {t("committee.empty")}
            </h2>
            <p className="text-body">{t("committee.empty.hint")}</p>
          </section>
        ) : (
          <MoneyBlock period={report.period} money={report.money} />
        )}
        <div className="flex min-w-0 flex-col gap-8">
          <AgeingBlock ageing={report.ageing} period={report.period} selected={report.drilldown?.bucket ?? null} />
          {report.drilldown !== null && <AgeingDetail page={report.drilldown} period={report.period} />}
        </div>
        {report.quality !== null && <QualityBlock period={report.period} quality={report.quality} />}
        <ComplaintsBlock period={report.period} complaints={report.complaints} />
        <ReconciliationBlock line={report.reconciliation} />
        <GoalsBlock goals={report.goals} />
      </div>
    </main>
  );
}
