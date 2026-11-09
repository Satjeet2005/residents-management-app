import { GoalBar } from "@/components/charts/goal-bar";
import { Money } from "@/components/ui/money";
import { DoubleRule } from "@/components/ui/rules";
import { formatRupees } from "@/domain/money/money";
import type { MoneyLine } from "@/domain/reports/money-line";
import { percentOfPaise } from "@/domain/reports/stats";
import { t } from "@/lib/messages";
import { countText } from "@/lib/reports/cards";

/** One line of the ledger: the operator as a visible symbol and, for a screen reader, as a word ("plus", "equals"); the amount at the right in tabular figures. */
function Line({ symbol, word, label, children }: { symbol?: string; word?: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-body font-semibold">
        {symbol !== undefined && (
          <span aria-hidden="true" className="mr-2 inline-block w-4">
            {symbol}
          </span>
        )}
        {word !== undefined && <span className="sr-only">{word} </span>}
        {label}
      </dt>
      <dd className="tnum text-right">{children}</dd>
    </div>
  );
}

/**
 * "Billed and collected", a passbook ledger: Collected, plus Still unpaid, under a double rule, equals Billed (the first two add up to the third exactly); ONE bar of
 * the share collected; two one-line facts; and the three definitions behind one expander. No grey line under a figure, no equation in words.
 */
export function MoneyBlock({ money }: { money: MoneyLine }) {
  const percent = percentOfPaise(money.collectedPaise, money.billedPaise);
  return (
    <section aria-labelledby="committee-ledger" className="flex flex-col gap-3">
      <h2 id="committee-ledger" className="text-title font-semibold">
        {t("committee.section.money")}
      </h2>
      <dl className="flex flex-col">
        <Line label={t("committee.money.collected")}>
          <Money amount={money.collectedPaise} size="strong" />
        </Line>
        <Line symbol="+" word={t("committee.ledger.plus")} label={t("committee.money.unpaidShort")}>
          <Money amount={money.outstandingPaise} size="strong" />
        </Line>
        <DoubleRule />
        <Line symbol="=" word={t("committee.ledger.equals")} label={t("committee.money.billed")}>
          <Money amount={money.billedPaise} size="large" />
        </Line>
      </dl>
      <GoalBar value={percent} label={t("committee.ledger.bar", { n: percent ?? 0 })} />
      <p className="tnum text-body font-semibold">{percent === null ? t("committee.noData") : t("committee.ledger.collectedPercent", { n: percent })}</p>
      <ul className="tnum flex list-none flex-col gap-1 p-0 text-body">
        <li>{t("committee.money.feesReceived", { x: formatRupees(money.fees.postedPaidPaise) })}</li>
        <li>{t("committee.ledger.flatsPaid", { paid: countText(money.flatsPaidInFull), billed: countText(money.flatsBilled) })}</li>
      </ul>
      <details>
        <summary className="flex min-h-12 cursor-pointer items-center text-body font-semibold text-accent underline underline-offset-4">{t("committee.ledger.mean")}</summary>
        <ul className="flex list-none flex-col gap-1 p-0 text-body text-ink-2">
          <li>{t("committee.ledger.meanBilled")}</li>
          <li>{t("committee.ledger.meanCollected")}</li>
          <li>{t("committee.ledger.meanUnpaid")}</li>
        </ul>
      </details>
    </section>
  );
}
