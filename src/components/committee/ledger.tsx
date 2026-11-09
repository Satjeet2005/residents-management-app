import type { ReactNode } from "react";
import { DoubleRule } from "@/components/ui/rules";
import { WarningIcon } from "@/components/icons";
import { cx } from "@/components/ui/cx";
import { t } from "@/lib/messages";

export type LedgerRow = { label: string; value: ReactNode; /** A line that needs attention is set in the caution colour with an icon, never colour alone. */ alert?: boolean };

function Row({ row, symbol, word, total }: { row: LedgerRow; symbol?: string; word?: string; total?: boolean }) {
  return (
    <div data-ledger-line="" className={cx("flex items-baseline justify-between gap-4 py-2", row.alert === true && "text-caution")}>
      <dt className="text-body font-semibold">
        {symbol !== undefined && (
          <span aria-hidden="true" className="mr-2 inline-block w-4">
            {symbol}
          </span>
        )}
        {word !== undefined && <span className="sr-only">{word} </span>}
        {row.alert === true && <WarningIcon size={20} />}
        {row.label}
      </dt>
      <dd className={cx("tnum shrink-0 whitespace-nowrap text-right", total === true ? "text-title font-semibold" : "text-body font-semibold")}>{row.value}</dd>
    </div>
  );
}

/**
 * A passbook ledger of parts that add up to a total (D208): the parts, a double rule, then the total. The operators are visible ("+", "=") and written for a
 * screen reader. It is ONE figure row of its block: `figure` holds the ids of every figure it shows, separated by spaces. The caller makes the parts add up to the
 * total (or adds an "Other" part for what is left); a test reads the rendered numbers back and checks the sum.
 */
export function Ledger({ figure, parts, total }: { figure: string; parts: readonly LedgerRow[]; total: LedgerRow }) {
  return (
    <dl data-figure={figure} data-ledger="" className="flex flex-col">
      {parts.map((row, index) => (
        <Row key={row.label} row={row} symbol={index === 0 ? undefined : "+"} word={index === 0 ? undefined : t("committee.ledger.plus")} />
      ))}
      <DoubleRule />
      <Row row={total} symbol="=" word={t("committee.ledger.equals")} total />
    </dl>
  );
}
