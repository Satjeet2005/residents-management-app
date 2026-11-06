import type { Paise } from "../money/money";
import type { CalendarDate } from "../time/calendar";
import { type LateFeeHold, type LateFeePayment, type LateFeePolicy, computeLateFee } from "./late-fee";

export type PostedFee = { date: CalendarDate; amountPaise: Paise };

/** A bill-linked ADJUSTMENT entry. CHARGE adds to what is owed, PAYMENT takes from it. */
export type BillAdjustment = { date: CalendarDate; direction: "CHARGE" | "PAYMENT"; amountPaise: Paise };

export type BillPositionInput = {
  billAmountPaise: Paise;
  dueOn: CalendarDate;
  asOf: CalendarDate;
  /** Live PAYMENT entries on this bill (reversed ones already removed), in any order. */
  payments: readonly LateFeePayment[];
  /** LATE_FEE charges posted on this bill. */
  postedFees: readonly PostedFee[];
  adjustments: readonly BillAdjustment[];
  holds: readonly LateFeeHold[];
  policy: LateFeePolicy;
};

export type PositionKind = "SETTLED" | "PRINCIPAL_OPEN" | "FEE_ONLY";

/** Something in the ledger that the model does not expect. It is flagged, never hidden (D107). */
export type PositionAnomaly = "FEE_POSTED_ON_OPEN_BILL" | "FEE_NOT_POSTED";

export type BillPosition = {
  kind: PositionKind;
  /** The date the position was worked out for; planPosting refuses a position of another date. */
  asOf: CalendarDate;
  principalOutstandingPaise: Paise;
  /** The late fee computeLateFee gives as of `asOf`. */
  feeComputedPaise: Paise;
  /** The part of the fee still owed: the computed fee (adjusted) while the principal is open, else what remains of the posted fee. */
  feeOutstandingPaise: Paise;
  /** principalOutstandingPaise + feeOutstandingPaise. Never negative. */
  amountDuePaise: Paise;
  /** The date the payments reached the bill amount, or null while the principal is open. */
  settledOn: CalendarDate | null;
  anomalies: PositionAnomaly[];
};

const sum = (amounts: readonly Paise[]): Paise => amounts.reduce((total, amount) => total + amount, 0n);
const atLeastZero = (amount: Paise): Paise => (amount > 0n ? amount : 0n);

/** The first date on which payments dated up to and including it add up to the bill. Null if they never do. */
function dateOfSettling(billAmountPaise: Paise, payments: readonly LateFeePayment[]): CalendarDate | null {
  let paid = 0n;
  const sorted = [...payments].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (let i = 0; i < sorted.length; i++) {
    paid += sorted[i].amountPaise;
    const lastOfDay = i === sorted.length - 1 || sorted[i + 1].date !== sorted[i].date;
    if (lastOfDay && paid >= billAmountPaise) return sorted[i].date;
  }
  return null;
}

/**
 * What one bill is, as of a date (D107, D110). The principal outstanding O is the bill minus the payments dated up to `asOf`.
 * - O above zero: PRINCIPAL_OPEN. The fee is the computed fee (computeLateFee, so holds and payment dates count), amount due is
 *   O plus the fee. A LATE_FEE posted on such a bill is an anomaly and is not trusted.
 * - O zero: the fee owed is the posted fee plus adjustments, minus whatever was paid beyond the bill (the excess). Above zero it
 *   is FEE_ONLY and amount due is that remainder; otherwise SETTLED. If the principal is settled with no fee posted but the
 *   fee at the settling date is above zero, that fee is owed and the anomaly FEE_NOT_POSTED says so: money does not vanish.
 * Adjustments move the fee side only. Everything is bigint, the result does not depend on the order of the inputs, and nothing
 * dated after `asOf` counts.
 */
export function billPosition(input: BillPositionInput): BillPosition {
  const { billAmountPaise, asOf, policy } = input;
  const payments = input.payments.filter((p) => p.date <= asOf);
  const postedFees = input.postedFees.filter((f) => f.date <= asOf);
  const adjustment = sum(input.adjustments.filter((a) => a.date <= asOf).map((a) => (a.direction === "CHARGE" ? a.amountPaise : -a.amountPaise)));

  const fee = computeLateFee({ billAmountPaise, dueOn: input.dueOn, asOf, payments, holds: input.holds, policy });
  const principalOutstandingPaise = fee.outstandingPaise;
  const anomalies: PositionAnomaly[] = [];

  if (principalOutstandingPaise > 0n) {
    if (postedFees.length > 0) anomalies.push("FEE_POSTED_ON_OPEN_BILL");
    const feeOutstandingPaise = atLeastZero(fee.feePaise + adjustment);
    return {
      kind: "PRINCIPAL_OPEN",
      asOf,
      principalOutstandingPaise,
      feeComputedPaise: fee.feePaise,
      feeOutstandingPaise,
      amountDuePaise: principalOutstandingPaise + feeOutstandingPaise,
      settledOn: null,
      anomalies,
    };
  }

  const excessPaise = sum(payments.map((p) => p.amountPaise)) - billAmountPaise;
  const posted = sum(postedFees.map((f) => f.amountPaise));
  if (posted === 0n && fee.feePaise > 0n) anomalies.push("FEE_NOT_POSTED");
  const accruedPaise = posted === 0n ? fee.feePaise : posted;
  const feeOutstandingPaise = atLeastZero(accruedPaise + adjustment - excessPaise);
  return {
    kind: feeOutstandingPaise > 0n ? "FEE_ONLY" : "SETTLED",
    asOf,
    principalOutstandingPaise: 0n,
    feeComputedPaise: fee.feePaise,
    feeOutstandingPaise,
    amountDuePaise: feeOutstandingPaise,
    settledOn: dateOfSettling(billAmountPaise, payments),
    anomalies,
  };
}
