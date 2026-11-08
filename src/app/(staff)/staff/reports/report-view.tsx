import { monthName } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { dateWords } from "@/lib/reports/period";
import { SECTION_IDS, type SectionId } from "@/lib/reports/sections";
import type { CommitteeReport } from "@/server/reports/report-data";
import { AboutBlock } from "./about-block";
import { AgeingBlock } from "./ageing-block";
import { AgeingDetail } from "./ageing-detail";
import { AlertStrip } from "./alert-strip";
import { ChooseSections } from "./choose-sections";
import { ComplaintsBlock } from "./complaints-block";
import { HeadlineCards } from "./headline-cards";
import { MoneyBlock } from "./money-block";
import { PeriodForm } from "./period-form";
import { QualityBlock } from "./quality-block";
import { ReconciliationBlock } from "./reconciliation-block";
import { ReportSection } from "./report-section";
import { ResponsiveDefaults } from "./responsive-defaults";

/** What a section says when the month has no bills: in words, with no zeros and no chart. */
function EmptyMonth() {
  return (
    <>
      <p className="text-body font-semibold">{t("committee.empty")}</p>
      <p className="text-body">{t("committee.empty.hint")}</p>
    </>
  );
}

/** The one short line under each section's title that says which period it covers (the month chosen, all months as of a date, or the last 30 days). */
const PERIODS: Record<SectionId, (report: CommitteeReport) => string> = {
  money: (r) => t("committee.card.period.bills", { month: monthName(r.period) }),
  owed: (r) => t("committee.card.period.owed", { date: dateWords(r.asOf) }),
  quality: (r) => t("committee.card.period.bills", { month: monthName(r.period) }),
  complaints: (r) => t("committee.card.period.complaints", { month: monthName(r.period) }),
  bank: () => t("committee.period.last30"),
};

const TITLES: Record<SectionId, () => string> = {
  money: () => t("committee.section.money"),
  owed: () => t("committee.section.owed"),
  quality: () => t("committee.section.quality"),
  complaints: () => t("committee.section.complaints"),
  bank: () => t("committee.section.bank"),
};

/**
 * The committee report: the alert strip (only when a safety complaint is open and not yet seen), one h1, "As of <date> · read only", the month selector (it applies
 * when chosen), the four headline cards, the five sections as collapsible <details> each with a one-sentence headline (the first two shown open from 768px; a section
 * the person hid on this device is left out of the HTML), then "Choose sections" and "About these numbers" at the bottom. Read
 * only: the controls are the month selector, the section toggles, Choose sections and the links of the ageing and the drill-down. A month with no bills says so in the
 * sections it affects and never draws zeros.
 */
export function ReportView({ report, hidden = [] }: { report: CommitteeReport; hidden?: readonly SectionId[] }) {
  const bodies: Record<SectionId, React.ReactNode> = {
    money: report.money === null ? <EmptyMonth /> : <MoneyBlock money={report.money} series={report.series.monthly} period={report.period} />,
    owed: (
      <>
        <AgeingBlock ageing={report.ageing} period={report.period} selected={report.drilldown?.bucket ?? null} />
        {report.drilldown !== null && <AgeingDetail page={report.drilldown} period={report.period} />}
      </>
    ),
    quality: report.quality === null ? <EmptyMonth /> : <QualityBlock quality={report.quality} curve={report.series.curve} goal={report.cards.onTime.goal} period={report.period} />,
    complaints: <ComplaintsBlock complaints={report.complaints} goals={report.goals.rows} slaGoal={report.cards.sla.goal} weeks={report.series.weeklySla} period={report.period} asOf={report.asOf} unseenAllMonths={report.safetyUnacknowledged} slaMinutes={report.slaMinutes} />,
    bank: <ReconciliationBlock line={report.reconciliation} />,
  };
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:gap-6">
      <AlertStrip count={report.safetyUnacknowledged} canManageComplaints={report.canManageComplaints} />
      <header className="flex flex-col gap-2">
        <h1 className="text-heading font-semibold">{t("committee.title")}</h1>
        <p className="text-body text-ink-2">{t("committee.asOf", { date: dateWords(report.asOf) })}</p>
        <PeriodForm period={report.period} periods={report.periods} />
      </header>
      <HeadlineCards report={report} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {SECTION_IDS.filter((id) => !hidden.includes(id)).map((id, index) => (
          <ReportSection key={id} id={id} title={TITLES[id]()} period={PERIODS[id](report)} headline={report.headlines[id]} defaultOpen={index < 2} forceOpen={id === "owed" && report.drilldown !== null}>
            {bodies[id]}
          </ReportSection>
        ))}
      </div>
      <ChooseSections hidden={hidden} />
      <AboutBlock asOf={report.asOf} />
      <ResponsiveDefaults />
    </main>
  );
}
