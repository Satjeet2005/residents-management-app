import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComplaintView } from "@/app/(staff)/staff/complaints/[id]/complaint-view";
import { type PanelHandlers, PanelView, doneText, errorText } from "@/app/(staff)/staff/complaints/[id]/panel-view";
import { type Controls, controlsFor } from "@/lib/staff-complaints/controls";
import { type PanelAction, type PanelError, type PanelState, initialPanelState, panelReducer } from "@/lib/staff-complaints/panel";
import { staffTimeline } from "@/lib/staff-complaints/timeline";
import type { ComplaintPage } from "@/server/complaints/staff-page-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const noop = () => {};
const handlers: PanelHandlers = { onField: noop, onToggleVisible: noop, onOpenNote: noop, onCloseNote: noop, onSubmit: noop, onReload: noop };
const staffUsers = [{ id: "u1", name: "Kavita Rao" }, { id: "u2", name: "Sanjay Pawar" }];
const ordinary = controlsFor({ status: "ASSIGNED", safety: false, acknowledged: false, viewer: { canManage: true, isDutyManager: false } });
const render = (over: { state?: Partial<PanelState>; controls?: Controls; currentCategory?: string | null; needsReview?: boolean } = {}) =>
  html(h(PanelView, { state: { ...initialPanelState, ...over.state }, controls: over.controls ?? ordinary, staffUsers, currentCategory: over.currentCategory === undefined ? "PLUMBING" : over.currentCategory, needsReview: over.needsReview ?? false, handlers }));
const run = (...events: Parameters<typeof panelReducer>[1][]) => events.reduce(panelReducer, initialPanelState);

describe("SA1 the panel for an ordinary complaint", () => {
  const out = render();
  const text = words(out);

  it("has the four sections, each with a heading", () => {
    for (const title of ["Assign", "Status", "Comment", "Correct the category"]) expect(out).toMatch(new RegExp(`<h3[^>]*>${title}</h3>`));
  });

  it("assign: a select of the active staff, a placeholder first, and an Assign button", () => {
    expect(out).toMatch(/<select[^>]*id="assign-select"/);
    expect(text).toContain("Choose a person Kavita Rao Sanjay Pawar");
    expect(out).toMatch(/<button[^>]*>Assign<\/button>/);
  });

  it("status: Mark in progress and Mark resolved, and no note form until Mark resolved is chosen", () => {
    expect(out).toMatch(/<button[^>]*>Mark in progress<\/button>/);
    expect(out).toMatch(/<button[^>]*>Mark resolved<\/button>/);
    expect(out).not.toContain("resolve-note");
  });

  it("comment: a text field, the 'Visible to the resident' box UNCHECKED, and Post comment", () => {
    expect(out).toMatch(/<textarea[^>]*id="comment-text"/);
    expect(out).toMatch(/<input[^>]*id="comment-visible"[^>]*type="checkbox"/);
    expect(out).not.toMatch(/<input[^>]*id="comment-visible"[^>]*checked/);
    expect(text).toContain("Visible to the resident");
    expect(text).toContain("Only staff will see this comment.");
    expect(out).toMatch(/<button[^>]*>Post comment<\/button>/);
  });

  it("category: the current category in words, a select of the five categories and Save category", () => {
    expect(text).toContain("Now: Plumbing");
    expect(text).toContain("Choose a category Plumbing Electrical Housekeeping Lift Other");
    expect(out).toMatch(/<button[^>]*>Save category<\/button>/);
  });

  it("every control is 48px tall at least, and NOT ONE is filled", () => {
    expect(out).not.toContain("bg-accent");
    for (const button of out.match(/<button[^>]*>/g) ?? []) expect(button).toContain("min-h-12");
    for (const select of out.match(/<select[^>]*>/g) ?? []) expect(select).toContain("min-h-12");
    expect(out).toContain('<label for="comment-visible" class="flex min-h-12');
  });

  it("every field has a label tied to it", () => {
    for (const id of ["assign-select", "comment-text", "category-select"]) expect(out).toContain(`for="${id}"`);
  });
});

