import { describe, expect, it } from "vitest";
import { COMMENT_MAX, NOTE_MAX, type PanelAction, type PanelState, classifyPanelResponse, initialPanelState, isComplete, panelReducer, requestOf } from "@/lib/staff-complaints/panel";

const run = (events: Parameters<typeof panelReducer>[1][], from: PanelState = initialPanelState): PanelState => events.reduce(panelReducer, from);
const fill = (field: "assigneeId" | "commentText" | "resolveNote" | "closeNote", value: string) => ({ type: "FIELD", field, value }) as const;

describe("SC12 the action panel reducer", () => {
  it("starts empty, with the resident-visibility box OFF", () => {
    expect(initialPanelState.commentVisible).toBe(false);
    expect(initialPanelState.pending).toBeNull();
    expect(initialPanelState.done).toBeNull();
  });

  it("an action with an empty form is refused before anything is sent, and says which form", () => {
    for (const action of ["ASSIGN", "COMMENT", "RESOLVE", "CLOSE"] as PanelAction[]) {
      const state = run([{ type: "SUBMIT", action }]);
      expect(state.invalid, action).toBe(action);
      expect(state.pending, action).toBeNull();
    }
  });

  it("START and ACKNOWLEDGE have no form and go straight to pending", () => {
    expect(run([{ type: "SUBMIT", action: "START" }]).pending).toBe("START");
    expect(run([{ type: "SUBMIT", action: "ACKNOWLEDGE" }]).pending).toBe("ACKNOWLEDGE");
  });

  it("a complete form goes to pending and clears the inline error", () => {
    const state = run([{ type: "SUBMIT", action: "COMMENT" }, fill("commentText", "Plumber booked"), { type: "SUBMIT", action: "COMMENT" }]);
    expect(state.pending).toBe("COMMENT");
    expect(state.invalid).toBeNull();
  });

  it("double submit is blocked: while one action is in flight every other event is ignored until the answer", () => {
    const sending = run([fill("assigneeId", "u1"), { type: "SUBMIT", action: "ASSIGN" }]);
    expect(sending.pending).toBe("ASSIGN");
    expect(panelReducer(sending, { type: "SUBMIT", action: "START" })).toBe(sending);
    expect(panelReducer(sending, { type: "SUBMIT", action: "ASSIGN" })).toBe(sending);
    expect(panelReducer(sending, fill("commentText", "x"))).toBe(sending);
    expect(panelReducer(sending, { type: "VISIBLE_TOGGLED" })).toBe(sending);
    expect(panelReducer(sending, { type: "NOTE_OPENED", form: "CLOSE" })).toBe(sending);
  });

  it("success clears that action's form, keeps what it changed for the confirmation, and ends the wait", () => {
    const state = run([fill("commentText", "Done"), { type: "VISIBLE_TOGGLED" }, { type: "SUBMIT", action: "COMMENT" }, { type: "SUCCEEDED", subject: null }]);
    expect(state).toMatchObject({ pending: null, commentText: "", commentVisible: false, done: { action: "COMMENT", subject: null }, error: null });
    const assigned = run([fill("assigneeId", "u1"), { type: "SUBMIT", action: "ASSIGN" }, { type: "SUCCEEDED", subject: "Kavita Rao" }]);
    expect(assigned).toMatchObject({ assigneeId: "", done: { action: "ASSIGN", subject: "Kavita Rao" } });
  });

  it("a failure keeps what was written, names the action and the error, and allows another try", () => {
    const failed = run([fill("commentText", "Keep me"), { type: "SUBMIT", action: "COMMENT" }, { type: "FAILED", error: "NETWORK" }]);
    expect(failed).toMatchObject({ pending: null, commentText: "Keep me", error: { action: "COMMENT", error: "NETWORK" } });
    expect(panelReducer(failed, { type: "SUBMIT", action: "COMMENT" }).pending).toBe("COMMENT");
  });

  it("dismissing clears the error, the confirmation and the inline error, and keeps what was written", () => {
    const failed = run([fill("commentText", "Keep me"), { type: "SUBMIT", action: "COMMENT" }, { type: "FAILED", error: "STALE" }]);
    expect(panelReducer(failed, { type: "DISMISSED" })).toMatchObject({ error: null, done: null, invalid: null, commentText: "Keep me" });
  });

  it("an answer with nothing in flight changes nothing", () => {
    expect(panelReducer(initialPanelState, { type: "SUCCEEDED", subject: null })).toBe(initialPanelState);
    expect(panelReducer(initialPanelState, { type: "FAILED", error: "SERVER" })).toBe(initialPanelState);
  });

  it("the resolve and close notes open a form first, need 5 to 500 characters, and close again on success", () => {
    const opened = run([{ type: "NOTE_OPENED", form: "RESOLVE" }]);
    expect(opened.noteOpen).toBe("RESOLVE");
    expect(run([fill("resolveNote", "abcd"), { type: "SUBMIT", action: "RESOLVE" }], opened).invalid).toBe("RESOLVE");
    expect(run([fill("resolveNote", "  abcd  "), { type: "SUBMIT", action: "RESOLVE" }], opened).invalid).toBe("RESOLVE");
    const sent = run([fill("resolveNote", "Pipe replaced"), { type: "SUBMIT", action: "RESOLVE" }, { type: "SUCCEEDED", subject: null }], opened);
    expect(sent).toMatchObject({ noteOpen: null, resolveNote: "", done: { action: "RESOLVE" } });
    expect(run([{ type: "NOTE_CLOSED" }], opened).noteOpen).toBeNull();
    expect(run([{ type: "NOTE_OPENED", form: "CLOSE" }, fill("closeNote", "Checked"), { type: "SUBMIT", action: "CLOSE" }]).pending).toBe("CLOSE");
  });

  it("text is cut at its limit, by characters", () => {
    expect(run([fill("commentText", "a".repeat(COMMENT_MAX + 50))]).commentText).toHaveLength(COMMENT_MAX);
    expect(Array.from(run([fill("closeNote", "नमस्ते".repeat(200))]).closeNote)).toHaveLength(NOTE_MAX);
  });

  it("a blank comment is incomplete; whitespace does not count", () => {
    expect(isComplete({ ...initialPanelState, commentText: "   \n " }, "COMMENT")).toBe(false);
    expect(isComplete({ ...initialPanelState, commentText: " a " }, "COMMENT")).toBe(true);
  });

  it("the panel has no category action any more: the chips of the Details tab change the category (D239)", () => {
    expect(Object.keys(initialPanelState)).not.toContain("category");
  });
});

