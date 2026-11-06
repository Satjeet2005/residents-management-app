import type { StatementRow } from "./csv";
import { normalizeName } from "./names";
import { parseNarration, type ParsedNarration } from "./narration";

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

/** Date, then row number: the order rows are processed in, whatever order they arrive in. */
export const byDateThenRow = (a: Pick<StatementRow, "txnDate" | "rowNumber">, b: Pick<StatementRow, "txnDate" | "rowNumber">): number =>
  a.txnDate === b.txnDate ? a.rowNumber - b.rowNumber : a.txnDate < b.txnDate ? -1 : 1;

/**
 * The dedupe key of every row of a statement, by row number, worked out the way `processStatement` works it out: rows are taken
 * by date then row number, and a row with no reference is occurrence 1, 2, 3 ... of its base key within the file, so two identical
 * cash deposits get two keys. A row with a reference has the same key whichever occurrence it is. Pure; the rows are not changed.
 * The server uses it to ask the database which of a file's rows an earlier import already took in, before the processor runs.
 */
export function computeRowKeys(rows: readonly StatementRow[]): Map<number, string> {
  const occurrences = new Map<string, number>();
  const keys = new Map<number, string>();
  for (const row of [...rows].sort(byDateThenRow)) {
    const parsed = parseNarration(row.narrationRaw);
    const base = rowDedupeKey(row, parsed, 1);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    keys.set(row.rowNumber, occurrence === 1 ? base : rowDedupeKey(row, parsed, occurrence));
  }
  return keys;
}
