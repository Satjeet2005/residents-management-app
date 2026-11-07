import { describe, expect, it } from "vitest";
import { type ActionAction, type ActionState, actionReducer, classifyAction, confirmBodyOf, initialActionState, isReasonValid } from "@/lib/complaint-actions";

const run = (actions: ActionAction[], from: ActionState = initialActionState) => actions.reduce(actionReducer, from);

describe("T13b the confirm and reopen state machine", () => {
  it("starts asking, with no rating, no reason and nothing busy", () => {
    expect(initialActionState).toEqual({ mode: "ASK", rating: null, reason: "", busy: false, reasonInvalid: false, error: null, done: null });
  });

  it("'Yes, it's fixed' goes to the optional rating; a rating can be chosen, changed and cleared by choosing it again", () => {
    const rate = run([{ type: "CHOOSE_FIXED" }]);
    expect(rate.mode).toBe("RATE");
    expect(run([{ type: "RATING_CHOSEN", value: 4 }], rate).rating).toBe(4);
    expect(run([{ type: "RATING_CHOSEN", value: 4 }, { type: "RATING_CHOSEN", value: 2 }], rate).rating).toBe(2);
    expect(run([{ type: "RATING_CHOSEN", value: 4 }, { type: "RATING_CHOSEN", value: 4 }], rate).rating).toBeNull();
  });

  it("a rating outside 1 to 5, or not whole, is ignored", () => {
    for (const value of [0, 6, 2.5, -1, Number.NaN]) expect(run([{ type: "RATING_CHOSEN", value }]).rating).toBeNull();
  });

  it("Done sends with the rating, or with none when it is skipped", () => {
    const rated = run([{ type: "CHOOSE_FIXED" }, { type: "RATING_CHOSEN", value: 5 }, { type: "SUBMIT" }]);
    expect(rated.busy).toBe(true);
    expect(confirmBodyOf(rated)).toEqual({ rating: 5 });
    const skipped = run([{ type: "CHOOSE_FIXED" }, { type: "SUBMIT" }]);
    expect(skipped.busy).toBe(true);
    expect(confirmBodyOf(skipped)).toEqual({});
  });

  it("'No, still a problem' needs a reason of 5 to 500 characters: 4 is refused with the inline error, 5 is sent", () => {
    const problem = run([{ type: "CHOOSE_PROBLEM" }]);
    const short = run([{ type: "REASON_CHANGED", value: "abcd" }, { type: "SUBMIT" }], problem);
    expect(short).toMatchObject({ busy: false, reasonInvalid: true });
    expect(run([{ type: "REASON_CHANGED", value: "abcde" }, { type: "SUBMIT" }], problem)).toMatchObject({ busy: true, reasonInvalid: false });
    expect(run([{ type: "REASON_CHANGED", value: "     a " }, { type: "SUBMIT" }], problem).busy).toBe(false);
  });

  it("the reason is cut at 500 characters, and typing clears the inline error", () => {
    const problem = run([{ type: "CHOOSE_PROBLEM" }, { type: "SUBMIT" }]);
    expect(problem.reasonInvalid).toBe(true);
    const typed = actionReducer(problem, { type: "REASON_CHANGED", value: "x".repeat(600) });
    expect(Array.from(typed.reason)).toHaveLength(500);
    expect(typed.reasonInvalid).toBe(false);
    expect(isReasonValid("x".repeat(500))).toBe(true);
  });

  it("a second SUBMIT or any other action while busy changes nothing (double submit blocked)", () => {
    const busy = run([{ type: "CHOOSE_FIXED" }, { type: "SUBMIT" }]);
    for (const action of [{ type: "SUBMIT" }, { type: "BACK" }, { type: "CHOOSE_PROBLEM" }, { type: "RATING_CHOSEN", value: 3 }] as ActionAction[]) expect(actionReducer(busy, action)).toBe(busy);
  });

  it("Back returns to the question and keeps what was written", () => {
    const back = run([{ type: "CHOOSE_PROBLEM" }, { type: "REASON_CHANGED", value: "still dripping" }, { type: "BACK" }]);
    expect(back).toMatchObject({ mode: "ASK", reason: "still dripping" });
  });

  it("a failure ends the busy state and keeps the person's input; success records what was done", () => {
    const failed = run([{ type: "CHOOSE_PROBLEM" }, { type: "REASON_CHANGED", value: "still dripping" }, { type: "SUBMIT" }, { type: "FAILED", error: "NETWORK" }]);
    expect(failed).toMatchObject({ busy: false, error: "NETWORK", reason: "still dripping", mode: "REASON" });
    expect(run([{ type: "SUBMIT" }, { type: "SUCCEEDED", done: "CONFIRMED" }], run([{ type: "CHOOSE_FIXED" }])).done).toBe("CONFIRMED");
  });

  it("SUBMIT from the question (no second step) does nothing", () => {
    expect(run([{ type: "SUBMIT" }])).toEqual(initialActionState);
  });
});

describe("T13b reading the answer of /confirm and /reopen", () => {
  it.each([
    [200, { kind: "OK" }],
    [409, { kind: "ERROR", error: "STALE" }],
    [422, { kind: "ERROR", error: "VALIDATION" }],
    [404, { kind: "ERROR", error: "NOT_FOUND" }],
    [500, { kind: "ERROR", error: "SERVER" }],
    [403, { kind: "ERROR", error: "SERVER" }],
  ])("%i is %j (409 covers STALE and INVALID_TRANSITION: a reload prompt)", (status, expected) => {
    expect(classifyAction(status)).toEqual(expected);
  });
});
