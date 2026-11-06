import type { Paise } from "../money/money";
import { type CalendarDate, diffDays } from "../time/calendar";
import { type LateFeePolicy, computeLateFee } from "./late-fee";
import { type BillPosition, type PositionAnomaly, billPosition } from "./position";
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
  /** PRINCIPAL_OPEN: principal still unpaid, fee computed. FEE_ONLY: the principal is paid and the posted late fee is not (D107). */
  kind: "PRINCIPAL_OPEN" | "FEE_ONLY";
  period: CalendarDate;
  dueOn: CalendarDate;
  billAmountPaise: Paise;
  /** Payments on this bill up to today that were not reversed. */
  payments: readonly { date: CalendarDate; amountPaise: Paise }[];
  /** Principal still unpaid: above zero for PRINCIPAL_OPEN, zero for FEE_ONLY. */
  outstandingPaise: Paise;
  /** The late fee still owed (computed while the principal is open, what remains of the posted fee when FEE_ONLY). */
  feePaise: Paise;
  /** FEE_ONLY: the whole fee that accrued, and the part of it already paid (payments above the bill). Zero otherwise. */
  feeAccruedPaise: Paise;
  feePaidPaise: Paise;
  /** FEE_ONLY: the date the principal was paid, the day the fee stopped growing. Null while the principal is open. */
  settledOn: CalendarDate | null;
  /** Days past the due date: to today, or to the settling date when FEE_ONLY. 0 when not yet due. */
  overdueDays: number;
  anomalies: readonly PositionAnomaly[];
  working: FeeWorking | null;
};

export type DuesStatus = "OVERDUE" | "NOT_YET_DUE" | "PARTLY_PAID" | "LATE_FEE_DUE" | "ALL_PAID" | "CREDIT";

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

export type FlatBillPosition = { bill: DueBill; position: BillPosition; payments: readonly { date: CalendarDate; amountPaise: Paise }[] };

/**
 * The position of every bill of a flat as of `asOf` (D107), oldest due date first. A bill issued after `asOf` is left out. Entries
 * dated after `asOf` and entries that a REVERSAL cancels do not count. Payments, LATE_FEE charges and ADJUSTMENTs are matched to
 * a bill by its id. The Home, the payment lock and the statement import all read bills through this one function, so they cannot
 * disagree (the committee report will too).
 */
export function positionsForFlat(input: { bills: readonly DueBill[]; entries: readonly DueEntry[]; policy: LateFeePolicy; asOf: CalendarDate }): FlatBillPosition[] {
  const { policy, asOf } = input;
  const entries = input.entries.filter((e) => e.effectiveDate <= asOf);
  const reversed = new Set(entries.filter((e) => e.entryType === "REVERSAL" && e.reversesEntryId !== null).map((e) => e.reversesEntryId));
  const live = entries.filter((e) => !reversed.has(e.id));
  return [...input.bills]
    .filter((b) => b.issuedOn <= asOf)
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.period < b.period ? -1 : 1))
    .map((bill) => {
      const mine = live.filter((e) => e.billId === bill.id);
      const payments = mine.filter((e) => e.entryType === "PAYMENT" && e.direction === "PAYMENT").map((e) => ({ date: e.effectiveDate, amountPaise: e.amountPaise }));
      const position = billPosition({
        billAmountPaise: bill.amountPaise,
        dueOn: bill.dueOn,
        asOf,
        payments,
        postedFees: mine.filter((e) => e.entryType === "LATE_FEE" && e.direction === "CHARGE").map((e) => ({ date: e.effectiveDate, amountPaise: e.amountPaise })),
        adjustments: mine.filter((e) => e.entryType === "ADJUSTMENT").map((e) => ({ date: e.effectiveDate, direction: e.direction, amountPaise: e.amountPaise })),
        holds: [],
        policy,
      });
      return { bill, position, payments };
    });
}

