import type { Paise } from "../money/money";
import { type CalendarDate, diffDays } from "../time/calendar";
import { medianOf } from "./stats";
import type { ReportPosition } from "./positions";

export type MoneyLine = {
  /** The sum of the bills' amounts. */
  billedPaise: Paise;
  /** Principal paid on those bills as of the business date: the bill minus the principal still owed. Never above the bill, and never a late fee. */
  collectedPaise: Paise;
  /** Principal still owed. billedPaise = collectedPaise + outstandingPaise, exactly. */
  outstandingPaise: Paise;
  flatsBilled: number;
  /** Flats whose principal is all paid (a late fee may still be owed: it is in the fee block). */
  flatsPaidInFull: number;
  /** Flats with principal still owed. flatsPaidInFull + flatsOutstanding = flatsBilled. */
  flatsOutstanding: number;
  fees: {
    /** A late fee that was posted and has been paid (the payments above the bill). */
    postedPaidPaise: Paise;
    /** A late fee that was posted and is still owed: the FEE_ONLY positions. */
    postedOwingPaise: Paise;
    /** The fee accruing on bills whose principal is still open: computed, not yet posted (D110). */
    accruingPaise: Paise;
  };
};

const sum = (amounts: readonly Paise[]): Paise => amounts.reduce((total, amount) => total + amount, 0n);

/**
 * The money line of a set of positions (the bills of one month, as of a date), from `billPosition` only. Billed is the sum of the bills. Collected is the
 * principal paid: the bill minus the principal outstanding, so a late fee never counts in it and a payment above the bill is not Collected. The fee block:
 * "posted and paid" is what was paid above the bill on bills whose principal is paid; "posted and owing" is the remainder of a posted fee (FEE_ONLY);
 * "accruing" is the computed fee on bills whose principal is open. A bill counts once however many payments it has.
 */
export function moneyLine(positions: readonly ReportPosition[]): MoneyLine {
  const flats = new Set(positions.map((p) => p.flatId));
  const flatsWithPrincipalOwed = new Set(positions.filter((p) => p.position.principalOutstandingPaise > 0n).map((p) => p.flatId));
  const principalPaid = positions.filter((p) => p.position.principalOutstandingPaise === 0n);
  return {
    billedPaise: sum(positions.map((p) => p.bill.amountPaise)),
    collectedPaise: sum(positions.map((p) => p.bill.amountPaise - p.position.principalOutstandingPaise)),
    outstandingPaise: sum(positions.map((p) => p.position.principalOutstandingPaise)),
    flatsBilled: flats.size,
    flatsPaidInFull: flats.size - flatsWithPrincipalOwed.size,
    flatsOutstanding: flatsWithPrincipalOwed.size,
    fees: {
      postedPaidPaise: sum(
        principalPaid.map((p) => {
          const excess = sum(p.payments.map((x) => x.amountPaise)) - p.bill.amountPaise;
          return excess > 0n ? excess : 0n;
        }),
      ),
      postedOwingPaise: sum(positions.filter((p) => p.position.kind === "FEE_ONLY").map((p) => p.position.feeOutstandingPaise)),
      accruingPaise: sum(positions.filter((p) => p.position.kind === "PRINCIPAL_OPEN").map((p) => p.position.feeOutstandingPaise)),
    },
  };
}

export type CollectionQuality = {
  /** ALL the month's bills, due or not, paid or not. `bills - paid` is the number of bills not paid at all. */
  bills: number;
  /** ALL the month's bills that are due as of the business date (due date on or before it), paid or not: the denominator of the headline on-time rate (D134). */
  due: number;
  /** Of those, the bills whose principal was paid on or before the due date: the numerator of the headline rate. */
  dueOnTime: number;
  /** Bills whose principal was paid on or before the due date, whether or not the due date has come (the secondary line, "of paid bills"). */
  paidOnTime: number;
  /** Bills whose principal is paid (on time or late). */
  paid: number;
  paidLate: number;
  /** Median days from the bill's issue to the day its principal was paid, over the paid bills; null when none. */
  medianDaysToPay: number | null;
};

/**
 * How promptly a month's bills were paid, as of `asOf`. A bill is "paid" when its principal is (settledOn is set: SETTLED or FEE_ONLY). On time means
 * settled on or before the due date. The HEADLINE on-time rate (D134) is dueOnTime out of due: the on-time payments out of ALL the month's bills that are due as
 * of `asOf`, so an unpaid bill past its due date counts against it and a bill not yet due is left out. The secondary line is paidOnTime out of paid ("of paid
 * bills"); the share paid late is paidLate out of paid; days to pay run from the issue date to the settling date, and the median uses the lower middle value
 * (`medianOf`).
 */
export function collectionQuality(positions: readonly ReportPosition[], asOf: CalendarDate): CollectionQuality {
  const paid = positions.filter((p) => p.position.settledOn !== null);
  const onTime = paid.filter((p) => (p.position.settledOn as CalendarDate) <= p.bill.dueOn);
  const due = positions.filter((p) => p.bill.dueOn <= asOf);
  return {
    bills: positions.length,
    due: due.length,
    dueOnTime: due.filter((p) => p.position.settledOn !== null && p.position.settledOn <= p.bill.dueOn).length,
    paidOnTime: onTime.length,
    paid: paid.length,
    paidLate: paid.length - onTime.length,
    medianDaysToPay: medianOf(paid.map((p) => Math.max(0, diffDays(p.bill.issuedOn, p.position.settledOn as CalendarDate)))),
  };
}
