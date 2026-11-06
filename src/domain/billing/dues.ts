import type { Paise } from "../money/money";
import { type CalendarDate, diffDays } from "../time/calendar";
import { type LateFeePolicy, computeLateFee } from "./late-fee";
import { type FeeWorking, buildFeeWorking } from "./working";

export type DueBill = { id: string; period: CalendarDate; issuedOn: CalendarDate; dueOn: CalendarDate; amountPaise: Paise };

export type DueEntry = {
  id: string;
  entryType: "BILL" | "LATE_FEE" | "PAYMENT" | "REVERSAL" | "ADJUSTMENT";
  direction: "CHARGE" | "PAYMENT";
  amountPaise: Paise;
  effectiveDate: CalendarDate;
  billId: string | null;
  /** For a REVERSAL: the entry it cancels. */
  reversesEntryId: string | null;
};

export type OpenBill = {
  billId: string;
  period: CalendarDate;
  dueOn: CalendarDate;
  billAmountPaise: Paise;
  /** Payments on this bill up to today that were not reversed. */
  payments: readonly { date: CalendarDate; amountPaise: Paise }[];
  /** Principal still unpaid. Always above zero for an open bill. */
  outstandingPaise: Paise;
  feePaise: Paise;
  /** Days past the due date, 0 when not yet due. */
  overdueDays: number;
  working: FeeWorking | null;
};

export type DuesStatus = "OVERDUE" | "NOT_YET_DUE" | "PARTLY_PAID" | "ALL_PAID" | "CREDIT";

export type Dues = {
  status: DuesStatus;
  /** Outstanding principal plus late fees over the open bills. 0 when there are none. */
  amountDuePaise: Paise;
  /** Ledger charges minus payments, below zero: what the flat has paid ahead. 0 unless CREDIT. */
  creditPaise: Paise;
  /** Open bills, oldest due date first. */
  openBills: readonly OpenBill[];
  /** The oldest open bill's due date and how far from today it is. */
  oldest: { dueOn: CalendarDate; overdueDays: number; daysUntilDue: number } | null;
  /** Set when any open bill has had a payment. */
  partlyPaid: { paidPaise: Paise; lastPaidOn: CalendarDate; stillDuePaise: Paise; feePaise: Paise } | null;
  /** The newest payment that was not reversed, for the "No dues" lines. */
  lastPayment: { amountPaise: Paise; date: CalendarDate } | null;
  /** Ledger charges minus payments as of today, in paise (negative when the flat is in credit). */
  balancePaise: Paise;
};

/**
 * What a flat owes today (D6, D13, D26, D35). A bill is open while payments on it (by bill id, not reversed, dated up to
 * today) fall short of its amount. The late fee is computed on the daily balance by computeLateFee and is never stored.
 * A bill issued after today is not yet part of the dues. Every figure is a bigint.
 */
export function computeDues(input: { bills: readonly DueBill[]; entries: readonly DueEntry[]; policy: LateFeePolicy; today: CalendarDate }): Dues {
  const { policy, today } = input;
  const entries = input.entries.filter((e) => e.effectiveDate <= today);
  const reversed = new Set(entries.filter((e) => e.entryType === "REVERSAL" && e.reversesEntryId !== null).map((e) => e.reversesEntryId));
  const livePayments = entries.filter((e) => e.entryType === "PAYMENT" && e.direction === "PAYMENT" && !reversed.has(e.id));

  const openBills: OpenBill[] = [];
  for (const bill of [...input.bills].filter((b) => b.issuedOn <= today).sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.period < b.period ? -1 : 1))) {
    const payments = livePayments.filter((e) => e.billId === bill.id).map((e) => ({ date: e.effectiveDate, amountPaise: e.amountPaise }));
    const result = computeLateFee({ billAmountPaise: bill.amountPaise, dueOn: bill.dueOn, asOf: today, payments, holds: [], policy });
    if (result.outstandingPaise <= 0n) continue;
    openBills.push({
      billId: bill.id,
      period: bill.period,
      dueOn: bill.dueOn,
      billAmountPaise: bill.amountPaise,
      payments,
      outstandingPaise: result.outstandingPaise,
      feePaise: result.feePaise,
      overdueDays: result.overdueDays,
      working: buildFeeWorking(result, policy),
    });
  }

  const balancePaise = entries.reduce((sum, e) => (e.direction === "CHARGE" ? sum + e.amountPaise : sum - e.amountPaise), 0n);
  const newestPayment = [...livePayments].sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : a.effectiveDate > b.effectiveDate ? -1 : 0))[0];
  const lastPayment = newestPayment === undefined ? null : { amountPaise: newestPayment.amountPaise, date: newestPayment.effectiveDate };

  if (openBills.length === 0) {
    return {
      status: balancePaise < 0n ? "CREDIT" : "ALL_PAID",
      amountDuePaise: 0n,
      creditPaise: balancePaise < 0n ? -balancePaise : 0n,
      openBills,
      oldest: null,
      partlyPaid: null,
      lastPayment,
      balancePaise,
    };
  }

  const amountDuePaise = openBills.reduce((sum, b) => sum + b.outstandingPaise + b.feePaise, 0n);
  const first = openBills[0];
  const paid = openBills.flatMap((b) => b.payments);
  const partlyPaid =
    paid.length === 0
      ? null
      : {
          paidPaise: paid.reduce((sum, p) => sum + p.amountPaise, 0n),
          lastPaidOn: paid.map((p) => p.date).sort().reverse()[0],
          stillDuePaise: openBills.reduce((sum, b) => sum + b.outstandingPaise, 0n),
          feePaise: openBills.reduce((sum, b) => sum + b.feePaise, 0n),
        };
  return {
    status: partlyPaid !== null ? "PARTLY_PAID" : first.overdueDays > 0 ? "OVERDUE" : "NOT_YET_DUE",
    amountDuePaise,
    creditPaise: 0n,
    openBills,
    oldest: { dueOn: first.dueOn, overdueDays: first.overdueDays, daysUntilDue: Math.max(0, diffDays(today, first.dueOn)) },
    partlyPaid,
    lastPayment,
    balancePaise,
  };
}
