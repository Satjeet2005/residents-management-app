import Link from "next/link";
import { Definitions } from "@/components/committee/definitions";
import { ArrowLeftIcon } from "@/components/icons";
import { cx } from "@/components/ui/cx";
import { t } from "@/lib/messages";
import { definitionLinesFor } from "@/lib/reports/figures";
import { dateWords, periodLabel } from "@/lib/reports/period";
import { SECTIONS, type SectionSlug, overviewHref, sectionHref } from "@/lib/reports/sections";
import type { CommitteeReport } from "@/server/reports/report-data";
import { AgeBlock, TotalBlock } from "./ageing-block";
import { AlertStrip } from "./alert-strip";
import { ArrivalHeading } from "./arrival-heading";
import { ComplaintsBlock } from "./complaints-block";
import { LateFeeFigures } from "./late-fee-figures";
import { MoneyBlock } from "./money-block";
import { MonthlyBlock } from "./monthly-block";
import { PeriodForm } from "./period-form";
import { QualityBlock } from "./quality-block";
import { ReconciliationBlock } from "./reconciliation-block";
import { TowersBlock } from "./towers-block";

/** What a section says when the month has no bills: in words, with no zeros and no chart. */
function EmptyMonth() {
  return (
    <>
      <p className="text-body font-semibold">{t("committee.empty")}</p>
      <p className="text-body">{t("committee.empty.hint")}</p>
    </>
  );
}

/** The h1 of a section page: the section and the period it covers ("Collections, October 2026"; "Dues, all months, as of 27 October 2026"). */
function titleOf(slug: SectionSlug, report: CommitteeReport): string {
  const period = periodLabel(report.period);
  if (slug === "collections") return t("committee.page.collections", { period });
  if (slug === "dues") return t("committee.page.dues");
  if (slug === "complaints") return t("committee.page.complaints", { period });
  return t("committee.page.bank");
}

const BACK = "inline-flex min-h-12 items-center gap-2 self-start text-body font-semibold text-accent underline underline-offset-4";

/** The four sections of the left-hand list (from 1024px) and the overview, the current page marked `aria-current`. */
function SectionList({ current, report }: { current: SectionSlug; report: CommitteeReport }) {
  const names: Record<SectionSlug, string> = { collections: t("committee.look.collections"), dues: t("committee.look.dues"), complaints: t("committee.look.complaints"), bank: t("committee.look.bank") };
  const link = "flex min-h-12 items-center rounded-control px-3 text-body";
  return (
    <nav aria-label={t("committee.list.label")} className="hidden lg:block lg:w-56 lg:shrink-0">
      <ul className="flex list-none flex-col gap-2 p-0">
        <li>
          <Link href={overviewHref(report.period)} className={cx(link, "border border-hairline")}>
            {t("committee.list.overview")}
          </Link>
        </li>
        {SECTIONS.map((s) => (
          <li key={s.slug}>
            <Link href={sectionHref(s.slug, report.period)} aria-current={s.slug === current ? "page" : undefined} className={cx(link, s.slug === current ? "border-2 border-ink bg-paper-2 font-semibold" : "border border-hairline")}>
              {names[s.slug]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The content of each page, from the existing blocks. Collections: the Billed and collected ledger, how fast bills are paid, the monthly visual. */
function Content({ slug, report }: { slug: SectionSlug; report: CommitteeReport }) {
  if (slug === "collections") {
    return (
      <>
        {report.money === null ? <EmptyMonth /> : <MoneyBlock money={report.money} />}
        {report.quality !== null && (
          <section data-block="" aria-labelledby="committee-fast" className="flex flex-col gap-4">
            <h2 id="committee-fast" className="text-title font-semibold">
              {t("committee.section.quality")}
            </h2>
            <QualityBlock quality={report.quality} curve={report.series.curve} goal={report.cards.onTime.goal} period={report.period} />
          </section>
        )}
        {report.money !== null && <MonthlyBlock series={report.series.monthly} />}
      </>
    );
  }
  if (slug === "dues") {
    return (
      <section aria-label={t("committee.look.dues")} className="flex flex-col gap-6">
        <TotalBlock ageing={report.ageing} />
        <AgeBlock ageing={report.ageing} />
        <LateFeeFigures fees={report.lateFees} />
        <TowersBlock rollup={report.towers} />
      </section>
    );
  }
  if (slug === "complaints") {
    return <ComplaintsBlock complaints={report.complaints} goals={report.goals.rows} slaGoal={report.cards.sla.goal} weeks={report.series.weeklySla} period={report.period} asOf={report.asOf} unseenAllMonths={report.safetyUnacknowledged} slaMinutes={report.slaMinutes} />;
  }
  return <ReconciliationBlock line={report.reconciliation} />;
}

/**
 * A section page of the committee report: the back link, one h1 with the period, the month selector where a month applies, the content of the section, and from
 * 1024px the list of the other pages at the left. Read only.
 */
export function SectionPage({ slug, report }: { slug: SectionSlug; report: CommitteeReport }) {
  const monthly = SECTIONS.find((s) => s.slug === slug)?.monthly === true;
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:gap-6">
      <AlertStrip count={report.safetyUnacknowledged} canManageComplaints={report.canManageComplaints} />
      <Link href={overviewHref(report.period)} aria-label={t("committee.back.label")} className={BACK}>
        <ArrowLeftIcon size={20} />
        {t("committee.back")}
      </Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
        <SectionList current={slug} report={report} />
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <header className="flex flex-col gap-2">
            <ArrivalHeading>{titleOf(slug, report)}</ArrivalHeading>
            <p className="text-body text-ink-2">{t("committee.asOfShort", { date: dateWords(report.asOf) })}</p>
            {monthly && <PeriodForm period={report.period} periods={report.periods} base={`/staff/reports/${slug}`} />}
          </header>
          <Content slug={slug} report={report} />
          <Definitions lines={definitionLinesFor(slug, report)} />
        </div>
      </div>
    </main>
  );
}

