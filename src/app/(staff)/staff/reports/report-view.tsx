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

const TITLES: Record<SectionId, () => string> = {
  money: () => t("committee.section.money"),
  owed: () => t("committee.section.owed"),
  quality: () => t("committee.section.quality"),
  complaints: () => t("committee.section.complaints"),
  bank: () => t("committee.section.bank"),
};

/**
 * The committee report: the alert strip (only when a safety complaint waits), one h1, the month selector and the "as of" date in words, the four headline cards,
 * the five sections as collapsible <details> each with a one-sentence headline (the first two shown open from 768px; a section the person hid on this device is
 * left out of the HTML), and "About these numbers" at the bottom. Read
 * only: the controls are the selector's Show button, the section toggles and the links of the ageing and the drill-down. A month with no bills says so in the
 * sections it affects and never draws zeros.
 */
export function ReportView({ report, hidden = [] }: { report: CommitteeReport; hidden?: readonly SectionId[] }) {
  const bodies: Record<SectionId, React.ReactNode> = {
    money: report.money === null ? <EmptyMonth /> : <MoneyBlock money={report.money} series={report.series.monthly} />,
    owed: (
      <>
        <AgeingBlock ageing={report.ageing} period={report.period} selected={report.drilldown?.bucket ?? null} />
        {report.drilldown !== null && <AgeingDetail page={report.drilldown} period={report.period} />}
      </>
    ),
    quality: report.quality === null ? <EmptyMonth /> : <QualityBlock quality={report.quality} curve={report.series.curve} goal={report.cards.onTime.goal} />,
    complaints: <ComplaintsBlock complaints={report.complaints} goals={report.goals.rows} slaGoal={report.cards.sla.goal} weeks={report.series.weeklySla} period={report.period} unseenAllMonths={report.safetyUnacknowledged} />,
    bank: <ReconciliationBlock line={report.reconciliation} />,
  };
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4">
      <AlertStrip count={report.safetyUnacknowledged} canManageComplaints={report.canManageComplaints} />
      <header className="flex flex-col gap-3">
        <h1 className="text-heading font-semibold">{t("committee.title")}</h1>
        <p className="text-body text-ink-2">{t("committee.asOf", { date: dateWords(report.asOf) })}</p>
        <PeriodForm period={report.period} periods={report.periods} />
        <ChooseSections hidden={hidden} />
      </header>
      <HeadlineCards report={report} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {SECTION_IDS.filter((id) => !hidden.includes(id)).map((id, index) => (
          <ReportSection key={id} id={id} title={TITLES[id]()} headline={report.headlines[id]} defaultOpen={index < 2} forceOpen={id === "owed" && report.drilldown !== null}>
            {bodies[id]}
          </ReportSection>
        ))}
      </div>
      <AboutBlock asOf={report.asOf} goalsAreDefaults={report.goals.source === "DEFAULT"} />
      <ResponsiveDefaults />
    </main>
  );
}
