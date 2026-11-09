import { formatRupees } from "@/domain/money/money";
import type { MoneyLine } from "@/domain/reports/money-line";
import { t } from "@/lib/messages";

/** The three late-fee figures, on the Dues page: received (real money), charged but unpaid, and building up (a calculation, not money received). Nothing without a month's money line. */
export function LateFeeFigures({ money }: { money: MoneyLine | null }) {
  if (money === null) return null;
  return (
    <ul className="tnum flex list-none flex-col gap-1 p-0 text-body">
      <li>{t("committee.money.feesReceived", { x: formatRupees(money.fees.postedPaidPaise) })}</li>
      <li>{t("committee.money.feesOwing", { x: formatRupees(money.fees.postedOwingPaise) })}</li>
      <li>{t("committee.money.feesBuilding", { x: formatRupees(money.fees.accruingPaise) })}</li>
    </ul>
  );
}