describe("SA2 which sections appear", () => {
  const sections = (controls: Controls) => ["Assign", "Status", "Comment", "Correct the category"].filter((title) => render({ controls }).includes(`>${title}</h3>`));

  it("a complaint waiting for the resident offers a comment and a category only", () => {
    expect(sections(controlsFor({ status: "PENDING_CONFIRMATION", safety: false, acknowledged: false, viewer: { canManage: true, isDutyManager: false } }))).toEqual(["Comment", "Correct the category"]);
  });

  it("a closed complaint offers a comment and a category only", () => {
    expect(sections(controlsFor({ status: "CLOSED", safety: false, acknowledged: false, viewer: { canManage: true, isDutyManager: false } }))).toEqual(["Comment", "Correct the category"]);
  });

  it("a safety complaint offers Mark in progress and never Mark resolved, even to the duty manager", () => {
    for (const isDutyManager of [false, true]) {
      const out = render({ controls: controlsFor({ status: "ASSIGNED", safety: true, acknowledged: false, viewer: { canManage: true, isDutyManager } }) });
      expect(out).toContain(">Mark in progress</button>");
      expect(out).not.toContain("Mark resolved");
    }
  });

  it("an IN_PROGRESS complaint cannot be started again", () => {
    const out = render({ controls: controlsFor({ status: "IN_PROGRESS", safety: false, acknowledged: false, viewer: { canManage: true, isDutyManager: false } }) });
    expect(out).not.toContain("Mark in progress");
    expect(out).toContain(">Mark resolved</button>");
  });

  it("a person who may not manage is offered nothing but the empty result region", () => {
    const out = render({ controls: controlsFor({ status: "ASSIGNED", safety: false, acknowledged: false, viewer: { canManage: false, isDutyManager: false } }) });
    expect(out).not.toContain("<button");
    expect(out).not.toContain("<h3");
  });
});

describe("SA3 states of the panel", () => {
  it("Mark resolved asks for a note first: the note box, its count and hint, a Mark resolved send button and Cancel", () => {
    const out = render({ state: { noteOpen: "RESOLVE" } });
    expect(out).toMatch(/<textarea[^>]*id="resolve-note"/);
    expect(words(out)).toContain("Note for the record");
    expect(words(out)).toContain("0 of 500");
    expect(count(out, />Mark resolved<\/button>/g)).toBe(1);
    expect(out).toContain(">Cancel</button>");
    expect(out).toContain('for="resolve-note"');
  });

  it("an empty submit shows the inline error tied to its field with aria-invalid", () => {
    const comment = render({ state: run({ type: "SUBMIT", action: "COMMENT" }) });
    expect(words(comment)).toContain("Write a comment before you post it.");
    expect(comment).toMatch(/<textarea[^>]*aria-invalid="true"[^>]*aria-describedby="comment-error"/);
    const assign = render({ state: run({ type: "SUBMIT", action: "ASSIGN" }) });
    expect(words(assign)).toContain("Choose a person to assign it to.");
    expect(assign).toMatch(/<select[^>]*aria-invalid="true"/);
    const note = render({ state: run({ type: "NOTE_OPENED", form: "RESOLVE" }, { type: "SUBMIT", action: "RESOLVE" }) });
    expect(words(note)).toContain("Write a note of 5 to 500 characters.");
  });

  it("while an action is in flight its own button says Working and every control that could start another is off", () => {
    const out = render({ state: run({ type: "FIELD", field: "assigneeId", value: "u1" }, { type: "SUBMIT", action: "ASSIGN" }) });
    expect(out).toMatch(/<button[^>]*aria-busy="true"[^>]*>Working<\/button>/);
    expect(count(out, /disabled=""/g)).toBeGreaterThanOrEqual(6);
    expect(out).toMatch(/<select[^>]*id="assign-select"[^>]*disabled=""/);
    expect(out).toMatch(/<textarea[^>]*id="comment-text"[^>]*disabled=""/);
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Mark in progress<\/button>/);
  });

  it("a ticked box says the resident will see the comment", () => {
    const out = render({ state: { commentVisible: true } });
    expect(out).toMatch(/<input[^>]*id="comment-visible"[^>]*checked/);
    expect(words(out)).toContain("The resident will see this comment.");
  });

  it("Save category is off when the chosen category is the one it has (and on when the complaint needs review)", () => {
    expect(render({ state: { category: "PLUMBING" } })).toMatch(/<button[^>]*disabled=""[^>]*>Save category<\/button>/);
    expect(render({ state: { category: "LIFT" } })).not.toMatch(/<button[^>]*disabled=""[^>]*>Save category<\/button>/);
    expect(render({ state: { category: "PLUMBING" }, needsReview: true })).not.toMatch(/<button[^>]*disabled=""[^>]*>Save category<\/button>/);
    expect(words(render({ currentCategory: null }))).toContain("Now: No category");
  });

  it("the result region is a live region, focusable, and says what changed after a success", () => {
    const out = render({ state: { done: { action: "ASSIGN", subject: "Kavita Rao" } } });
    expect(out).toMatch(/<div[^>]*tabindex="-1"[^>]*role="status"/);
    expect(words(out)).toContain("Assigned to Kavita Rao.");
  });

  it("a changed complaint (409) says so, as an alert, with a Reload button", () => {
    const out = render({ state: { error: { action: "START", error: "STALE" } } });
    expect(out).toMatch(/<div[^>]*role="alert"/);
    expect(words(out)).toContain("This complaint changed. Reload to see it.");
    expect(out).toMatch(/<button[^>]*>Reload<\/button>/);
  });

  it.each(["FORBIDDEN", "NOT_FOUND", "ASSIGNEE_INVALID", "VALIDATION", "NETWORK", "SERVER"] as PanelError[])("the error %s is a plain sentence with no Reload button", (error) => {
    const out = render({ state: { error: { action: "COMMENT", error } } });
    expect(words(out)).toContain(errorText(error));
    expect(out).not.toContain(">Reload<");
  });
});

