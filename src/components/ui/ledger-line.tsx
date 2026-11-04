import type { ReactNode } from "react";
import type { Paise } from "@/domain/money/money";
import { Money } from "./money";

/**
 * One line of a ledger: date, particulars (they wrap), amount right-aligned.
 * Renders an <li>, so put lines inside a <ul>.
 */
export function LedgerLine({ date, particulars, amount }: { date: ReactNode; particulars: ReactNode; amount: Paise }) {
  return (
    <li className="grid grid-cols-[4.5rem_1fr_auto] items-baseline gap-x-3 py-2 text-body">
      <span className="tnum text-caption text-ink-2">{date}</span>
      <span className="min-w-0 break-words">{particulars}</span>
      <span className="text-right">
        <Money amount={amount} />
      </span>
    </li>
  );
}
