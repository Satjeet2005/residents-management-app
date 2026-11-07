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
  const out = html(h(ComplaintView, { page: page() }));
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
    expect(text).toContain("Model: Plumbing, Normal, High confidence");
    expect(words(html(h(ComplaintView, { page: page({ classifications: [] }) })))).toContain("It has not been classified.");
  });

  it("shows the reply clocks: the state in words, the due time, the first reply", () => {
    expect(text).toContain("Replied in time");
    expect(text).toContain("Reply due 7 Nov, 12:00 pm");
    expect(text).toContain("First reply 6 Nov, 12:10 pm");
    const waiting = words(html(h(ComplaintView, { page: page({ sla: "OVERDUE", now: T0 + 26 * 60 * minute }, { firstResponseAt: null }) })));
    expect(waiting).toContain("Reply overdue by 2 h");
    expect(waiting).toContain("Nobody has replied yet.");
  });

  it("says when it was marked resolved, closed and reopened", () => {
    const closed = words(html(h(ComplaintView, { page: page({ sla: "NONE" }, { status: "CLOSED", pendingConfirmationAt: T0 + 30 * minute, closedAt: T0 + 60 * minute, reopenCount: 2 }) })));
    expect(closed).toContain("Marked resolved 6 Nov, 12:30 pm");
    expect(closed).toContain("Closed 6 Nov, 1:00 pm");
    expect(closed).toContain("Reopened 2 times");
    expect(words(html(h(ComplaintView, { page: page({}, { reopenCount: 1 }) })))).toContain("Reopened once");
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

  it("a complaint that needs review says so next to the category", () => {
    expect(words(html(h(ComplaintView, { page: page({}, { needsReview: true, category: null, assignee: null }) })))).toContain("No category Needs review");
    expect(words(html(h(ComplaintView, { page: page({}, { assignee: null }) })))).toContain("Assigned to Unassigned");
  });
});

describe("SD2 a safety complaint", () => {
  const safety = { safety: true, urgency: "CRITICAL" as const };

  it("says it is a safety complaint and that the duty manager has not seen it, in the caution border", () => {
    const out = html(h(ComplaintView, { page: page({}, safety) }));
    expect(words(out)).toContain("Safety complaint The duty manager has not seen this yet.");
    expect(out).toContain("border-caution");
    expect(out).toMatch(/<span class="[^"]*text-caution[^"]*border-caution[^"]*"[^>]*>Critical<\/span>/);
  });

  it("says when the duty manager saw it", () => {
    expect(words(html(h(ComplaintView, { page: page({ acknowledgedAt: T0 + 5 * minute }, safety) })))).toContain("The duty manager saw this at 6 Nov, 12:05 pm.");
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
