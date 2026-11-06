import { describe, expect, it } from "vitest";
import {
  type ReviewState,
  canIgnore,
  canPost,
  initialReviewState,
  interpretManualResponse,
  needsSecondApprover,
  postLabel,
  reasonCounter,
  reasonLength,
  reasonValid,
  resultLines,
  reviewReducer,
  searchReady,
  submitErrorText,
} from "@/lib/reconciliation/review-state";

const run = (state: ReviewState, ...actions: Parameters<typeof reviewReducer>[1][]) => actions.reduce(reviewReducer, state);

describe("RV1 the review panel reducer", () => {
  it("starts with the best candidate chosen and nothing typed", () => {
    const state = initialReviewState("T21-1601");
    expect(state).toMatchObject({ flatCode: "T21-1601", query: "", reason: "", remember: false, reasonAsked: false, submit: { status: "IDLE" } });
    expect(initialReviewState(null).flatCode).toBeNull();
  });

  it("choosing a candidate or a search result sets the flat", () => {
    expect(run(initialReviewState(null), { type: "SELECT_FLAT", flatCode: "T12-0408" }).flatCode).toBe("T12-0408");
    expect(run(initialReviewState("T12-0408"), { type: "SELECT_FLAT", flatCode: "T21-1601" }).flatCode).toBe("T21-1601");
  });

  it("a search needs 2 characters: a shorter query clears the results", () => {
    expect(searchReady("t")).toBe(false);
    expect(searchReady(" t ")).toBe(false);
    expect(searchReady("t2")).toBe(true);
    const found = run(initialReviewState(null), { type: "SET_QUERY", query: "t21" }, { type: "SEARCH_START" }, { type: "SEARCH_DONE", hits: [{ flatCode: "T21-1601", tower: "T21", residents: ["Aamir Shaikh"], openPositions: 1 }] });
    expect(found.search).toMatchObject({ status: "DONE" });
    expect(found.search.hits).toHaveLength(1);
    expect(reviewReducer(found, { type: "SET_QUERY", query: "t" }).search).toEqual({ status: "IDLE", hits: [] });
    expect(run(found, { type: "SEARCH_FAILED" }).search).toEqual({ status: "ERROR", hits: [] });
  });

  it("the reason counts its trimmed characters and is valid from 5 to 500", () => {
    expect(reasonLength("  abcd  ")).toBe(4);
    expect(reasonValid("abcd")).toBe(false);
    expect(reasonValid("abcde")).toBe(true);
    expect(reasonValid("     abcde     ")).toBe(true);
    expect(reasonValid("x".repeat(500))).toBe(true);
    expect(reasonValid("x".repeat(501))).toBe(false);
    expect(reasonCounter("abc")).toBe("3 of 500 characters");
  });

  it("RV2 Post is not available without a flat, or without a valid reason (the primary action is disabled until both)", () => {
    const withFlat = initialReviewState("T21-1601");
    expect(canPost(withFlat)).toBe(false);
    expect(canPost(run(withFlat, { type: "SET_REASON", reason: "abcd" }))).toBe(false);
    expect(canPost(run(withFlat, { type: "SET_REASON", reason: "    " }))).toBe(false);
    expect(canPost(run(withFlat, { type: "SET_REASON", reason: "Paid at the branch" }))).toBe(true);
    expect(canPost(run(initialReviewState(null), { type: "SET_REASON", reason: "Paid at the branch" }))).toBe(false);
  });

  it("a submit in flight blocks a second submit and the primary action", () => {
    const ready = run(initialReviewState("T21-1601"), { type: "SET_REASON", reason: "Paid at the branch" });
    const sending = reviewReducer(ready, { type: "SUBMIT_START", kind: "MATCH" });
    expect(sending.submit.status).toBe("SUBMITTING");
    expect(canPost(sending)).toBe(false);
    expect(canIgnore(sending)).toBe(false);
    expect(reviewReducer(sending, { type: "SUBMIT_START", kind: "IGNORE" })).toBe(sending);
    expect(canIgnore(ready)).toBe(true);
  });

  it("pressing Not a maintenance payment without a reason asks for one, and typing clears the ask", () => {
    const asked = reviewReducer(initialReviewState(null), { type: "ASK_REASON" });
    expect(asked.reasonAsked).toBe(true);
    expect(reviewReducer(asked, { type: "SET_REASON", reason: "a" }).reasonAsked).toBe(false);
  });

  it("a failed submit keeps what was typed and says why, and Try again can start a new submit", () => {
    const ready = run(initialReviewState("T21-1601"), { type: "SET_REASON", reason: "Paid at the branch" }, { type: "SUBMIT_START", kind: "MATCH" });
    const failed = reviewReducer(ready, { type: "SUBMIT_FAILED", error: "NETWORK" });
    expect(failed).toMatchObject({ reason: "Paid at the branch", flatCode: "T21-1601", submit: { status: "ERROR", error: "NETWORK", kind: "MATCH" } });
    expect(reviewReducer(failed, { type: "SUBMIT_START", kind: "MATCH" }).submit.status).toBe("SUBMITTING");
  });

  it("a done submit keeps its result; reset starts clean", () => {
    const done = run(initialReviewState("T21-1601"), { type: "SUBMIT_START", kind: "IGNORE" }, { type: "SUBMIT_DONE", result: { kind: "IGNORED" } });
    expect(done.submit).toMatchObject({ status: "DONE", kind: "IGNORE", result: { kind: "IGNORED" } });
    expect(reviewReducer(done, { type: "RESET" })).toEqual(initialReviewState(null));
  });

  it("the primary label names the chosen flat", () => {
    expect(postLabel("T21-1601")).toBe("Post to T21-1601");
    expect(postLabel(null)).toBe("Post");
  });

  it("RV3 the second approver is needed at or above the threshold, whatever the threshold is", () => {
    expect(needsSecondApprover(1_000_000n, 1_000_000n)).toBe(true);
    expect(needsSecondApprover(999_999n, 1_000_000n)).toBe(false);
    expect(needsSecondApprover(1_000_000n, 2_500_000n)).toBe(false);
  });
});

