import { sumPaise, type Paise } from "../money/money";
import type { CalendarDate } from "../time/calendar";
import { oldestDue, sortedByDue } from "./amounts";
import type { FlatContext, MatchSettings, PostingEntry, PostingPlan } from "./types";

/**
 * The ledger entries for a payment that settles the oldest open bill, worked out as of the
 * row's date. It mirrors how the seed posts a bill that is paid late (D13, D26, D35): a LATE_FEE
 * charge for the computed fee, only if it is above zero, then ONE PAYMENT of the unpaid principal
 * plus that fee. Both carry the bill's key and are effective on `txnDate`.
 *
 * Throws RangeError when the flat has no open bill on that date or the credit is not exactly the
 * amount due: the plan never guesses, and it never makes two PAYMENT entries (the database allows
 * one payment per bank row).
 */
export function planPayment(flat: FlatContext, creditPaise: Paise, txnDate: CalendarDate, settings: MatchSettings): PostingPlan {
  const due = oldestDue(sortedByDue(flat.openBills), txnDate, settings.lateFeePolicy);
  if (due === null) throw new RangeError(`Flat ${flat.code} has no open bill on ${txnDate}`);
  if (creditPaise !== due.duePaise) {
    throw new RangeError(`Credit ${creditPaise} does not equal the amount due ${due.duePaise} on bill ${due.billKey}`);
  }
  const entry = (entryType: PostingEntry["entryType"], amountPaise: Paise): PostingEntry => ({ entryType, amountPaise, effectiveDate: txnDate, billKey: due.billKey });
  const entries = [...(due.feePaise > 0n ? [entry("LATE_FEE", due.feePaise)] : []), entry("PAYMENT", due.outstandingPaise + due.feePaise)];
  const paid = sumPaise(entries.filter((e) => e.entryType === "PAYMENT").map((e) => e.amountPaise));
  if (paid !== creditPaise || entries.filter((e) => e.entryType === "PAYMENT").length !== 1) {
    throw new RangeError(`The plan for ${flat.code} does not reconcile with the credit`);
  }
  return { entries };
}
