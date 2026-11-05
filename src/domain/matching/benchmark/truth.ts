/**
 * What a payment REALLY is, decided by the simulator when it made the row, before any narration noise.
 *
 * - PAYS_BILL: exactly the amount due on the OLDEST open bill of `flatCode`, as of the row's date.
 * - MULTI_BILL: the due of two or more open bills of `flatCode`.
 * - ADVANCE: more than the flat owes: money for months not yet billed.
 * - PARTIAL: less than the amount due on the oldest bill (a part, or the principal without the fee).
 * - NOT_MAINTENANCE: money that is not a maintenance payment (credit or debit).
 * - RETURN: a returned cheque.
 * - AMBIGUOUS_INTENT: a payment for the flat's bill that the amount or the order of events does not settle:
 *   a wrong amount, or a row dated before a payment already on the bill.
 */
export type TruthKind = "PAYS_BILL" | "MULTI_BILL" | "ADVANCE" | "PARTIAL" | "NOT_MAINTENANCE" | "RETURN" | "AMBIGUOUS_INTENT";

export type Truth = {
  kind: TruthKind;
  /** The flat the money belongs to (not the flat the payer lives in), or null when it belongs to none. */
  flatCode: string | null;
  billKeys: string[];
};

export type TruthRow = { rowNumber: number; truth: Truth };

export const TRUTH_KINDS: readonly TruthKind[] = ["PAYS_BILL", "MULTI_BILL", "ADVANCE", "PARTIAL", "NOT_MAINTENANCE", "RETURN", "AMBIGUOUS_INTENT"];
