import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComplaintView } from "@/app/(staff)/staff/complaints/[id]/complaint-view";
import { TimelineList } from "@/app/(staff)/staff/complaints/[id]/timeline-list";
import { staffTimeline } from "@/lib/staff-complaints/timeline";
import type { ComplaintPage } from "@/server/complaints/staff-page-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const T0 = Date.UTC(2026, 10, 6, 6, 30);
const minute = 60_000;

const events = [
  { id: "e1", eventType: "CREATED" as const, at: T0, actor: { id: "r", name: "Swati Joshi" }, payload: {} },
  { id: "e2", eventType: "CLASSIFIED" as const, at: T0 + 1, actor: null, payload: { source: "LLM", category: "PLUMBING", urgency: "NORMAL", confidence: 0.91 } },
  { id: "e3", eventType: "ASSIGNED" as const, at: T0 + 2, actor: null, payload: { assignee: "u1" } },
  { id: "e4", eventType: "COMMENT" as const, at: T0 + 10 * minute, actor: { id: "u1", name: "Kavita Rao" }, payload: { body: "Plumber is booked for Monday", visibleToResident: false } },
  { id: "e5", eventType: "COMMENT" as const, at: T0 + 20 * minute, actor: { id: "u1", name: "Kavita Rao" }, payload: { body: "The plumber visits on Monday", visibleToResident: true } },
];

const page = (over: Partial<ComplaintPage> = {}, complaint: Partial<ComplaintPage["complaint"]> = {}): ComplaintPage => ({
  now: T0 + 40 * minute,
  complaint: {
    id: "b0000000-0000-4000-8000-000000000001",
    body: "Water leak under the kitchen sink\nIt has been dripping since Monday and the floor is wet.",
    language: "LATIN",
    flatCode: "T12-0408",
    raisedBy: "Swati Joshi",
    category: "PLUMBING",
    urgency: "NORMAL",
    status: "ASSIGNED",
    safety: false,
    needsReview: false,
    assignee: { id: "u1", name: "Kavita Rao" },
    createdAt: T0,
    responseDueAt: T0 + 24 * 60 * minute,
    firstResponseAt: T0 + 10 * minute,
    pendingConfirmationAt: null,
    closedAt: null,
    closeKind: null,
    rating: null,
    reopenCount: 0,
    version: 3,
    ...complaint,
  },
  sla: "MET",
  acknowledgedAt: null,
  classifications: [{ source: "LLM", category: "PLUMBING", urgency: "NORMAL", confidence: 0.91, latencyMs: 420, outputHash: "x", at: T0 }],
  timeline: staffTimeline(events, new Map([["u1", "Kavita Rao"]])),
  staffUsers: [{ id: "u1", name: "Kavita Rao" }, { id: "u2", name: "Sanjay Pawar" }],
  viewer: { canManage: true, isDutyManager: false },
  ...over,
});

