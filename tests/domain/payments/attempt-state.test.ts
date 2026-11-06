import { describe, expect, it } from "vitest";
import type { PositionKind } from "@/domain/billing/position";
import {
  type AttemptBill,
  type AttemptStatus,
  type ExceptionReason,
  type GatewayAttempt,
  type GatewayDecision,
  type GatewayEvent,
  decideGatewayEvent,
  describeException,
} from "@/domain/payments/attempt-state";

const REF = "MOCK-attempt-1";
const attempt = (over: Partial<GatewayAttempt> = {}): GatewayAttempt => ({ id: "attempt-1", billId: "bill-1", flatId: "flat-1", status: "INITIATED", amountPaise: 646_800n, reference: REF, startedOn: "2026-10-27", ...over });
const event = (over: Partial<GatewayEvent> = {}): GatewayEvent => ({ type: "SUCCEEDED", amountPaise: 646_800n, reference: REF, ...over });
type Facts = { principalOutstandingAtStartPaise: bigint; feeAtStartPaise: bigint; hasPaymentAfterStart: boolean };
/** The bill as the caller would load it: principal and fee at the start day, from which the kind of position follows (D107). */
const bill = (over: Partial<Facts> = {}): Facts => ({ principalOutstandingAtStartPaise: 637_000n, feeAtStartPaise: 9_800n, hasPaymentAfterStart: false, ...over });
const asBill = (facts: Facts, asOf: string): AttemptBill => {
  const principal = facts.principalOutstandingAtStartPaise;
  const fee = facts.feeAtStartPaise;
  const kind: PositionKind = principal > 0n ? "PRINCIPAL_OPEN" : fee > 0n ? "FEE_ONLY" : "SETTLED";
  return {
    hasPaymentAfterStart: facts.hasPaymentAfterStart,
    position: { kind, asOf, principalOutstandingPaise: principal, feeComputedPaise: fee, feeOutstandingPaise: fee, amountDuePaise: principal + fee, settledOn: null, anomalies: [] },
  };
};
const decide = (a = attempt(), e = event(), b = bill()) => decideGatewayEvent({ attempt: a, event: e, bill: asBill(b, a.startedOn) });
const exceptionOf = (reason: ExceptionReason): GatewayDecision => ({ kind: "EXCEPTION", reason });

describe("PY1 posting a confirmed success (D45, R1)", () => {
  it("posts a LATE_FEE charge and ONE PAYMENT for principal plus fee, dated the attempt's start day, with both ids and the idempotency keys", () => {
    const result = decide();
    expect(result).toEqual({
      kind: "POST",
      entries: [
        { entryType: "LATE_FEE", direction: "CHARGE", amountPaise: 9_800n, effectiveDate: "2026-10-27", billId: "bill-1", flatId: "flat-1", paymentAttemptId: "attempt-1", idempotencyKey: "payment:attempt-1:LATE_FEE", reference: null },
        { entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 646_800n, effectiveDate: "2026-10-27", billId: "bill-1", flatId: "flat-1", paymentAttemptId: "attempt-1", idempotencyKey: "payment:attempt-1:PAYMENT", reference: REF },
      ],
    });
  });

  it("posts only the PAYMENT when the fee is zero (a bill not yet overdue)", () => {
    const result = decide(attempt({ amountPaise: 637_000n }), event({ amountPaise: 637_000n }), bill({ feeAtStartPaise: 0n }));
    expect(result.kind).toBe("POST");
    if (result.kind !== "POST") return;
    expect(result.entries.map((e) => e.entryType)).toEqual(["PAYMENT"]);
    expect(result.entries[0].amountPaise).toBe(637_000n);
  });

  it("dates the entries by the start day, whatever day the event arrives", () => {
    const result = decide(attempt({ startedOn: "2026-10-26" }));
    expect(result.kind === "POST" && result.entries.every((e) => e.effectiveDate === "2026-10-26")).toBe(true);
  });

  it("carries the gateway reference on the PAYMENT only", () => {
    const result = decide();
    expect(result.kind === "POST" && result.entries.map((e) => e.reference)).toEqual([null, REF]);
  });

  it("T21-1601 shaped: ₹5,660 principal and ₹38 fee is one ₹5,698 payment", () => {
    const result = decide(attempt({ amountPaise: 569_800n }), event({ amountPaise: 569_800n }), bill({ principalOutstandingAtStartPaise: 566_000n, feeAtStartPaise: 3_800n }));
    expect(result.kind === "POST" && result.entries.map((e) => [e.entryType, e.amountPaise])).toEqual([["LATE_FEE", 3_800n], ["PAYMENT", 569_800n]]);
  });
});

