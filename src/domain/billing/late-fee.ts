import type { Paise } from "../money/money";
import { type CalendarDate, addDays, dayStartInstant, diffDays, isValidDate } from "../time/calendar";

export type LateFeePolicy = {
  /** Simple interest per year in basis points: 1200 = 12%. */
  annualRateBps: number;
  /** The highest annualRateBps allowed for this policy. */
  capBps: number;
  /** Days in the interest year; it stays fixed even in leap years. */
  daysInYear: number;
};

export const defaultLateFeePolicy: LateFeePolicy = { annualRateBps: 1200, capBps: 2100, daysInYear: 365 };

export type LateFeePayment = { date: CalendarDate; amountPaise: Paise };

/** A window in which a payment attempt on the bill was unresolved, in epoch milliseconds. */
export type LateFeeHold = { startedAt: number; endedAt: number | null };

export type LateFeeInput = {
  billAmountPaise: Paise;
  dueOn: CalendarDate;
  asOf: CalendarDate;
  /** Payments applied to THIS bill, in any order. */
  payments: readonly LateFeePayment[];
  holds: readonly LateFeeHold[];
  policy: LateFeePolicy;
};

export type LateFeeSegment = { fromDate: CalendarDate; toDate: CalendarDate; days: number; basePaise: Paise };

export type LateFeeResult = {
  overdueDays: number;
  skippedDays: number;
  chargedDays: number;
  /** Whole rupees, in paise. */
  feePaise: Paise;
  segments: LateFeeSegment[];
  /** The bill minus payments dated on or before asOf, never below zero. */
  outstandingPaise: Paise;
};

const BPS_DENOMINATOR = 10_000n;
const PAISE_PER_RUPEE = 100n;

export function validateLateFeePolicy(policy: LateFeePolicy): void {
  const { annualRateBps, capBps, daysInYear } = policy;
  if (!Number.isInteger(annualRateBps) || !Number.isInteger(capBps) || !Number.isInteger(daysInYear)) {
    throw new RangeError("Late-fee policy values must be integers");
  }
  if (annualRateBps < 0) throw new RangeError("annualRateBps must not be negative");
  if (annualRateBps > capBps) throw new RangeError(`annualRateBps ${annualRateBps} is above capBps ${capBps}`);
  if (daysInYear <= 0) throw new RangeError("daysInYear must be positive");
}

function validateInput(input: LateFeeInput): void {
  validateLateFeePolicy(input.policy);
  if (input.billAmountPaise <= 0n) throw new RangeError("billAmountPaise must be positive");
  for (const [name, date] of [["dueOn", input.dueOn], ["asOf", input.asOf]] as const) {
    if (!isValidDate(date)) throw new RangeError(`${name} "${date}" is not a valid calendar date`);
  }
  for (const payment of input.payments) {
    if (!isValidDate(payment.date)) throw new RangeError(`Payment date "${payment.date}" is not a valid calendar date`);
    if (payment.amountPaise <= 0n) throw new RangeError("Payment amounts must be positive");
  }
  for (const hold of input.holds) {
    const endedAt = hold.endedAt;
    if (!Number.isFinite(hold.startedAt) || (endedAt !== null && !Number.isFinite(endedAt))) {
      throw new RangeError("Hold instants must be finite numbers");
    }
    if (endedAt !== null && endedAt < hold.startedAt) throw new RangeError("A hold must not end before it starts");
  }
}

/** True when the day's start instant is inside a hold, using the half-open interval [startedAt, endedAt). */
function isSkipped(day: CalendarDate, holds: readonly LateFeeHold[]): boolean {
  const start = dayStartInstant(day);
  return holds.some((hold) => start >= hold.startedAt && (hold.endedAt === null || start < hold.endedAt));
}

/** Rounds numerator / denominator to the nearest integer, half up, for non-negative values. */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

export function computeLateFee(input: LateFeeInput): LateFeeResult {
  validateInput(input);
  const { billAmountPaise, dueOn, asOf, policy } = input;
  const payments = [...input.payments].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const paidThroughAsOf = payments.reduce((sum, p) => (p.date <= asOf ? sum + p.amountPaise : sum), 0n);
  const outstandingPaise = billAmountPaise > paidThroughAsOf ? billAmountPaise - paidThroughAsOf : 0n;

  const overdueDays = Math.max(0, diffDays(dueOn, asOf));
  const segments: LateFeeSegment[] = [];
  let skippedDays = 0;
  let numerator = 0n;
  let paidBefore = 0n;
  let nextPayment = 0;

  for (let offset = 1; offset <= overdueDays; offset++) {
    const day = addDays(dueOn, offset);
    while (nextPayment < payments.length && payments[nextPayment].date < day) {
      paidBefore += payments[nextPayment].amountPaise;
      nextPayment++;
    }
    if (isSkipped(day, input.holds)) {
      skippedDays++;
      continue;
    }
    const basePaise = billAmountPaise > paidBefore ? billAmountPaise - paidBefore : 0n;
    numerator += basePaise * BigInt(policy.annualRateBps);

    const last = segments[segments.length - 1];
    if (last !== undefined && last.basePaise === basePaise && addDays(last.toDate, 1) === day) {
      last.toDate = day;
      last.days++;
    } else {
      segments.push({ fromDate: day, toDate: day, days: 1, basePaise });
    }
  }

  // The exact fee in paise is numerator / (10000 * daysInYear). It is rounded once, here,
  // to whole rupees (half up), never per day.
  const denominator = BPS_DENOMINATOR * BigInt(policy.daysInYear);
  const feePaise = divideRoundHalfUp(numerator, denominator * PAISE_PER_RUPEE) * PAISE_PER_RUPEE;

  return {
    overdueDays,
    skippedDays,
    chargedDays: overdueDays - skippedDays,
    feePaise,
    segments,
    outstandingPaise,
  };
}

export function amountDuePaise(result: LateFeeResult): Paise {
  return result.outstandingPaise + result.feePaise;
}
