import { GoalBar } from "@/components/charts/goal-bar";
import { Ledger } from "@/components/committee/ledger";
import { Support } from "@/components/committee/support";
import { Money } from "@/components/ui/money";
import { formatRupees } from "@/domain/money/money";
import type { MoneyLine } from "@/domain/reports/money-line";
import { percentOfPaise } from "@/domain/reports/stats";
import { t } from "@/lib/messages";
import { countText } from "@/lib/reports/cards";

/**
 * "Billed and collected", a passbook ledger: Collected, plus Still unpaid, under a double rule, equals Billed (the first two add up to the third exactly); ONE bar of
 * the share collected; two one-line facts. The definitions are in the page's one expander. No grey line under a figure, no equation in words.
 */
export function MoneyBlock({ money }: { money: MoneyLine }) {
  const percent = percentOfPaise(money.collectedPaise, money.billedPaise);
  return (
    <section data-block="" aria-labelledby="committee-ledger" className="flex flex-col gap-3">
      <h2 id="committee-ledger" className="text-title font-semibold">
        {t("committee.section.money")}
      </h2>
      <Ledger
        figure="billed collected unpaid"
        parts={[
          { label: t("committee.money.collected"), value: <Money amount={money.collectedPaise} size="strong" /> },
          { label: t("committee.money.unpaidShort"), value: <Money amount={money.outstandingPaise} size="strong" /> },
        ]}
        total={{ label: t("committee.money.billed"), value: <Money amount={money.billedPaise} size="large" /> }}
      />
      <GoalBar value={percent} label={t("committee.ledger.bar", { n: percent ?? 0 })} />
      <p className="tnum text-body font-semibold">{percent === null ? t("committee.noData") : t("committee.ledger.collectedPercent", { n: percent })}</p>
      <ul className="tnum flex list-none flex-col gap-1 p-0">
        <Support as="li" figure="lateFeesReceived">{t("committee.money.feesReceived", { x: formatRupees(money.fees.postedPaidPaise) })}</Support>
        <Support as="li">{t("committee.ledger.flatsPaid", { paid: countText(money.flatsPaidInFull), billed: countText(money.flatsBilled) })}</Support>
      </ul>
    </section>
  );
}
