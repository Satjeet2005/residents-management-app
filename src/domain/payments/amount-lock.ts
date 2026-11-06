import { type DueBill, type DueEntry, positionsForFlat } from "../billing/dues";
import type { LateFeePolicy } from "../billing/late-fee";
import type { PositionKind } from "../billing/position";
import type { Paise } from "../money/money";
import type { CalendarDate } from "../time/calendar";

export type LockedAmount = {
  billId: string;
  /** PRINCIPAL_OPEN: principal and fee. FEE_ONLY: the principal is paid and only the late fee is locked (D107). */
  kind: Exclude<PositionKind, "SETTLED">;
  /** Principal still unpaid on that bill on `asOf`; zero when only the fee is owed. */
  principalPaise: Paise;
  feePaise: Paise;
  /** principal plus fee: the amount the person pays. */
  totalPaise: Paise;
};

/**
 * The amount a person pays when they tap Pay (D99, D107): the OLDEST open position's amount due on `asOf`, not the total of
 * every bill. A position is open while its principal is unpaid (principal plus fee) or while only its posted late fee is
 * unpaid (the remainder of the fee). It is worked out by `positionsForFlat`, the function the Home uses, so the button and the
 * lock can never disagree. `payments` are the flat's ledger entries (PAYMENT, REVERSAL, LATE_FEE and ADJUSTMENT; others are
 * ignored). Null when nothing is open.
 */
export function lockAmount(input: { openBills: readonly DueBill[]; asOf: CalendarDate; policy: LateFeePolicy; payments: readonly DueEntry[] }): LockedAmount | null {
  for (const { bill, position } of positionsForFlat({ bills: input.openBills, entries: input.payments, policy: input.policy, asOf: input.asOf })) {
    if (position.kind === "SETTLED") continue;
    return { billId: bill.id, kind: position.kind, principalPaise: position.principalOutstandingPaise, feePaise: position.feeOutstandingPaise, totalPaise: position.amountDuePaise };
  }
  return null;
}

/** Two amounts are the same only when they are the same integer number of paise. */
export const sameAmount = (a: Paise, b: Paise): boolean => a === b;