function openBillOf({ bill, position, payments }: FlatBillPosition, today: CalendarDate, policy: LateFeePolicy): OpenBill {
  const common = { billId: bill.id, period: bill.period, dueOn: bill.dueOn, billAmountPaise: bill.amountPaise, payments, anomalies: position.anomalies };
  if (position.kind === "PRINCIPAL_OPEN") {
    const result = computeLateFee({ billAmountPaise: bill.amountPaise, dueOn: bill.dueOn, asOf: today, payments, holds: [], policy });
    return {
      ...common,
      kind: "PRINCIPAL_OPEN",
      outstandingPaise: position.principalOutstandingPaise,
      feePaise: position.feeOutstandingPaise,
      feeAccruedPaise: 0n,
      feePaidPaise: 0n,
      settledOn: null,
      overdueDays: result.overdueDays,
      working: buildFeeWorking(result, policy),
    };
  }
  // FEE_ONLY: the fee stopped growing the day the principal was paid, so the working is shown as of that day.
  const settledOn = position.settledOn as CalendarDate;
  const result = computeLateFee({ billAmountPaise: bill.amountPaise, dueOn: bill.dueOn, asOf: settledOn, payments, holds: [], policy });
  const paidBeyondBill = payments.reduce((sum, p) => sum + p.amountPaise, 0n) - bill.amountPaise;
  const feePaidPaise = paidBeyondBill > 0n ? paidBeyondBill : 0n;
  const feeAccruedPaise = position.feeOutstandingPaise + feePaidPaise;
  return {
    ...common,
    kind: "FEE_ONLY",
    outstandingPaise: 0n,
    feePaise: position.feeOutstandingPaise,
    feeAccruedPaise,
    feePaidPaise,
    settledOn,
    overdueDays: result.overdueDays,
    working: result.feePaise === feeAccruedPaise ? buildFeeWorking(result, policy) : null,
  };
}

/**
 * What a flat owes today (D6, D13, D26, D35, D107). A bill is open while its position (positionsForFlat) is PRINCIPAL_OPEN or
 * FEE_ONLY. While the principal is open the late fee is computed on the daily balance by computeLateFee; once the principal is
 * paid the fee is the one that was posted, less what was paid for it. A bill issued after today is not yet part of the dues.
 * Every figure is a bigint.
 */
export function computeDues(input: { bills: readonly DueBill[]; entries: readonly DueEntry[]; policy: LateFeePolicy; today: CalendarDate }): Dues {
  const { policy, today } = input;
  const entries = input.entries.filter((e) => e.effectiveDate <= today);
  const reversed = new Set(entries.filter((e) => e.entryType === "REVERSAL" && e.reversesEntryId !== null).map((e) => e.reversesEntryId));
  const livePayments = entries.filter((e) => e.entryType === "PAYMENT" && e.direction === "PAYMENT" && !reversed.has(e.id));

  const openBills = positionsForFlat({ bills: input.bills, entries: input.entries, policy, asOf: today })
    .filter((p) => p.position.kind !== "SETTLED")
    .map((p) => openBillOf(p, today, policy));

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
  const principalOpen = openBills.filter((b) => b.kind === "PRINCIPAL_OPEN");
  const paid = principalOpen.flatMap((b) => b.payments);
  const partlyPaid =
    paid.length === 0
      ? null
      : {
          paidPaise: paid.reduce((sum, p) => sum + p.amountPaise, 0n),
          lastPaidOn: paid.map((p) => p.date).sort().reverse()[0],
          stillDuePaise: principalOpen.reduce((sum, b) => sum + b.outstandingPaise, 0n),
          feePaise: principalOpen.reduce((sum, b) => sum + b.feePaise, 0n),
        };
  const status: DuesStatus = principalOpen.length === 0 ? "LATE_FEE_DUE" : partlyPaid !== null ? "PARTLY_PAID" : principalOpen[0].overdueDays > 0 ? "OVERDUE" : "NOT_YET_DUE";
  return {
    status,
    amountDuePaise,
    creditPaise: 0n,
    openBills,
    oldest: { dueOn: first.dueOn, overdueDays: first.overdueDays, daysUntilDue: Math.max(0, diffDays(today, first.dueOn)) },
    partlyPaid,
    lastPayment,
    balancePaise,
  };
}
