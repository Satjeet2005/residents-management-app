import { t } from "@/lib/messages";
import { dateWords } from "@/lib/reports/period";
import type { CommitteeReport } from "@/server/reports/report-data";
import { AgeingBlock } from "./ageing-block";
import { AgeingDetail } from "./ageing-detail";
import { MoneyBlock } from "./money-block";
import { PeriodForm } from "./period-form";

/**
 * The committee report: one h1, the month selector and the "as of" date in words, then the blocks. Read only: there is no control on the page but the selector's
 * Show button, which is outlined. A month with no bills says so in words and draws no money line (never zeros).
 */
export function ReportView({ report }: { report: CommitteeReport }) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 p-4">
      <header className="flex flex-col gap-3">
        <h1 className="text-heading font-semibold">{t("committee.title")}</h1>
        <p className="text-body text-ink-2">{t("committee.asOf", { date: dateWords(report.asOf) })}</p>
        <PeriodForm period={report.period} periods={report.periods} />
      </header>
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
      <AgeingBlock ageing={report.ageing} period={report.period} selected={report.drilldown?.bucket ?? null} />
      {report.drilldown !== null && <AgeingDetail page={report.drilldown} period={report.period} />}
    </main>
  );
}
