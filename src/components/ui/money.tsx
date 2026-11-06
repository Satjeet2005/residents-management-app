import { type Paise, formatRupees } from "@/domain/money/money";
import { cx } from "./cx";

export type MoneySize = "hero" | "large" | "strong" | "body";

const SIZES: Record<MoneySize, string> = {
  hero: "text-hero font-semibold",
  large: "text-heading font-semibold",
  strong: "text-body font-semibold",
  body: "text-body",
};

/** An amount in rupees with Indian grouping and tabular numerals; takes integer paise. */
export function Money({ amount, size = "body" }: { amount: Paise; size?: MoneySize }) {
  return <span className={cx("tnum", SIZES[size])}>{formatRupees(amount)}</span>;
}
