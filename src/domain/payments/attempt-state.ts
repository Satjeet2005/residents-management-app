import type { BillPosition } from "../billing/position";
import { planPosting } from "../billing/posting";
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

/**
 * What the caller loads about the bill: its position AS OF the day the attempt started (billPosition, via positionsForFlat; null
 * when the bill had not been issued that day), and whether a payment on it is dated after that day.
 */
export type AttemptBill = {
  position: BillPosition | null;
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

/**
 * A success posts only when every guard holds; the first one that fails names the exception, and nothing is posted. The entries
 * are exactly the ones planPosting plans (D107, D110): a LATE_FEE (once, when the principal is reached) and ONE PAYMENT for a
 * principal still open, a PAYMENT alone for a fee still owed.
 */
function decideSuccess(attempt: GatewayAttempt, event: GatewayEvent, bill: AttemptBill): GatewayDecision {
  if (event.amountPaise !== attempt.amountPaise) return exception("AMOUNT_MISMATCH");
  if (bill.hasPaymentAfterStart) return exception("LATER_PAYMENT");
  const { position } = bill;
  if (position === null || position.kind === "SETTLED") return exception("BILL_ALREADY_PAID");
  if (position.amountDuePaise !== attempt.amountPaise) return exception("AMOUNT_MISMATCH");
  const plan = planPosting({ position, creditPaise: attempt.amountPaise, paymentDate: attempt.startedOn });
  if ("refused" in plan) return exception(plan.refused === "NO_DUES" ? "BILL_ALREADY_PAID" : "AMOUNT_MISMATCH");
  const base = { billId: attempt.billId, flatId: attempt.flatId, paymentAttemptId: attempt.id };
  const entries: LedgerPost[] = plan.entries.map((entry) => ({
    ...base,
    ...entry,
    idempotencyKey: `payment:${attempt.id}:${entry.entryType}`,
    reference: entry.entryType === "PAYMENT" ? attempt.reference : null,
  }));
  return { kind: "POST", entries };
}

/**
 * The decision for one gateway event.
 * - An event whose reference is not the attempt's: EXCEPTION UNKNOWN_REFERENCE.
 * - On an INITIATED attempt: a SUCCEEDED event posts only if the amount equals the locked amount, equals the bill's amount due
 *   on the start date (principal plus fee, or the fee alone), no payment is dated after the start date, and the bill still owes
 *   something (D45, D50, D107, R1); a FAILED event marks the attempt failed (no money moved).
 * - On a final attempt: the same event again is DUPLICATE (a success must also repeat the amount); the opposite event is
 *   EXCEPTION CONTRADICTS_FINAL_STATE and is never posted automatically.
 */
export function decideGatewayEvent(input: { attempt: GatewayAttempt; event: GatewayEvent; bill: AttemptBill }): GatewayDecision {
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
