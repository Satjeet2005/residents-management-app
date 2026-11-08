import { HorizontalBars } from "@/components/charts/horizontal-bars";
import { StackedBars } from "@/components/charts/stacked-bars";
import { Money } from "@/components/ui/money";
import { DoubleRule } from "@/components/ui/rules";
import { formatRupees } from "@/domain/money/money";
import type { MoneyLine } from "@/domain/reports/money-line";
import type { MonthlyPoint } from "@/domain/reports/series";
import type { CalendarDate } from "@/domain/time/calendar";
import { monthName } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { countText, flatsText } from "@/lib/reports/cards";
import { monthlyVisual } from "@/lib/reports/visuals";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="flex min-w-0 flex-col">
        <span className="text-body font-semibold">{label}</span>
        {hint !== undefined && <span className="text-caption text-ink-2">{hint}</span>}
      </dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/**
 * The money section of a month, ledger style: Billed, then Collected and Outstanding, which add up to it exactly, under a double rule; two sentences (late fees,
 * flats); then the monthly collection as bars below 768px and as columns from 768px (the same data and the same table, only one of them shown at a time).
 */
export function MoneyBlock({ money, series, period }: { money: MoneyLine; series: readonly MonthlyPoint[]; period: CalendarDate }) {
  const visual = monthlyVisual(series);
  return (
    <>
      <dl className="flex flex-col">
        <Row label={t("committee.money.billed")}>
          <Money amount={money.billedPaise} size="large" />
        </Row>
        <Row label={t("committee.money.collected")} hint={t("committee.money.collected.hint")}>
          <Money amount={money.collectedPaise} size="strong" />
        </Row>
        <Row label={t("committee.money.unpaid", { month: monthName(period) })} hint={t("committee.money.unpaid.hint")}>
          <Money amount={money.outstandingPaise} size="strong" />
        </Row>
      </dl>
      <DoubleRule />
      <p className="text-caption text-ink-2">{t("committee.money.equation")}</p>
      <ul className="tnum flex flex-col gap-1 text-body">
        <li>{t("committee.money.feesReceived", { x: formatRupees(money.fees.postedPaidPaise) })}</li>
        <li>{t("committee.money.feesOwing", { x: formatRupees(money.fees.postedOwingPaise) })}</li>
        <li>{t("committee.money.feesBuilding", { x: formatRupees(money.fees.accruingPaise) })}</li>
      </ul>
      <p className="tnum text-body">{t("committee.money.flats", { billed: flatsText(money.flatsBilled), paid: countText(money.flatsPaidInFull), owing: countText(money.flatsOutstanding) })}</p>
      <div className="md:hidden">
        <HorizontalBars text={{ ...visual.phoneText, id: "monthly-bars" }} rows={visual.rows} scaleMax={100} />
      </div>
      <div className="hidden md:block">
        <StackedBars text={{ ...visual.text, id: "monthly-columns" }} columns={visual.columns} labels={visual.labels} />
      </div>
      <ul className="flex flex-col gap-1 text-body text-ink-2">
        {visual.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </>
  );
}
