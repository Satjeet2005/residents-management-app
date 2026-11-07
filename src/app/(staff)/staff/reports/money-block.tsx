import { Money } from "@/components/ui/money";
import { DoubleRule } from "@/components/ui/rules";
import type { MoneyLine } from "@/domain/reports/money-line";
import { t } from "@/lib/messages";
import { periodLabel } from "@/lib/reports/period";
import type { CalendarDate } from "@/domain/time/calendar";

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
 * The money line of a month, ledger style: Billed, then Collected and Outstanding, which add up to it exactly, under a double rule; then the late fees on those
 * bills (posted and paid, posted and owing, accruing and not yet posted); then the flats. Money is the Money component (Indian grouping, tabular figures).
 */
export function MoneyBlock({ period, money }: { period: CalendarDate; money: MoneyLine }) {
  return (
    <section aria-labelledby="committee-money" className="flex flex-col gap-4">
      <h2 id="committee-money" className="text-title font-semibold">
        {t("committee.money.heading", { month: periodLabel(period) })}
      </h2>
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

      <h3 className="text-body font-semibold">{t("committee.fees.heading")}</h3>
      <dl className="flex flex-col border-t border-hairline">
        <Row label={t("committee.fees.paid")}>
          <Money amount={money.fees.postedPaidPaise} />
        </Row>
        <Row label={t("committee.fees.owing")}>
          <Money amount={money.fees.postedOwingPaise} />
        </Row>
        <Row label={t("committee.fees.accruing")} hint={t("committee.fees.accruing.hint")}>
          <Money amount={money.fees.accruingPaise} />
        </Row>
      </dl>

      <h3 className="text-body font-semibold">{t("committee.flats.heading")}</h3>
      <dl className="flex flex-col border-t border-hairline">
        <Row label={t("committee.flats.billed")}>
          <span className="tnum text-body font-semibold">{money.flatsBilled}</span>
        </Row>
        <Row label={t("committee.flats.paid")}>
          <span className="tnum text-body font-semibold">{money.flatsPaidInFull}</span>
        </Row>
        <Row label={t("committee.flats.outstanding")}>
          <span className="tnum text-body font-semibold">{money.flatsOutstanding}</span>
        </Row>
      </dl>
    </section>
  );
}
