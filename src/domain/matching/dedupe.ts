import type { StatementRow } from "./csv";
import { normalizeName } from "./names";
import type { ParsedNarration } from "./narration";

const MAX_NARRATION_CHARS = 80;

/**
 * A deterministic key for a statement row, so that uploading the same row twice
 * (an overlapping statement, a re-upload) is recognised. It is a readable string,
 * not a hash, and is under 200 characters.
 *
 * - A row whose narration has a reference is keyed by rail, reference and the two
 *   amounts, so the same UPI or NEFT payment is the same row even if the bank
 *   spelled the narration differently. The amounts are in the key because cheque
 *   numbers are only unique within one bank, so two different cheques can share one.
 * - Any other row is keyed by date, amounts, the first 80 characters of the
 *   normalised narration, the balance (or "nobal") and `occurrence`: 1 for the first
 *   such row in a file, 2 for the second identical one, and so on. Two identical
 *   cash deposits in one file are two payments, so they must get two keys.
 */
export function rowDedupeKey(
  row: Pick<StatementRow, "txnDate" | "creditPaise" | "debitPaise" | "balancePaise" | "narrationRaw">,
  parsed: Pick<ParsedNarration, "rail" | "reference">,
  occurrence: number,
): string {
  if (!Number.isInteger(occurrence) || occurrence < 1) throw new RangeError(`occurrence must be a whole number from 1, got ${String(occurrence)}`);
  if (parsed.reference !== null) return `ref|${parsed.rail}|${parsed.reference}|${row.creditPaise}|${row.debitPaise}`;
  const narration = normalizeName(row.narrationRaw).slice(0, MAX_NARRATION_CHARS);
  const balance = row.balancePaise === null ? "nobal" : String(row.balancePaise);
  return `row|${row.txnDate}|${row.creditPaise}|${row.debitPaise}|${narration}|${balance}|${occurrence}`;
}
