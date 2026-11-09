import { AccountFooter } from "@/components/staff/account-footer";
import { t } from "@/lib/messages";
import { dateWords } from "@/lib/reports/period";
import type { CommitteeReport } from "@/server/reports/report-data";
import { AboutBlock } from "./about-block";
import { AlertStrip } from "./alert-strip";
import { HeadlineCards } from "./headline-cards";
import { LookCloser } from "./look-closer";
import { PeriodForm } from "./period-form";

/**
 * The overview of the committee report: the alert strip (only when a safety complaint is open and not yet seen), one h1, "As of <date> · read only", the month
 * selector (it applies when chosen), the four headline cards, "Look closer" (four rows, one per section page), and "About these numbers". Read only.
 */
export function ReportView({ report, account }: { report: CommitteeReport; account?: { name: string; permissions: readonly string[] } }) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:gap-6">
      <AlertStrip count={report.safetyUnacknowledged} canManageComplaints={report.canManageComplaints} />
      <header className="flex flex-col gap-2">
        <h1 className="text-heading font-semibold">{t("committee.title")}</h1>
        <p className="text-body text-ink-2">{t("committee.asOf", { date: dateWords(report.asOf) })}</p>
        <PeriodForm period={report.period} periods={report.periods} />
      </header>
      <HeadlineCards report={report} />
      <LookCloser report={report} period={report.period} />
      <AboutBlock asOf={report.asOf} />
      {account !== undefined && <AccountFooter name={account.name} permissions={account.permissions} identity />}
    </main>
  );
}
