import { HorizontalBars } from "@/components/charts/horizontal-bars";
import { StackedBars } from "@/components/charts/stacked-bars";
import { Money } from "@/components/ui/money";
import { DoubleRule } from "@/components/ui/rules";
import { formatRupees } from "@/domain/money/money";
import type { MoneyLine } from "@/domain/reports/money-line";
import type { MonthlyPoint } from "@/domain/reports/series";
import { t } from "@/lib/messages";
import { flatsText } from "@/lib/reports/cards";
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
export function MoneyBlock({ money, series }: { money: MoneyLine; series: readonly MonthlyPoint[] }) {
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
        <Row label={t("committee.money.outstanding")} hint={t("committee.money.outstanding.hint")}>
          <Money amount={money.outstandingPaise} size="strong" />
        </Row>
      </dl>
      <DoubleRule />
      <p className="text-caption text-ink-2">{t("committee.money.equation")}</p>
      <p className="tnum text-body">
        {t("committee.money.fees", { paid: formatRupees(money.fees.postedPaidPaise), owing: formatRupees(money.fees.postedOwingPaise), accruing: formatRupees(money.fees.accruingPaise) })}
      </p>
      <p className="tnum text-body">{t("committee.money.flats", { billed: flatsText(money.flatsBilled), paid: money.flatsPaidInFull, owing: money.flatsOutstanding })}</p>
      <div className="md:hidden">
        <HorizontalBars text={{ ...visual.text, id: "monthly-bars" }} rows={visual.rows} scaleMax={100} />
      </div>
      <div className="hidden md:block">
        <StackedBars text={{ ...visual.text, id: "monthly-columns" }} columns={visual.columns} labels={visual.labels} />
      </div>
    </>
  );
}
