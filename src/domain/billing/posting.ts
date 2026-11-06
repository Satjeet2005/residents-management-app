import type { Paise } from "../money/money";
import type { CalendarDate } from "../time/calendar";
import type { BillPosition } from "./position";

export type PlannedEntry = { entryType: "LATE_FEE" | "PAYMENT"; direction: "CHARGE" | "PAYMENT"; amountPaise: Paise; effectiveDate: CalendarDate };

export type PostingPlan = { entries: PlannedEntry[] } | { refused: "NO_DUES" | "EXCESS" };

/**
 * The ledger entries for a confirmed credit on one bill (D107, D110). `position` must be the bill's position AS OF `paymentDate`:
 * a position of another date is a bug and throws. Entries are dated `paymentDate`.
 * - PRINCIPAL_OPEN with principal O and fee f: a credit of at least O brings the payments to the bill, so the fee accrued through
 *   the payment date is posted as a LATE_FEE (only if above zero) and then ONE PAYMENT of the credit. A credit below O is a
 *   PAYMENT alone: the fee keeps accruing and is not posted. A credit above the amount due is refused as EXCESS.
 * - FEE_ONLY with remainder r: a PAYMENT alone, up to r; above r is EXCESS.
 * - SETTLED: NO_DUES. A credit of zero or less throws RangeError.
 */
export function planPosting(input: { position: BillPosition; creditPaise: Paise; paymentDate: CalendarDate }): PostingPlan {
  const { position, creditPaise, paymentDate } = input;
  if (creditPaise <= 0n) throw new RangeError("The credit must be above zero");
  if (position.asOf !== paymentDate) throw new RangeError(`The position is as of ${position.asOf}, not the payment date ${paymentDate}`);
  if (position.kind === "SETTLED") return { refused: "NO_DUES" };
  if (creditPaise > position.amountDuePaise) return { refused: "EXCESS" };

  const entry = (entryType: PlannedEntry["entryType"], amountPaise: Paise): PlannedEntry => ({
    entryType,
    direction: entryType === "LATE_FEE" ? "CHARGE" : "PAYMENT",
    amountPaise,
    effectiveDate: paymentDate,
  });
  const reachesBill = position.kind === "PRINCIPAL_OPEN" && creditPaise >= position.principalOutstandingPaise;
  const fee = position.feeComputedPaise;
  return { entries: [...(reachesBill && fee > 0n ? [entry("LATE_FEE", fee)] : []), entry("PAYMENT", creditPaise)] };
}