describe("RV4 answers of the match and ignore routes", () => {
  it("a posted match carries the entries, the fee still owing and the payer notice", () => {
    const answer = interpretManualResponse("MATCH", 200, { status: "POSTED", flatCode: "T21-1601", entries: [{ entryType: "LATE_FEE", amountPaise: "3800" }, { entryType: "PAYMENT", amountPaise: "566000" }], remaining: { kind: "FEE_ONLY", duePaise: "3800", feeOwedPaise: "3800" }, payerNotice: "ADDED" });
    expect(answer).toEqual({ ok: true, result: { kind: "POSTED", flatCode: "T21-1601", entries: [{ entryType: "LATE_FEE", amountPaise: "3800" }, { entryType: "PAYMENT", amountPaise: "566000" }], feeOwedPaise: "3800", payerNotice: "ADDED" } });
    expect(resultLines((answer as { ok: true; result: Parameters<typeof resultLines>[0] }).result)).toEqual(["Posted to T21-1601.", "Late fee ₹38", "Payment ₹5,660", "₹38 late fee still due"]);
  });

  it("a settled match has no late fee line", () => {
    const answer = interpretManualResponse("MATCH", 200, { status: "POSTED", flatCode: "T12-0408", entries: [{ entryType: "PAYMENT", amountPaise: "646800" }], remaining: { kind: "SETTLED", duePaise: "0", feeOwedPaise: null }, payerNotice: null });
    expect(answer.ok && resultLines(answer.result)).toEqual(["Posted to T12-0408.", "Payment ₹6,468"]);
  });

  it("a request for approval and an ignore are read for either kind of call", () => {
    expect(interpretManualResponse("MATCH", 200, { status: "AWAITING_APPROVAL", thresholdPaise: "1000000" })).toEqual({ ok: true, result: { kind: "AWAITING_APPROVAL", thresholdPaise: "1000000" } });
    expect(interpretManualResponse("IGNORE", 200, { status: "AWAITING_APPROVAL", thresholdPaise: "1000000" }).ok).toBe(true);
    expect(interpretManualResponse("IGNORE", 200, { status: "IGNORED" })).toEqual({ ok: true, result: { kind: "IGNORED" } });
    expect(resultLines({ kind: "AWAITING_APPROVAL", thresholdPaise: "1000000" })[0]).toContain("Awaiting approval");
  });

  it.each([
    [409, "STALE", "CHANGED"],
    [409, "STATE_CHANGED", "CHANGED"],
    [409, "NOT_QUEUED", "CHANGED"],
    [422, "NEEDS_ADVANCE_HANDLING", "NEEDS_ADVANCE"],
    [422, "NO_OPEN_BILL", "NO_OPEN_BILL"],
    [422, "REASON_REQUIRED", "REASON"],
    [422, "FLAT_NOT_FOUND", "FLAT_NOT_FOUND"],
    [403, "FORBIDDEN", "FORBIDDEN"],
    [500, "", "OTHER"],
    [400, "INVALID_REQUEST", "OTHER"],
  ])("%i %s is %s", (status, code, error) => {
    expect(interpretManualResponse("MATCH", status, { error: code })).toEqual({ ok: false, error });
  });

  it("an answer that is not what was expected is OTHER, never a guess", () => {
    expect(interpretManualResponse("MATCH", 200, { status: "SOMETHING" })).toEqual({ ok: false, error: "OTHER" });
    expect(interpretManualResponse("MATCH", 200, null)).toEqual({ ok: false, error: "OTHER" });
    expect(interpretManualResponse("MATCH", 409, "text")).toEqual({ ok: false, error: "OTHER" });
  });

  it("every refusal has its own plain sentence, and the changed one says to reload", () => {
    expect(submitErrorText("CHANGED")).toBe("This row changed. Reload to see its current state.");
    const all = (["CHANGED", "NEEDS_ADVANCE", "NO_OPEN_BILL", "REASON", "FLAT_NOT_FOUND", "NETWORK", "FORBIDDEN", "OTHER"] as const).map(submitErrorText);
    expect(new Set(all).size).toBe(all.length);
    expect(submitErrorText("NETWORK")).toMatch(/Try again/);
  });
});
