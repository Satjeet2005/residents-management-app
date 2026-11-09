import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CategoryChipsView } from "@/app/(staff)/staff/complaints/[id]/category-chips-view";
import { type ChipsState, initialChips, chipsReducer } from "@/lib/staff-complaints/category-chips";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {} }) }));

const noop = () => {};
const view = (state: ChipsState, closed = false) => renderToStaticMarkup(h(CategoryChipsView, { state, closed, handlers: { onTap: noop, onUndo: noop, onReload: noop } }));
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const buttons = (out: string) => out.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];

describe("CC3 the chips on the page (D239)", () => {
  it("five chips in the order Plumbing, Electrical, Housekeeping, Lift, Other, in a group named Category, with no Save button", () => {
    const out = view(initialChips("PLUMBING", 1));
    expect(words(out)).toBe("Plumbing Electrical Housekeeping Lift Other");
    expect(out).toMatch(/<div role="group" aria-label="Category" class="flex flex-wrap gap-2">/);
    expect(buttons(out)).toHaveLength(5);
    expect(out).not.toContain("Save");
  });

  it("each chip is at least 48px tall, with 8px between chips", () => {
    const out = view(initialChips("PLUMBING", 1));
    for (const button of buttons(out)) expect(button).toContain("min-h-12");
    expect(out).toContain("gap-2");
  });

  it("the current category is pressed with a 2px ink border and a paper-2 tint; the others are not pressed", () => {
    const out = view(initialChips("LIFT", 1));
    const pressed = buttons(out).filter((b) => b.includes('aria-pressed="true"'));
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toContain("Lift");
    expect(pressed[0]).toContain("border-2 border-ink bg-paper-2");
    expect(buttons(out).filter((b) => b.includes('aria-pressed="false"'))).toHaveLength(4);
  });

  it("a closed complaint has every chip aria-disabled", () => {
    const out = view(initialChips("LIFT", 1), true);
    expect(buttons(out).every((b) => b.includes('aria-disabled="true"'))).toBe(true);
    expect(view(initialChips("LIFT", 1))).not.toContain("aria-disabled");
  });

  it("after a change it says so in a live region and offers Undo; with no change there is no Undo", () => {
    const changed = chipsReducer(chipsReducer(initialChips("PLUMBING", 1), { type: "STARTED" }), { type: "CHANGED", to: "LIFT", from: "PLUMBING", version: 2, at: 0, undoable: true });
    const out = view(changed);
    expect(out).toContain('role="status" aria-live="polite"');
    expect(words(out)).toContain("Category changed to Lift.");
    expect(out).toMatch(/<button[^>]*>Undo<\/button>/);
    expect(view(initialChips("PLUMBING", 1))).not.toContain("Undo");
  });

  it("a stale answer says the complaint changed and offers Reload, and no Undo", () => {
    const stale = chipsReducer(chipsReducer(initialChips("PLUMBING", 1), { type: "STARTED" }), { type: "FAILED", error: "STALE" });
    const out = view(stale);
    expect(words(out)).toContain("This complaint changed. Reload to see it.");
    expect(out).toMatch(/<button[^>]*>Reload<\/button>/);
    expect(out).not.toContain("Undo");
  });
});
