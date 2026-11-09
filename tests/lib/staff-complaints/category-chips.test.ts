import { describe, expect, it } from "vitest";
import { CATEGORY_CODES } from "@/domain/complaints/taxonomy";
import { CHIP_CODES, type ChipsState, UNDO_MS, chipState, chipsReducer, initialChips, tapSends } from "@/lib/staff-complaints/category-chips";

const AT = 1_000_000;
const changed = (state: ChipsState, over: Partial<Extract<Parameters<typeof chipsReducer>[1], { type: "CHANGED" }>> = {}) =>
  chipsReducer(chipsReducer(state, { type: "STARTED" }), { type: "CHANGED", to: "LIFT", from: "PLUMBING", version: 3, at: AT, undoable: true, ...over });

describe("CC1 the chips (D239): which chip is pressed and which taps send", () => {
  it("there are five chips, the five categories of the taxonomy, in its order", () => {
    expect(CHIP_CODES).toEqual(CATEGORY_CODES);
    expect(CHIP_CODES).toHaveLength(5);
  });

  it("the complaint's category is pressed and no other", () => {
    const pressed = CHIP_CODES.filter((code) => chipState({ code, current: "LIFT", closed: false, pending: false }).pressed);
    expect(pressed).toEqual(["LIFT"]);
    expect(CHIP_CODES.filter((code) => chipState({ code, current: null, closed: false, pending: false }).pressed)).toEqual([]);
  });

  it("a closed complaint has every chip disabled, the pressed one too; so has a change in flight", () => {
    for (const code of CHIP_CODES) {
      expect(chipState({ code, current: "LIFT", closed: true, pending: false }).disabled).toBe(true);
      expect(chipState({ code, current: "LIFT", closed: false, pending: true }).disabled).toBe(true);
      expect(chipState({ code, current: "LIFT", closed: false, pending: false }).disabled).toBe(false);
    }
  });

  it("a tap sends only for a different chip on an open complaint with nothing in flight", () => {
    expect(tapSends({ code: "OTHER", current: "LIFT", closed: false, pending: false })).toBe(true);
    expect(tapSends({ code: "OTHER", current: null, closed: false, pending: false })).toBe(true);
    expect(tapSends({ code: "LIFT", current: "LIFT", closed: false, pending: false })).toBe(false);
    expect(tapSends({ code: "OTHER", current: "LIFT", closed: true, pending: false })).toBe(false);
    expect(tapSends({ code: "OTHER", current: "LIFT", closed: false, pending: true })).toBe(false);
  });
});

describe("CC2 the chips reducer: the change, the version and the six-second undo", () => {
  const start = initialChips("PLUMBING", 2);

  it("a change shows the new category, takes the version of the answer and opens an Undo for the category before", () => {
    const state = changed(start);
    expect(state).toMatchObject({ category: "LIFT", version: 3, pending: false, message: { kind: "CHANGED", category: "LIFT" } });
    expect(state.undo).toEqual({ previous: "PLUMBING", until: AT + UNDO_MS });
    expect(UNDO_MS).toBe(6000);
  });

  it("Undo restores the category before, and the change that undoes has no Undo of its own", () => {
    const first = changed(start);
    const undone = changed(first, { to: first.undo!.previous, from: first.category, version: 4, at: AT + 2000, undoable: false });
    expect(undone).toMatchObject({ category: "PLUMBING", version: 4, undo: null, message: { kind: "CHANGED", category: "PLUMBING" } });
  });

  it("no Undo when there was no category before (or a word that is not a category)", () => {
    expect(changed(initialChips(null, 1), { from: null }).undo).toBeNull();
    expect(changed(start, { from: "WEATHER" }).undo).toBeNull();
  });

  it("the window closes at six seconds: an earlier expiry changes nothing, the right one removes the Undo", () => {
    const state = changed(start);
    expect(chipsReducer(state, { type: "EXPIRED", at: AT + UNDO_MS - 1 })).toBe(state);
    expect(chipsReducer(state, { type: "EXPIRED", at: AT + UNDO_MS }).undo).toBeNull();
    expect(chipsReducer(state, { type: "EXPIRED", at: AT + UNDO_MS }).category).toBe("LIFT");
  });

  it("a second tap while one change is in flight is ignored", () => {
    const sending = chipsReducer(start, { type: "STARTED" });
    expect(sending.pending).toBe(true);
    expect(chipsReducer(sending, { type: "STARTED" })).toBe(sending);
  });

  it("a refusal keeps the category, ends the wait, says why and removes the Undo", () => {
    const failed = chipsReducer(changed(start), { type: "FAILED", error: "STALE" });
    expect(failed).toMatchObject({ category: "LIFT", pending: false, undo: null, message: { kind: "ERROR", error: "STALE" } });
  });

  it("after a reload a newer version of the page replaces the state; an older or equal one does not", () => {
    expect(chipsReducer(start, { type: "PAGE_CHANGED", category: "OTHER", version: 5 })).toMatchObject({ category: "OTHER", version: 5, message: null, undo: null });
    expect(chipsReducer(start, { type: "PAGE_CHANGED", category: "OTHER", version: 2 })).toBe(start);
    const sending = chipsReducer(start, { type: "STARTED" });
    expect(chipsReducer(sending, { type: "PAGE_CHANGED", category: "OTHER", version: 9 })).toBe(sending);
  });
});
