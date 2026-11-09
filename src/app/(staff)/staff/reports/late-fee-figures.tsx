import { formatRupees } from "@/domain/money/money";
import type { MoneyLine } from "@/domain/reports/money-line";
import { t } from "@/lib/messages";

/**
 * "Late fees" on the Dues page, for ALL months (D215): Received (real money), Charged, not yet paid, and Building up, not yet charged (a calculation, not money
 * received). Three rows, a label at the left and the amount at the right; no sub-line and no parenthesis (the expander defines them). `fees` is the sum over the
 * open and the settled bills of every month, so a month chosen elsewhere does not change it. Nothing without a money line.
 */
export function LateFeeFigures({ fees }: { fees: MoneyLine["fees"] }) {
  const rows = [
    { id: "duesReceived", label: t("committee.fees.received"), amount: fees.postedPaidPaise },
    { id: "duesCharged", label: t("committee.fees.charged"), amount: fees.postedOwingPaise },
    { id: "duesBuilding", label: t("committee.fees.building"), amount: fees.accruingPaise },
  ];
  return (
    <section data-block="" aria-labelledby="committee-fees" className="flex flex-col gap-1">
      <h2 id="committee-fees" className="text-title font-semibold">
        {t("committee.fees.heading")}
      </h2>
      <dl className="flex flex-col">
        {rows.map((row) => (
          <div key={row.id} data-figure={row.id} className="flex items-baseline justify-between gap-4 py-2">
            <dt className="text-body">{row.label}</dt>
            <dd className="tnum shrink-0 whitespace-nowrap text-right text-body font-semibold">{formatRupees(row.amount)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