describe("FA2 a bill whose principal is paid and whose fee is owed (D107)", () => {
  it("posts ONE PAYMENT of the fee and no second LATE_FEE", () => {
    const result = decide(attempt({ amountPaise: 3_800n }), event({ amountPaise: 3_800n }), bill({ principalOutstandingAtStartPaise: 0n, feeAtStartPaise: 3_800n }));
    expect(result).toEqual({
      kind: "POST",
      entries: [{ entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 3_800n, effectiveDate: "2026-10-27", billId: "bill-1", flatId: "flat-1", paymentAttemptId: "attempt-1", idempotencyKey: "payment:attempt-1:PAYMENT", reference: REF }],
    });
  });

  it("a fee-only success with a later payment on the bill is still a LATER_PAYMENT exception", () => {
    expect(decide(attempt({ amountPaise: 3_800n }), event({ amountPaise: 3_800n }), bill({ principalOutstandingAtStartPaise: 0n, feeAtStartPaise: 3_800n, hasPaymentAfterStart: true }))).toEqual(exceptionOf("LATER_PAYMENT"));
  });

  it("a bill with no position (not issued on the start day) is BILL_ALREADY_PAID, nothing posted", () => {
    expect(decideGatewayEvent({ attempt: attempt(), event: event(), bill: { position: null, hasPaymentAfterStart: false } })).toEqual(exceptionOf("BILL_ALREADY_PAID"));
  });
});

describe("PY1 the guards on a success never post (D45, D50, D41)", () => {
  it.each<[string, GatewayAttempt, GatewayEvent, Facts, ExceptionReason]>([
    ["event amount lower than the locked amount", attempt(), event({ amountPaise: 646_700n }), bill(), "AMOUNT_MISMATCH"],
    ["event amount higher than the locked amount", attempt(), event({ amountPaise: 646_900n }), bill(), "AMOUNT_MISMATCH"],
    ["event amount of one rupee", attempt(), event({ amountPaise: 100n }), bill(), "AMOUNT_MISMATCH"],
    ["locked amount differs from principal plus fee (fee moved)", attempt(), event(), bill({ feeAtStartPaise: 9_900n }), "AMOUNT_MISMATCH"],
    ["locked amount differs from principal plus fee (a same-day part payment landed)", attempt(), event(), bill({ principalOutstandingAtStartPaise: 600_000n }), "AMOUNT_MISMATCH"],
    ["a payment is dated after the start day", attempt(), event(), bill({ hasPaymentAfterStart: true }), "LATER_PAYMENT"],
    ["a later payment wins over an amount that still matches", attempt(), event(), bill({ hasPaymentAfterStart: true }), "LATER_PAYMENT"],
    ["the bill was already paid on or before the start day", attempt(), event(), bill({ principalOutstandingAtStartPaise: 0n, feeAtStartPaise: 0n }), "BILL_ALREADY_PAID"],
    ["a fee-only bill whose fee is not the locked amount", attempt({ amountPaise: 9_700n }), event({ amountPaise: 9_700n }), bill({ principalOutstandingAtStartPaise: 0n }), "AMOUNT_MISMATCH"],
    ["a reference that is not the attempt's", attempt(), event({ reference: "MOCK-other" }), bill(), "UNKNOWN_REFERENCE"],
    ["an empty reference", attempt(), event({ reference: "" }), bill(), "UNKNOWN_REFERENCE"],
    ["a reference differing only in case", attempt(), event({ reference: "mock-attempt-1" }), bill(), "UNKNOWN_REFERENCE"],
  ])("%s is an EXCEPTION and posts nothing", (_label, a, e, b, reason) => {
    expect(decide(a, e, b)).toEqual(exceptionOf(reason));
  });

  it("the amount check comes first, then a later payment, then an already-paid bill", () => {
    expect(decide(attempt(), event({ amountPaise: 1n }), bill({ hasPaymentAfterStart: true, principalOutstandingAtStartPaise: 0n }))).toEqual(exceptionOf("AMOUNT_MISMATCH"));
    expect(decide(attempt(), event(), bill({ hasPaymentAfterStart: true, principalOutstandingAtStartPaise: 0n }))).toEqual(exceptionOf("LATER_PAYMENT"));
  });
});

