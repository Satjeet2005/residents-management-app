import { type Paise, formatRupees } from "./money";

const LAKH = 10_000_000n; // ₹1 lakh in paise
const CRORE = 1_000_000_000n; // ₹1 crore in paise

/** `value` / `unit` as "i.dd" with `decimals` places, rounded half up on the exact integers (never through a float). */
function scaled(value: Paise, unit: Paise, decimals: 1 | 2): { text: string; carried: boolean } {
  const factor = decimals === 1 ? 10n : 100n;
  const units = (value * factor * 2n + unit) / (unit * 2n);
  const whole = units / factor;
  const fraction = (units % factor).toString().padStart(decimals, "0");
  return { text: `${whole}.${fraction}`, carried: units >= factor * 100n };
}

/**
 * A short rupee amount for cards, section headlines and chart labels ONLY (every detailed figure keeps the full Indian grouping of `formatRupees`).
 * Below ₹1 lakh it is the exact amount ("₹99,999"); from ₹1 lakh below ₹1 crore it is "₹60.6 lakh" (one decimal, half up); from ₹1 crore it is "₹1.49 crore"
 * (two decimals, half up). An amount that rounds up to 100.0 lakh is shown as "₹1.00 crore" so a figure never reads "100.0 lakh". Zero is "₹0"; a negative
 * amount has a leading minus.
 */
export function formatRupeesShort(amount: Paise): string {
  if (amount < 0n) return `-${formatRupeesShort(-amount)}`;
  if (amount < LAKH) return formatRupees(amount);
  if (amount < CRORE) {
    const lakh = scaled(amount, LAKH, 1);
    if (!lakh.carried) return `₹${lakh.text} lakh`;
  }
  return `₹${scaled(amount, CRORE, 2).text} crore`;
}
