import type { Paise } from "@/domain/money/money";
import { Money } from "./money";
import { DoubleRule } from "./rules";

/** The total of a ledger: label and amount, then a double rule under them. */
export function LedgerTotal({ label, amount }: { label: string; amount: Paise }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 py-2">
        <span className="text-body font-semibold">{label}</span>
        <Money amount={amount} size="large" />
      </div>
      <DoubleRule />
    </div>
  );
}
