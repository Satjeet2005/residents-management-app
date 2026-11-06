import { describe, expect, it } from "vitest";
import { approvalErrorText, approvalNoteValid, approvalResultLines, interpretApprovalResponse, rejectReasonValid } from "@/lib/reconciliation/approval-state";
import { submitErrorText } from "@/lib/reconciliation/review-state";

describe("RA1 the note and the reason", () => {
  it("an approval note is optional, but when written it is 5 to 500 characters", () => {
    expect(approvalNoteValid("")).toBe(true);
    expect(approvalNoteValid("   ")).toBe(true);
    expect(approvalNoteValid("ok")).toBe(false);
    expect(approvalNoteValid("Checked on the statement")).toBe(true);
    expect(approvalNoteValid("x".repeat(501))).toBe(false);
  });

  it("a rejection always needs a reason of 5 to 500 characters", () => {
    expect(rejectReasonValid("")).toBe(false);
    expect(rejectReasonValid("no")).toBe(false);
    expect(rejectReasonValid("Wrong flat")).toBe(true);
  });
});

describe("RA2 answers of the approve and reject routes", () => {
  it("an approved ignore, a rejection and an approved match are told apart", () => {
    expect(interpretApprovalResponse("APPROVE", 200, { status: "APPROVED", action: "IGNORE" })).toEqual({ ok: true, result: { kind: "APPROVED_IGNORE" } });
    expect(interpretApprovalResponse("REJECT", 200, { status: "REJECTED" })).toEqual({ ok: true, result: { kind: "REJECTED" } });
    const match = interpretApprovalResponse("APPROVE", 200, { status: "APPROVED", action: "MATCH", flatCode: "T02-1503", entries: [{ entryType: "LATE_FEE", amountPaise: "5300" }, { entryType: "PAYMENT", amountPaise: "1066000" }], remaining: { kind: "FEE_ONLY", duePaise: "5300", feeOwedPaise: "5300" }, payerNotice: null });
    expect(match.ok && approvalResultLines(match.result)).toEqual(["Approved and posted to T02-1503.", "Late fee ₹53", "Payment ₹10,660", "₹53 late fee still due"]);
  });

  it("the lines for an ignore and a rejection say where the row went", () => {
    expect(approvalResultLines({ kind: "APPROVED_IGNORE" })).toEqual(["Approved. This row is now in Not maintenance."]);
    expect(approvalResultLines({ kind: "REJECTED" })).toEqual(["Rejected. The row is back in Needs you."]);
  });

  it.each([
    [409, "SELF_APPROVAL", "SELF_APPROVAL"],
    [409, "STATE_CHANGED", "STATE_CHANGED"],
    [409, "NOT_AWAITING_APPROVAL", "CHANGED"],
    [422, "REASON_REQUIRED", "REASON"],
    [403, "FORBIDDEN", "FORBIDDEN"],
    [404, "NOT_FOUND", "OTHER"],
    [500, "", "OTHER"],
  ])("%i %s is %s", (status, code, error) => {
    expect(interpretApprovalResponse("APPROVE", status, { error: code })).toEqual({ ok: false, error });
  });

  it("an approval answer where a rejection was asked (or the reverse) is not trusted", () => {
    expect(interpretApprovalResponse("REJECT", 200, { status: "APPROVED", action: "IGNORE" })).toEqual({ ok: false, error: "OTHER" });
    expect(interpretApprovalResponse("APPROVE", 200, { status: "REJECTED" })).toEqual({ ok: false, error: "OTHER" });
    expect(interpretApprovalResponse("APPROVE", 200, null)).toEqual({ ok: false, error: "OTHER" });
  });

  it("the sentences: asking for your own request to be approved, a bill that changed, and the shared ones", () => {
    expect(approvalErrorText("SELF_APPROVAL", submitErrorText)).toBe("You asked for this, so another person has to approve it.");
    expect(approvalErrorText("STATE_CHANGED", submitErrorText)).toContain("back in Needs you");
    expect(approvalErrorText("CHANGED", submitErrorText)).toBe("This row changed. Reload to see its current state.");
    expect(approvalErrorText("NETWORK", submitErrorText)).toMatch(/Try again/);
  });
});