describe("SC13 what each action sends", () => {
  const state = (over: Partial<PanelState>): PanelState => ({ ...initialPanelState, ...over });

  it.each([
    ["ASSIGN", state({ assigneeId: "u1" }), { path: "assign", body: { assigneeUserId: "u1", expectedVersion: 4 } }],
    ["START", state({}), { path: "status", body: { status: "IN_PROGRESS", expectedVersion: 4 } }],
    ["RESOLVE", state({ resolveNote: "  Pipe replaced " }), { path: "status", body: { status: "PENDING_CONFIRMATION", note: "Pipe replaced", expectedVersion: 4 } }],
    ["ACKNOWLEDGE", state({}), { path: "acknowledge", body: {} }],
    ["CLOSE", state({ closeNote: " Gas isolated " }), { path: "close", body: { note: "Gas isolated" } }],
  ] as [PanelAction, PanelState, ReturnType<typeof requestOf>][])("%s", (action, from, expected) => {
    expect(requestOf(action, from, 4)).toEqual(expected);
  });

  it("a comment is internal unless the box is ticked: visibleToResident is exactly the box", () => {
    expect(requestOf("COMMENT", state({ commentText: " Plumber booked " }), 4)).toEqual({ path: "comment", body: { text: "Plumber booked", visibleToResident: false } });
    expect(requestOf("COMMENT", state({ commentText: "Plumber booked", commentVisible: true }), 4).body.visibleToResident).toBe(true);
    const ticked = run([{ type: "VISIBLE_TOGGLED" }, { type: "VISIBLE_TOGGLED" }]);
    expect(requestOf("COMMENT", { ...ticked, commentText: "x" }, 4).body.visibleToResident).toBe(false);
  });

  it("the actions that change the complaint carry the version they were shown with; a comment and an acknowledgement do not", () => {
    for (const action of ["ASSIGN", "START", "RESOLVE"] as PanelAction[]) expect(requestOf(action, state({}), 9).body.expectedVersion, action).toBe(9);
    for (const action of ["COMMENT", "ACKNOWLEDGE", "CLOSE"] as PanelAction[]) expect(requestOf(action, state({}), 9).body, action).not.toHaveProperty("expectedVersion");
  });
});

describe("SC14 what an answer means", () => {
  it.each([
    [200, null, "OK"],
    [409, "STALE", "STALE"],
    [409, "INVALID_TRANSITION", "STALE"],
    [403, "FORBIDDEN", "FORBIDDEN"],
    [401, null, "FORBIDDEN"],
    [404, "NOT_FOUND", "NOT_FOUND"],
    [422, "ASSIGNEE_INVALID", "ASSIGNEE_INVALID"],
    [422, "VALIDATION", "VALIDATION"],
    [422, null, "VALIDATION"],
    [500, null, "SERVER"],
    [503, "x", "SERVER"],
  ] as const)("%s %s is %s", (status, code, expected) => {
    expect(classifyPanelResponse(status, code)).toBe(expected);
  });
});