describe("PY1 a failure (D49)", () => {
  it("a FAILED event on an INITIATED attempt marks it failed", () => {
    expect(decide(attempt(), event({ type: "FAILED" }))).toEqual({ kind: "MARK_FAILED" });
  });

  it("a FAILED event marks failed whatever the amount says: no money moved, so nothing is posted either way", () => {
    expect(decide(attempt(), event({ type: "FAILED", amountPaise: 1n }))).toEqual({ kind: "MARK_FAILED" });
  });

  it("a FAILED event for another reference is an exception, not a failure of this attempt", () => {
    expect(decide(attempt(), event({ type: "FAILED", reference: "MOCK-other" }))).toEqual(exceptionOf("UNKNOWN_REFERENCE"));
  });
});

describe("PY1 the same event again, and contradictions", () => {
  it.each<[string, AttemptStatus, GatewayEvent["type"], GatewayDecision]>([
    ["a repeated success", "SUCCEEDED", "SUCCEEDED", { kind: "DUPLICATE" }],
    ["a repeated failure", "FAILED", "FAILED", { kind: "DUPLICATE" }],
    ["a success after a failure", "FAILED", "SUCCEEDED", exceptionOf("CONTRADICTS_FINAL_STATE")],
    ["a failure after a success", "SUCCEEDED", "FAILED", exceptionOf("CONTRADICTS_FINAL_STATE")],
    ["a success for a RELEASED attempt (not built yet)", "RELEASED", "SUCCEEDED", exceptionOf("CONTRADICTS_FINAL_STATE")],
    ["a failure for a RELEASED attempt (not built yet)", "RELEASED", "FAILED", exceptionOf("CONTRADICTS_FINAL_STATE")],
    ["a success for a PROCESSING attempt (not built yet)", "PROCESSING", "SUCCEEDED", exceptionOf("CONTRADICTS_FINAL_STATE")],
    ["a failure for a PROCESSING attempt (not built yet)", "PROCESSING", "FAILED", exceptionOf("CONTRADICTS_FINAL_STATE")],
  ])("%s", (_label, status, type, expected) => {
    expect(decide(attempt({ status }), event({ type }))).toEqual(expected);
  });

  it("a repeated success with a different amount is an exception, not a duplicate", () => {
    expect(decide(attempt({ status: "SUCCEEDED" }), event({ amountPaise: 1_000n }))).toEqual(exceptionOf("AMOUNT_MISMATCH"));
  });

  it("a repeat never posts, whatever the bill looks like now (a later payment, a paid bill)", () => {
    expect(decide(attempt({ status: "SUCCEEDED" }), event(), bill({ hasPaymentAfterStart: true, principalOutstandingAtStartPaise: 0n }))).toEqual({ kind: "DUPLICATE" });
  });

  it("a repeat for a wrong reference is an exception even on a final attempt", () => {
    expect(decide(attempt({ status: "SUCCEEDED" }), event({ reference: "MOCK-other" }))).toEqual(exceptionOf("UNKNOWN_REFERENCE"));
  });

  it("a success after a failure never posts, even when every other guard would pass", () => {
    expect(decide(attempt({ status: "FAILED" }), event(), bill()).kind).toBe("EXCEPTION");
  });
});

describe("PY1 the notes for accounts", () => {
  const reasons: ExceptionReason[] = ["AMOUNT_MISMATCH", "LATER_PAYMENT", "BILL_ALREADY_PAID", "CONTRADICTS_FINAL_STATE", "UNKNOWN_REFERENCE"];
  it.each(reasons)("%s has a plain sentence that says nothing was posted or changed and holds no secret", (reason) => {
    const note = describeException(reason);
    expect(note).toMatch(/Nothing was (posted|changed)/);
    expect(note.length).toBeGreaterThan(40);
    expect(note).not.toMatch(/secret|signature|HMAC|password/i);
  });

  it("every reason has a different note", () => {
    expect(new Set(reasons.map(describeException)).size).toBe(reasons.length);
  });
});
