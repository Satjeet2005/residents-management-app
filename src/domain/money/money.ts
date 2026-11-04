/** Integer paise: 100 paise = 1 rupee. Money is always a bigint, never a float. */
export type Paise = bigint;

const PAISE_PER_RUPEE = 100n;
const RUPEE_SIGN = "₹";

/** Wraps an integer as Paise. Fractions, NaN, Infinity and unsafe integers throw RangeError. */
export function paise(value: bigint | number): Paise {
  if (typeof value === "bigint") return value;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RangeError(`paise() needs an integer, got ${String(value)}`);
  }
  return BigInt(value);
}

const AMOUNT_PATTERN = /^₹?(\d+(?:,\d+)*)(?:\.(\d{1,2}))?$/;

/**
 * Parses a rupee amount typed by a person: an optional leading ₹, digits with
 * optional commas (Indian or Western; commas are ignored but must sit between
 * digits), and optionally "." followed by one or two decimals.
 * Outer whitespace is trimmed. Signs, letters and more than two decimals throw RangeError.
 */
export function parseRupees(text: string): Paise {
  const trimmed = text.trim();
  if (trimmed === "") throw new RangeError("Amount is empty");
  if (/^[+\-−]/.test(trimmed)) throw new RangeError(`Amount "${text}" must not have a sign`);
  if (/\.\d{3,}$/.test(trimmed)) throw new RangeError(`Amount "${text}" has more than 2 decimal places`);

  const match = AMOUNT_PATTERN.exec(trimmed);
  if (match === null) {
    throw new RangeError(`Amount "${text}" must be digits with an optional ₹, commas and up to 2 decimals`);
  }
  const rupees = BigInt(match[1].replaceAll(",", ""));
  const decimals = BigInt((match[2] ?? "").padEnd(2, "0"));
  return rupees * PAISE_PER_RUPEE + decimals;
}

/** Indian grouping: the last three digits, then groups of two (12,34,56,789). */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const groups = [digits.slice(-3)];
  let rest = digits.slice(0, -3);
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) groups.unshift(rest);
  return groups.join(",");
}

/** "₹6,370" for whole rupees, "₹98.43" otherwise (always two decimals), "-₹98" for negatives. */
export function formatRupees(amount: Paise): string {
  const negative = amount < 0n;
  const magnitude = negative ? -amount : amount;
  const rupees = magnitude / PAISE_PER_RUPEE;
  const remainder = magnitude % PAISE_PER_RUPEE;
  const decimals = remainder === 0n ? "" : `.${remainder.toString().padStart(2, "0")}`;
  return `${negative ? "-" : ""}${RUPEE_SIGN}${groupIndian(rupees.toString())}${decimals}`;
}

/**
 * Rounds to whole rupees, ties away from zero ("half up" on the magnitude), so
 * negatives mirror positives: 150n -> 200n and -150n -> -200n; 149n -> 100n and -149n -> -100n.
 */
export function roundPaiseToRupeesHalfUp(amount: Paise): Paise {
  const negative = amount < 0n;
  const magnitude = negative ? -amount : amount;
  const rounded = ((magnitude + PAISE_PER_RUPEE / 2n) / PAISE_PER_RUPEE) * PAISE_PER_RUPEE;
  return negative ? -rounded : rounded;
}

/** Whole-rupee display of an amount that is first rounded half up: 9843n -> "₹98". */
export function formatRupeesRounded(amount: Paise): string {
  return formatRupees(roundPaiseToRupeesHalfUp(amount));
}

export function sumPaise(amounts: readonly Paise[]): Paise {
  return amounts.reduce((total, amount) => total + amount, 0n);
}