describe("SD1 the complaint page", () => {
  const out = html(h(ComplaintView, { page: page(), tab: "details" }));
  const text = words(out);

  it("has one main landmark and one h1, the first line of the text, and a 48px way back to the board", () => {
    expect(out).toContain("<main");
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).toMatch(/<h1[^>]*>Water leak under the kitchen sink<\/h1>/);
    expect(out).toMatch(/<a [^>]*min-h-12[^>]*>Back to the board<\/a>/);
    expect(out).toContain('href="/staff/complaints"');
  });

  it("shows the complaint text in full, the flat, the resident who raised it by name, and the details in words", () => {
    expect(text).toContain("What the resident wrote");
    expect(text).toContain("It has been dripping since Monday and the floor is wet.");
    for (const part of ["Flat T12-0408", "Raised by Swati Joshi", "Raised 6 Nov, 12:00 pm", "Status Assigned", "Category Plumbing", "Urgency Normal", "Assigned to Kavita Rao"]) expect(text).toContain(part);
  });

  it("shows the classification history with source, category, urgency and the confidence in words", () => {
    expect(text).toContain("How it was classified");
    expect(text).toContain("Model · Plumbing · Normal");
    expect(text).toContain("Model: Plumbing, Normal, High confidence");
    expect(words(html(h(ComplaintView, { page: page({ classifications: [] }), tab: "details" })))).toContain("It has not been classified.");
  });

  it("shows the reply clocks: the state in words, the due time, the first reply", () => {
    expect(text).toContain("Replied in time · due 7 Nov, 12:00 pm");
    expect(text).toContain("First reply 6 Nov, 12:10 pm");
    const waiting = words(html(h(ComplaintView, { page: page({ sla: "OVERDUE", now: T0 + 26 * 60 * minute }, { firstResponseAt: null }), tab: "details" })));
    expect(waiting).toContain("Reply overdue 2 h · due 7 Nov, 12:00 pm");
    expect(waiting).toContain("Nobody has replied yet.");
  });

  it("says when it was marked resolved, closed and reopened", () => {
    const closed = words(html(h(ComplaintView, { page: page({ sla: "NONE" }, { status: "CLOSED", pendingConfirmationAt: T0 + 30 * minute, closedAt: T0 + 60 * minute, reopenCount: 2 }), tab: "details" })));
    expect(closed).toContain("Marked resolved 6 Nov, 12:30 pm");
    expect(closed).toContain("Closed 6 Nov, 1:00 pm");
    expect(closed).toContain("Reopened 2 times");
    expect(words(html(h(ComplaintView, { page: page({}, { reopenCount: 1 }), tab: "details" })))).toContain("Reopened once");
  });

  it("shows the full timeline, the internal comment included, each line marked visible or internal", () => {
    expect(text).toContain("Timeline");
    expect(text).toContain("Comment, internal");
    expect(text).toContain("Plumber is booked for Monday");
    expect(text).toContain("Comment, visible to the resident");
    const timeline = out.slice(out.indexOf('id="timeline-heading"'), out.indexOf("<aside"));
    expect(count(timeline, />Visible to the resident</g)).toBe(3);
    expect(count(timeline, />Internal</g)).toBe(2);
  });

  it("an ordinary complaint has no safety line, and no control on the page is filled", () => {
    expect(text).not.toContain("Safety complaint");
    expect(out).not.toContain("bg-accent");
  });

  it("a manager sees the category as five chips with the current one pressed, closed chips disabled; the old Correct the category form is gone (D239)", () => {
    const open = html(h(ComplaintView, { page: page(), tab: "details" }));
    expect(open).toContain('role="group" aria-label="Category"');
    expect((open.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect(open).not.toContain("Correct the category");
    const closed = html(h(ComplaintView, { page: page({}, { status: "CLOSED" }), tab: "details" }));
    expect((closed.match(/aria-disabled="true"/g) ?? []).length).toBe(5);
  });

  it("a complaint that needs review says so next to the category", () => {
    const reviewHtml = html(h(ComplaintView, { page: page({}, { needsReview: true, category: null, assignee: null }), tab: "details" }));
    const review = words(reviewHtml);
    expect(review).toContain("Category Plumbing Electrical Housekeeping Lift Other");
    expect(reviewHtml).not.toContain('aria-pressed="true"');
    expect(review).toContain("Needs review");
    expect(words(html(h(ComplaintView, { page: page({}, { assignee: null }), tab: "details" })))).toContain("Assigned to Unassigned");
  });
});

describe("SD2 a safety complaint", () => {
  const safety = { safety: true, urgency: "CRITICAL" as const };

  it("says it is a safety complaint and that the duty manager has not seen it, in the caution border", () => {
    const out = html(h(ComplaintView, { page: page({}, safety), tab: "details" }));
    expect(words(out)).toContain("The duty manager has not seen this yet.");
    expect(words(out)).not.toContain("Safety complaint");
    expect(out).toContain("border-caution");
    expect(out).toMatch(/<span class="[^"]*text-caution[^"]*border-caution[^"]*"[^>]*>Critical<\/span>/);
  });

  it("says when the duty manager saw it", () => {
    expect(words(html(h(ComplaintView, { page: page({ acknowledgedAt: T0 + 5 * minute }, safety), tab: "details" })))).toContain("Seen by the duty manager at 6 Nov, 12:05 pm.");
  });
});

describe("SD3 the timeline list on its own", () => {
  it("has who did each line, the system for the rest, and keeps a multi-line comment's breaks", () => {
    const out = html(h(TimelineList, { lines: staffTimeline(events, new Map([["u1", "Kavita Rao"]])) }));
    expect(words(out)).toContain("by Swati Joshi");
    expect(words(out)).toContain("by the system");
    expect(words(out)).toContain("by Kavita Rao");
    expect(out).toContain("whitespace-pre-line");
    expect(out).toContain("<ol");
  });
});

describe("SD4 the header, the tabs and the facts (D152)", () => {
  const out = html(h(ComplaintView, { page: page({ sla: "OVERDUE", now: T0 + 26 * 60 * minute }, { firstResponseAt: null }), tab: "details" }));
  const header = out.slice(out.indexOf("<header"), out.indexOf("</header>"));

  it("the header has the back link, the title limited to two lines, and the chips for the flat, urgency, status and the reply clock", () => {
    expect(header).toContain("Back to the board");
    expect(header).toMatch(/<h1 class="[^"]*max-h-\[72px\][^"]*overflow-hidden[^"]*">Water leak under the kitchen sink<\/h1>/);
    expect(words(header)).toContain("T12-0408 Normal Assigned Reply overdue 2 h");
    expect(header).toMatch(/text-caution[^"]*border-caution[^"]*"[^>]*>Reply overdue 2 h<\/span>/);
  });

  it("the tabs are a tablist of two tabs, Details selected, each controlling a panel, and BOTH panels are in the page", () => {
    expect(out).toContain('role="tablist"');
    expect(count(out, /role="tab"/g)).toBe(2);
    expect(out).toMatch(/<button[^>]*id="complaint-tab-details"[^>]*aria-selected="true"/);
    expect(out).toMatch(/<button[^>]*id="complaint-tab-timeline"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    expect(out).toMatch(/<div role="tabpanel" id="complaint-panel-details" aria-labelledby="complaint-tab-details" class="[^"]*">/);
    expect(out).toMatch(/<div role="tabpanel" id="complaint-panel-timeline" aria-labelledby="complaint-tab-timeline" hidden="" class="[^"]*">/);
    expect(out).toContain("Plumber is booked for Monday");
    expect(count(out, /min-h-12 flex-1/g)).toBe(2);
  });

  it("the Timeline tab is the selected one when the address says so, and the Details panel is then the hidden one", () => {
    const timeline = html(h(ComplaintView, { page: page(), tab: "timeline" }));
    expect(timeline).toMatch(/id="complaint-tab-timeline"[^>]*aria-selected="true"/);
    expect(timeline).toMatch(/id="complaint-panel-details"[^>]*hidden=""/);
  });

  it("Details: the resident's words come first, then the two-column facts in the order of the task, then the reply clock on one line, then the one-line classification with a Why? expander", () => {
    const details = out.slice(out.indexOf('id="complaint-panel-details"'), out.indexOf('id="complaint-panel-timeline"'));
    const order = ["What the resident wrote", "Flat", "Raised by", "Raised", "Category", "Urgency", "Assigned to", "Status", "Reply clock", "How it was classified"].map((part) => words(details).indexOf(part));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order.every((p) => p >= 0)).toBe(true);
    expect(details).toContain('<dl class="grid grid-cols-2');
    expect(words(details)).toContain("Reply overdue 2 h · due 7 Nov, 12:00 pm");
    expect(words(details)).toContain("Model · Plumbing · Normal");
    expect(details).toMatch(/<details><summary[^>]*min-h-12[^>]*>Why\?<\/summary>/);
  });

  it("Timeline: the latest three events newest first, and the earlier ones behind Show all (n)", () => {
    const panel = out.slice(out.indexOf('id="complaint-panel-timeline"'), out.indexOf("<aside"));
    const labels = ["Comment, visible to the resident", "Comment, internal", "Assigned to Kavita Rao", "Classified by Model", "Raised"].map((l) => words(panel).indexOf(l));
    expect([...labels].sort((a, b) => a - b)).toEqual(labels);
    expect(labels.every((p) => p >= 0)).toBe(true);
    expect(panel).toMatch(/<details><summary[^>]*min-h-12[^>]*>Show all \(5\)<\/summary>/);
    const beforeExpander = panel.slice(0, panel.indexOf("<details>"));
    expect(count(beforeExpander, /<li /g)).toBe(3);
  });

  it("a complaint with three events or fewer has no Show all", () => {
    const small = page();
    small.timeline = small.timeline.slice(0, 3);
    expect(html(h(ComplaintView, { page: small, tab: "timeline" }))).not.toContain("Show all");
  });

  it("no classification says so and has no Why? expander", () => {
    const none = words(html(h(ComplaintView, { page: page({ classifications: [] }), tab: "details" })));
    expect(none).toContain("It has not been classified.");
    expect(none).not.toContain("Why?");
  });
});
