import type { Paise } from "../money/money";
import type { CalendarDate } from "../time/calendar";

/**
 * What the gateway tells us about a payment attempt, and what to do about it (D45, D50, D41, rules R1 and R5).
 * Pure: the caller loads the facts (the attempt, and the bill's position on the day the attempt started) and acts on the
 * answer. Nothing here posts, so the one place that writes the ledger can be small and the rules can be tested alone.
 *
 * Built now: INITIATED, SUCCEEDED and FAILED. PROCESSING, UNKNOWN and RELEASED belong to the next task. The types name
 * PROCESSING and RELEASED so the database enum fits, and an event for an attempt in either is never guessed at: it is
 * handed to a person (an EXCEPTION).
 */
export type AttemptStatus = "INITIATED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "RELEASED";

export type GatewayAttempt = {
  id: string;
  billId: string;
  flatId: string;
  status: AttemptStatus;
  /** The amount locked when the person tapped Pay. */
  amountPaise: Paise;
  /** The gateway reference the attempt was created with. */
  reference: string;
  /** The India date the attempt started: the date every ledger entry of this payment carries. */
  startedOn: CalendarDate;
};

export type GatewayEvent = { type: "SUCCEEDED" | "FAILED"; amountPaise: Paise; reference: string };

/** The bill's position on the day the attempt started, worked out by the caller with computeDues' own functions. */
export type BillPosition = {
  principalOutstandingAtStartPaise: Paise;
  feeAtStartPaise: Paise;
  /** True when a payment on this bill is dated after the day the attempt started. */
  hasPaymentAfterStart: boolean;
};

export type ExceptionReason = "AMOUNT_MISMATCH" | "LATER_PAYMENT" | "BILL_ALREADY_PAID" | "CONTRADICTS_FINAL_STATE" | "UNKNOWN_REFERENCE";

export type LedgerPost = {
  entryType: "LATE_FEE" | "PAYMENT";
  direction: "CHARGE" | "PAYMENT";
  amountPaise: Paise;
  effectiveDate: CalendarDate;
  billId: string;
  flatId: string;
  paymentAttemptId: string;
  idempotencyKey: string;
  /** The gateway reference, on the PAYMENT only (the ledger keeps it unique). */
  reference: string | null;
};

export type GatewayDecision =
  | { kind: "POST"; entries: readonly LedgerPost[] }
  | { kind: "MARK_FAILED" }
  | { kind: "DUPLICATE" }
  | { kind: "EXCEPTION"; reason: ExceptionReason };

const exception = (reason: ExceptionReason): GatewayDecision => ({ kind: "EXCEPTION", reason });

/** The entries of a confirmed payment: the late fee as a charge (only when above zero), then ONE payment for principal plus fee. */
function entriesFor(attempt: GatewayAttempt, bill: BillPosition): LedgerPost[] {
  const base = { effectiveDate: attempt.startedOn, billId: attempt.billId, flatId: attempt.flatId, paymentAttemptId: attempt.id };
  const entries: LedgerPost[] = [];
  if (bill.feeAtStartPaise > 0n) {
    entries.push({ ...base, entryType: "LATE_FEE", direction: "CHARGE", amountPaise: bill.feeAtStartPaise, idempotencyKey: `payment:${attempt.id}:LATE_FEE`, reference: null });
  }
  entries.push({
    ...base,
    entryType: "PAYMENT",
    direction: "PAYMENT",
    amountPaise: bill.principalOutstandingAtStartPaise + bill.feeAtStartPaise,
    idempotencyKey: `payment:${attempt.id}:PAYMENT`,
    reference: attempt.reference,
  });
  return entries;
}

/** A success posts only when every guard holds; the first one that fails names the exception, and nothing is posted. */
function decideSuccess(attempt: GatewayAttempt, event: GatewayEvent, bill: BillPosition): GatewayDecision {
  if (event.amountPaise !== attempt.amountPaise) return exception("AMOUNT_MISMATCH");
  if (bill.hasPaymentAfterStart) return exception("LATER_PAYMENT");
  if (bill.principalOutstandingAtStartPaise <= 0n) return exception("BILL_ALREADY_PAID");
  if (bill.principalOutstandingAtStartPaise + bill.feeAtStartPaise !== attempt.amountPaise) return exception("AMOUNT_MISMATCH");
  return { kind: "POST", entries: entriesFor(attempt, bill) };
}

/**
 * The decision for one gateway event.
 * - An event whose reference is not the attempt's: EXCEPTION UNKNOWN_REFERENCE.
 * - On an INITIATED attempt: a SUCCEEDED event posts only if the amount equals the locked amount, equals outstanding
 *   principal plus fee on the start date, no payment is dated after the start date, and the bill still owes something
 *   (D45, D50, R1); a FAILED event marks the attempt failed (no money moved).
 * - On a final attempt: the same event again is DUPLICATE (a success must also repeat the amount); the opposite event is
 *   EXCEPTION CONTRADICTS_FINAL_STATE and is never posted automatically.
 */
export function decideGatewayEvent(input: { attempt: GatewayAttempt; event: GatewayEvent; bill: BillPosition }): GatewayDecision {
  const { attempt, event, bill } = input;
  if (event.reference !== attempt.reference) return exception("UNKNOWN_REFERENCE");
  switch (attempt.status) {
    case "INITIATED":
      return event.type === "FAILED" ? { kind: "MARK_FAILED" } : decideSuccess(attempt, event, bill);
    case "SUCCEEDED":
      if (event.type === "FAILED") return exception("CONTRADICTS_FINAL_STATE");
      return event.amountPaise === attempt.amountPaise ? { kind: "DUPLICATE" } : exception("AMOUNT_MISMATCH");
    case "FAILED":
      return event.type === "FAILED" ? { kind: "DUPLICATE" } : exception("CONTRADICTS_FINAL_STATE");
    case "PROCESSING":
    case "RELEASED":
      return exception("CONTRADICTS_FINAL_STATE");
  }
}

/** The plain-English note for the accounts team, one sentence per reason. It never contains a secret. */
export function describeException(reason: ExceptionReason): string {
  switch (reason) {
    case "AMOUNT_MISMATCH":
      return "The gateway reported a different amount from the one locked for this payment, or the bill no longer owes that amount. Nothing was posted. Check with the gateway and the bank.";
    case "LATER_PAYMENT":
      return "A payment dated after this attempt started is already on the bill. Nothing was posted. Check whether this payment is a duplicate.";
    case "BILL_ALREADY_PAID":
      return "The bill was already paid when the gateway reported success. Nothing was posted. The money may need to be refunded or credited.";
    case "CONTRADICTS_FINAL_STATE":
      return "The gateway reported a result that contradicts the one already recorded for this attempt. Nothing was changed. Check with the gateway and the bank.";
    case "UNKNOWN_REFERENCE":
      return "The gateway reported a reference that does not match this attempt. Nothing was posted.";
  }
}