describe("SA4 the words of the confirmations and the errors", () => {
  it.each([
    [{ action: "ASSIGN", subject: "Kavita Rao" }, "Assigned to Kavita Rao."],
    [{ action: "START", subject: null }, "Marked in progress."],
    [{ action: "RESOLVE", subject: null }, "Marked resolved. The resident is asked to confirm."],
    [{ action: "COMMENT", subject: "visible" }, "Comment posted. The resident can see it."],
    [{ action: "COMMENT", subject: "internal" }, "Comment posted. Only staff can see it."],
    [{ action: "CATEGORY", subject: "Lift" }, "Category changed to Lift."],
    [{ action: "ACKNOWLEDGE", subject: null }, "Marked as seen."],
    [{ action: "CLOSE", subject: null }, "Safety complaint closed."],
  ] as [{ action: PanelAction; subject: string | null }, string][])("%j reads %s", (done, sentence) => {
    expect(doneText(done)).toBe(sentence);
  });

  it("the errors read as sentences, none of which shows a code", () => {
    for (const error of ["STALE", "FORBIDDEN", "NOT_FOUND", "ASSIGNEE_INVALID", "VALIDATION", "NETWORK", "SERVER"] as PanelError[]) {
      const sentence = errorText(error);
      expect(sentence).toMatch(/\.$/);
      expect(sentence).not.toMatch(/[A-Z]{4,}_?[A-Z]*/);
    }
  });
});

describe("SA5 the panel inside the page", () => {
  const page: ComplaintPage = {
    now: Date.UTC(2026, 10, 6, 7, 30),
    complaint: {
      id: "b0000000-0000-4000-8000-000000000001", body: "Water leak", language: "LATIN", flatCode: "T12-0408", raisedBy: "Swati Joshi", category: "PLUMBING", urgency: "NORMAL", status: "ASSIGNED", safety: false, needsReview: false,
      assignee: null, createdAt: Date.UTC(2026, 10, 6, 6, 30), responseDueAt: null, firstResponseAt: null, pendingConfirmationAt: null, closedAt: null, closeKind: null, rating: null, reopenCount: 0, version: 3,
    },
    sla: "NONE",
    acknowledgedAt: null,
    classifications: [],
    timeline: staffTimeline([], new Map()),
    staffUsers,
    viewer: { canManage: true, isDutyManager: false },
  };
  const out = html(h(ComplaintView, { page, tab: "details" }));

  it("sits in an aside labelled 'Actions', after the timeline in the page, so it is below it on a narrow screen", () => {
    expect(out).toMatch(/<aside[^>]*aria-labelledby="panel-heading"/);
    expect(words(out)).toContain("Actions");
    expect(out.indexOf('id="timeline-heading"')).toBeLessThan(out.indexOf("<aside"));
  });

  it("is on the right from 1024px: a two-column grid at lg with a 24rem panel", () => {
    expect(out).toContain("lg:grid-cols-[minmax(0,1fr)_24rem]");
    expect(out).toContain("lg:sticky");
  });

  it("still has exactly one h1 and one main landmark, and no filled control", () => {
    expect(count(out, /<h1/g)).toBe(1);
    expect(count(out, /<main/g)).toBe(1);
    expect(out).not.toContain("bg-accent");
  });

  it("a safety complaint's page never offers Mark resolved", () => {
    const safety = html(h(ComplaintView, { page: { ...page, complaint: { ...page.complaint, safety: true, urgency: "CRITICAL" } }, tab: "details" }));
    expect(safety).not.toContain("Mark resolved");
    expect(safety).toContain("Mark in progress");
  });
});
