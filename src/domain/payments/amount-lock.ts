import { type DueBill, type DueEntry, computeDues } from "../billing/dues";
import type { LateFeePolicy } from "../billing/late-fee";
import type { Paise } from "../money/money";
import type { CalendarDate } from "../time/calendar";

export type LockedAmount = {
  billId: string;
  /** Principal still unpaid on that bill on `asOf`. */
  principalPaise: Paise;
  feePaise: Paise;
  /** principal plus fee: the amount the person pays. */
  totalPaise: Paise;
};

/**
 * The amount a person pays when they tap Pay (D99): the OLDEST open bill's outstanding principal plus its late fee on
 * `asOf`, not the total of every bill. It is worked out by `computeDues`, the same function the Home uses, so the button
 * and the lock can never disagree. `payments` are the flat's PAYMENT and REVERSAL ledger entries (a reversed payment does
 * not count). Null when no bill is open.
 */
export function lockAmount(input: { openBills: readonly DueBill[]; asOf: CalendarDate; policy: LateFeePolicy; payments: readonly DueEntry[] }): LockedAmount | null {
  const dues = computeDues({ bills: input.openBills, entries: input.payments, policy: input.policy, today: input.asOf });
  const oldest = dues.openBills[0];
  if (oldest === undefined) return null;
  return { billId: oldest.billId, principalPaise: oldest.outstandingPaise, feePaise: oldest.feePaise, totalPaise: oldest.outstandingPaise + oldest.feePaise };
}

/** Two amounts are the same only when they are the same integer number of paise. */
export const sameAmount = (a: Paise, b: Paise): boolean => a === b;
