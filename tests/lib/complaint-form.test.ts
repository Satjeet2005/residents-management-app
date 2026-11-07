import { describe, expect, it } from "vitest";
import { COMPLAINT_BODY_MAX } from "@/domain/complaints/body";
import { type ComplaintFormAction, type ComplaintFormState, charCount, classifyCreate, complaintFormReducer, fieldErrorsOf, initialComplaintForm, readyToSend, requestBodyOf } from "@/lib/complaint-form";

const run = (actions: ComplaintFormAction[], from: ComplaintFormState = initialComplaintForm) => actions.reduce(complaintFormReducer, from);
const UUID = "0b8f1f3a-0000-4000-8000-000000000001";

describe("D127 the form starts with no answer to the danger question", () => {
  it("D127 the initial state has no danger answer, no text, nothing busy and no errors", () => {
    expect(initialComplaintForm).toEqual({ body: "", danger: null, busy: false, fieldErrors: [], submitError: null });
  });

  it("D127 submitting without an answer shows the inline error and does not start sending", () => {
    const state = run([{ type: "BODY_CHANGED", value: "Water leak" }, { type: "SUBMIT" }]);
    expect(state.busy).toBe(false);
    expect(state.fieldErrors).toEqual(["DANGER_REQUIRED"]);
  });

  it("D127 an empty text and no answer shows both errors, the text one first", () => {
    expect(run([{ type: "SUBMIT" }]).fieldErrors).toEqual(["BODY_REQUIRED", "DANGER_REQUIRED"]);
  });

  it("D127 answering No with no text is refused; answering Yes with no text is allowed (D121)", () => {
    expect(run([{ type: "DANGER_CHOSEN", value: "NO" }, { type: "SUBMIT" }])).toMatchObject({ busy: false, fieldErrors: ["BODY_REQUIRED"] });
    expect(run([{ type: "DANGER_CHOSEN", value: "YES" }, { type: "SUBMIT" }])).toMatchObject({ busy: true, fieldErrors: [] });
  });

  it("D127 a blank text of spaces is not text", () => {
    expect(fieldErrorsOf({ body: "  \n ", danger: "NO" })).toEqual(["BODY_REQUIRED"]);
  });

  it("D127 choosing an answer or typing clears the matching error and keeps the other", () => {
    const refused = run([{ type: "SUBMIT" }]);
    expect(complaintFormReducer(refused, { type: "DANGER_CHOSEN", value: "NO" }).fieldErrors).toEqual(["BODY_REQUIRED"]);
    expect(complaintFormReducer(refused, { type: "BODY_CHANGED", value: "x" }).fieldErrors).toEqual(["DANGER_REQUIRED"]);
  });

  it("D127 choosing Yes removes a text error too, because Yes does not need text", () => {
    const refused = run([{ type: "SUBMIT" }]);
    expect(complaintFormReducer(refused, { type: "DANGER_CHOSEN", value: "YES" }).fieldErrors).toEqual([]);
  });
});

describe("T13b sending", () => {
  const ready = run([{ type: "BODY_CHANGED", value: "Water leak" }, { type: "DANGER_CHOSEN", value: "NO" }]);

  it("a valid form becomes busy, and a second SUBMIT while busy changes nothing (double submit blocked)", () => {
    const busy = complaintFormReducer(ready, { type: "SUBMIT" });
    expect(busy.busy).toBe(true);
    expect(complaintFormReducer(busy, { type: "SUBMIT" })).toBe(busy);
  });

  it("a failure ends the busy state and keeps what the person wrote and chose", () => {
    const failed = run([{ type: "SUBMIT" }, { type: "SUBMIT_FAILED", error: "NETWORK" }], ready);
    expect(failed).toMatchObject({ busy: false, submitError: "NETWORK", body: "Water leak", danger: "NO" });
    expect(complaintFormReducer(failed, { type: "BODY_CHANGED", value: "Water leak 2" }).submitError).toBeNull();
  });

  it("readyToSend follows the field rules", () => {
    expect(readyToSend(initialComplaintForm)).toBe(false);
    expect(readyToSend(ready)).toBe(true);
  });

  it("the request carries the text as written and declaredDanger true only for Yes", () => {
    expect(requestBodyOf({ body: "Water leak", danger: "NO" })).toEqual({ body: "Water leak", declaredDanger: false });
    expect(requestBodyOf({ body: "", danger: "YES" })).toEqual({ body: "", declaredDanger: true });
  });

  it("the text is cut at 2,000 characters, counted as characters (a Devanagari text of 2,001 is cut to 2,000)", () => {
    const long = run([{ type: "BODY_CHANGED", value: "आ".repeat(COMPLAINT_BODY_MAX + 1) }]);
    expect(charCount(long.body)).toBe(COMPLAINT_BODY_MAX);
    expect(run([{ type: "BODY_CHANGED", value: "x".repeat(COMPLAINT_BODY_MAX) }]).body).toHaveLength(COMPLAINT_BODY_MAX);
  });
});

describe("T13b reading the answer of POST /api/complaints", () => {
  it.each([
    [201, { status: "OK", complaint: { id: UUID } }, { kind: "CREATED", id: UUID }],
    [200, { status: "OK", duplicate: true, complaint: { id: UUID } }, { kind: "CREATED", id: UUID }],
    [201, { complaint: { id: "../evil" } }, { kind: "ERROR", error: "SERVER" }],
    [201, null, { kind: "ERROR", error: "SERVER" }],
    [422, { error: "VALIDATION" }, { kind: "ERROR", error: "VALIDATION" }],
    [422, { error: "NO_FLAT" }, { kind: "ERROR", error: "NO_FLAT" }],
    [429, null, { kind: "ERROR", error: "RATE_LIMITED" }],
    [500, { error: "x" }, { kind: "ERROR", error: "SERVER" }],
    [403, { error: "CSRF_BLOCKED" }, { kind: "ERROR", error: "SERVER" }],
  ])("%i %j is %j", (status, json, expected) => {
    expect(classifyCreate(status, json)).toEqual(expected);
  });
});
