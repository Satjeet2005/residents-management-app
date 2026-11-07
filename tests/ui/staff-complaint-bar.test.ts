import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActionsBar } from "@/app/(staff)/staff/complaints/[id]/actions-bar";
import { PanelView } from "@/app/(staff)/staff/complaints/[id]/panel-view";
import { controlsFor } from "@/lib/staff-complaints/controls";
import { initialPanelState } from "@/lib/staff-complaints/panel";
import { barKind } from "@/lib/staff-complaints/primary-bar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const staffUsers = [{ id: "u1", name: "Kavita Rao" }, { id: "u2", name: "Sanjay Pawar" }];

function bar(input: { viewer: { canManage: boolean; isDutyManager: boolean }; safety: boolean; acknowledged: boolean; status?: "ASSIGNED" | "CLOSED" | "NEW" }): string {
  const status = input.status ?? "ASSIGNED";
  const kind = barKind({ status, safety: input.safety, acknowledged: input.acknowledged, viewer: input.viewer });
  if (kind === "NONE") return "";
  return html(h(ActionsBar, { id: "b0000000-0000-4000-8000-000000000001", version: 2, kind, controls: controlsFor({ status, safety: input.safety, acknowledged: input.acknowledged, viewer: input.viewer }), staffUsers, currentCategory: "PLUMBING", needsReview: false }));
}
const barOnly = (out: string) => out.slice(out.indexOf("fixed inset-x-0"), out.indexOf("<dialog"));

describe("SBAR1 the pinned bar", () => {
  const duty = bar({ viewer: { canManage: true, isDutyManager: true }, safety: true, acknowledged: false });

  it("is fixed to the bottom with the safe-area inset, only below 1024px, and has no text input", () => {
    const only = barOnly(duty);
    expect(only).toContain("fixed inset-x-0 bottom-0");
    expect(only).toContain("pb-[max(0.75rem,env(safe-area-inset-bottom))]");
    expect(only).toContain("lg:hidden");
    expect(only).not.toMatch(/<(input|textarea|select)/);
  });

  it("the duty manager on an unacknowledged safety complaint has 'I have seen this' as the ONLY filled control, and an outlined More", () => {
    const only = barOnly(duty);
    expect(count(only, /bg-accent/g)).toBe(1);
    expect(only).toMatch(/<button[^>]*bg-accent[^>]*min-h-12[^>]*>I have seen this<\/button>|<button[^>]*min-h-12[^>]*bg-accent[^>]*>I have seen this<\/button>/);
    expect(only).toMatch(/<button[^>]*border-control[^>]*aria-haspopup="dialog"[^>]*>More<\/button>/);
    expect(only).not.toContain(">Update<");
  });

  it("a plain manager has an outlined Update and never the duty manager's control, even on an unacknowledged safety complaint", () => {
    const out = bar({ viewer: { canManage: true, isDutyManager: false }, safety: true, acknowledged: false });
    expect(barOnly(out)).toMatch(/<button[^>]*border-control[^>]*>Update<\/button>/);
    expect(out).not.toContain("I have seen this");
    expect(out).not.toContain("Close this safety complaint");
    expect(count(out, /bg-accent/g)).toBe(0);
  });

  it("the duty manager on an acknowledged safety complaint has Update", () => {
    const out = bar({ viewer: { canManage: true, isDutyManager: true }, safety: true, acknowledged: true });
    expect(barOnly(out)).toContain(">Update<");
    expect(barOnly(out)).not.toContain("I have seen this");
    expect(count(barOnly(out), /bg-accent/g)).toBe(0);
  });

  it("a closed complaint and a user without complaints:manage have no bar at all", () => {
    expect(bar({ viewer: { canManage: true, isDutyManager: true }, safety: true, acknowledged: false, status: "CLOSED" })).toBe("");
    expect(bar({ viewer: { canManage: false, isDutyManager: false }, safety: false, acknowledged: false })).toBe("");
  });

  it("has a live region for what changed", () => {
    expect(barOnly(duty)).toMatch(/<div role="status"/);
  });
});

describe("SBAR2 the actions sheet", () => {
  const sheet = (out: string) => out.slice(out.indexOf("<dialog"));

  it("is a short menu of outlined 48px rows for a plain manager: Assign, Mark in progress, Mark resolved, Add comment, Correct category", () => {
    const out = sheet(bar({ viewer: { canManage: true, isDutyManager: false }, safety: false, acknowledged: false, status: "NEW" }));
    expect(out).toContain("Update this complaint");
    const rows = ["Assign", "Mark in progress", "Mark resolved", "Add comment", "Correct category"].map((label) => out.indexOf(`>${label}</button>`));
    expect([...rows].sort((a, b) => a - b)).toEqual(rows);
    expect(rows.every((p) => p > 0)).toBe(true);
    expect(out).not.toContain("Close this safety complaint");
    expect(out).not.toContain("bg-accent");
    expect(out).not.toMatch(/<(input|textarea|select)/);
  });

  it("for the duty manager on a safety complaint it has Close this safety complaint and never Mark resolved", () => {
    const out = sheet(bar({ viewer: { canManage: true, isDutyManager: true }, safety: true, acknowledged: false }));
    expect(out).toContain(">Close this safety complaint</button>");
    expect(out).not.toContain("Mark resolved");
    expect(out).not.toContain("I have seen this");
  });
});

describe("SBAR3 the form inside the sheet", () => {
  const form = (only: Parameters<typeof controlsFor>[0], extra: { comment?: boolean } = {}) =>
    html(
      h(PanelView, {
        idPrefix: "sheet-",
        state: { ...initialPanelState, commentVisible: extra.comment ?? false },
        controls: { assign: false, start: false, resolve: false, comment: true, category: false, acknowledge: false, close: false },
        staffUsers,
        currentCategory: "PLUMBING",
        needsReview: false,
        handlers: { onField: () => {}, onToggleVisible: () => {}, onOpenNote: () => {}, onCloseNote: () => {}, onSubmit: () => {}, onReload: () => {} },
      }),
    );

  it("the comment form has 'Visible to the resident' UNCHECKED by default, and its ids carry the prefix", () => {
    const out = form({ status: "ASSIGNED", safety: false, acknowledged: false, viewer: { canManage: true, isDutyManager: false } });
    expect(out).toMatch(/<input id="sheet-comment-visible" type="checkbox"(?![^>]*checked)/);
    expect(out).toContain('for="sheet-comment-visible"');
    expect(out).toContain('id="sheet-comment-text"');
    expect(out).not.toContain('id="comment-text"');
    expect(words(out)).toContain("Only staff will see this comment.");
  });

  it("without a prefix the ids are the plain ones, as in the side panel", () => {
    const out = html(h(PanelView, { state: initialPanelState, controls: { assign: false, start: false, resolve: false, comment: true, category: false, acknowledge: false, close: false }, staffUsers, currentCategory: null, needsReview: false, handlers: { onField: () => {}, onToggleVisible: () => {}, onOpenNote: () => {}, onCloseNote: () => {}, onSubmit: () => {}, onReload: () => {} } }));
    expect(out).toContain('id="comment-text"');
  });
});
