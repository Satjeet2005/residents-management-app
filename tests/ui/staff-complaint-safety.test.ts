import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComplaintView } from "@/app/(staff)/staff/complaints/[id]/complaint-view";
import { type PanelHandlers, PanelView } from "@/app/(staff)/staff/complaints/[id]/panel-view";
import type { ComplaintStatus } from "@/domain/complaints/step";
import { type Controls, type ControlViewer, controlsFor } from "@/lib/staff-complaints/controls";
import { type PanelState, initialPanelState, panelReducer } from "@/lib/staff-complaints/panel";
import { staffTimeline } from "@/lib/staff-complaints/timeline";
import type { ComplaintPage } from "@/server/complaints/staff-page-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const noop = () => {};
const handlers: PanelHandlers = { onField: noop, onToggleVisible: noop, onOpenNote: noop, onCloseNote: noop, onSubmit: noop, onReload: noop };
const staffUsers = [{ id: "u1", name: "Kavita Rao" }];
const DUTY: ControlViewer = { canManage: true, isDutyManager: true };
const MANAGER: ControlViewer = { canManage: true, isDutyManager: false };

const panel = (controls: Controls, state: Partial<PanelState> = {}) =>
  html(h(PanelView, { state: { ...initialPanelState, ...state }, controls, staffUsers, currentCategory: null, needsReview: false, handlers }));
const page = (viewer: ControlViewer, status: ComplaintStatus, safety: boolean, acknowledged: boolean): ComplaintPage => ({
  now: Date.UTC(2026, 10, 6, 7, 0),
  complaint: {
    id: "b0000000-0000-4000-8000-000000000002", body: "gas smell in the corridor", language: "LATIN", flatCode: "T12-0408", raisedBy: "Swati Joshi", category: null, urgency: safety ? "CRITICAL" : "NORMAL", status, safety, needsReview: false,
    assignee: { id: "u1", name: "Kavita Rao" }, createdAt: Date.UTC(2026, 10, 6, 6, 30), responseDueAt: Date.UTC(2026, 10, 6, 6, 45), firstResponseAt: null, pendingConfirmationAt: null, closedAt: null, closeKind: null, rating: null, reopenCount: 0, version: 2,
  },
  sla: "ON_TIME",
  acknowledgedAt: acknowledged ? Date.UTC(2026, 10, 6, 6, 40) : null,
  classifications: [],
  timeline: staffTimeline([], new Map()),
  staffUsers,
  viewer,
});
const render = (p: ComplaintPage) => html(h(ComplaintView, { page: p, tab: "details" }));

describe("SS1 the duty manager on an unacknowledged safety complaint", () => {
  const out = render(page(DUTY, "ASSIGNED", true, false));

  it("sees 'I have seen this' as the ONE filled control of the page, and 'Close this safety complaint' outlined", () => {
    expect(out).toMatch(/<button[^>]*bg-accent[^>]*>I have seen this<\/button>/);
    expect(count(out, /bg-accent/g)).toBe(1);
    expect(out).toMatch(/<button[^>]*border-control[^>]*>Close this safety complaint<\/button>/);
  });

  it("sees it first in the panel, with what it tells the resident", () => {
    expect(out.indexOf("I have seen this")).toBeLessThan(out.indexOf(">Assign</h3>"));
    expect(words(out)).toContain("The resident is told that the duty manager has seen the report.");
  });

  it("both controls are 48px tall", () => {
    for (const label of ["I have seen this", "Close this safety complaint"]) expect(out).toMatch(new RegExp(`<button[^>]*min-h-12[^>]*>${label}</button>`));
  });

  it("still never sees Mark resolved", () => {
    expect(out).not.toContain("Mark resolved");
  });
});

describe("SS2 after the acknowledgement", () => {
  const out = render(page(DUTY, "ASSIGNED", true, true));

  it("'I have seen this' is gone, nothing is filled, and Close this safety complaint is still offered", () => {
    expect(out).not.toContain("I have seen this");
    expect(out).not.toContain("bg-accent");
    expect(out).toContain(">Close this safety complaint</button>");
  });

  it("the page says when it was seen", () => {
    expect(words(out)).toContain("Seen by the duty manager at 6 Nov, 12:10 pm.");
  });
});

describe("SS3 nobody else sees the two controls", () => {
  it.each([
    ["a plain manager on an unacknowledged safety complaint", page(MANAGER, "ASSIGNED", true, false)],
    ["a plain manager on an acknowledged safety complaint", page(MANAGER, "ASSIGNED", true, true)],
    ["the duty manager on an ordinary complaint", page(DUTY, "ASSIGNED", false, false)],
    ["a plain manager on an ordinary complaint", page(MANAGER, "ASSIGNED", false, false)],
    ["the duty manager on a closed safety complaint", page(DUTY, "CLOSED", true, true)],
    ["somebody who may not manage", page({ canManage: false, isDutyManager: true }, "ASSIGNED", true, false)],
  ])("%s", (_name, p) => {
    const out = render(p);
    const isAllowed = p.viewer.canManage && p.viewer.isDutyManager && p.complaint.safety && p.complaint.status !== "CLOSED";
    expect(out.includes("I have seen this")).toBe(isAllowed && p.acknowledgedAt === null);
    expect(out.includes("Close this safety complaint")).toBe(isAllowed);
    expect(out.includes("Safety follow-up")).toBe(isAllowed);
  });
});

describe("SS4 the close form", () => {
  const controls = controlsFor({ status: "ASSIGNED", safety: true, acknowledged: true, viewer: DUTY });

  it("asks for a note first: the box, its count and hint, the send button and Cancel", () => {
    const out = panel(controls, { noteOpen: "CLOSE" });
    expect(out).toMatch(/<textarea[^>]*id="close-note"/);
    expect(out).toContain('for="close-note"');
    expect(words(out)).toContain("0 of 500");
    expect(words(out)).toContain("Only the duty manager can close a safety complaint.");
    expect(count(out, />Close this safety complaint<\/button>/g)).toBe(1);
    expect(out).toContain(">Cancel</button>");
    expect(out).not.toContain("bg-accent");
  });

  it("a send with no note shows the inline error on the field", () => {
    const state = [{ type: "NOTE_OPENED", form: "CLOSE" }, { type: "SUBMIT", action: "CLOSE" }].reduce((s, e) => panelReducer(s, e as never), initialPanelState);
    const out = panel(controls, state);
    expect(words(out)).toContain("Write a note of 5 to 500 characters.");
    expect(out).toMatch(/<textarea[^>]*aria-invalid="true"/);
  });

  it("while it is being sent its button says Working", () => {
    const state = [{ type: "NOTE_OPENED", form: "CLOSE" }, { type: "FIELD", field: "closeNote", value: "Gas isolated" }, { type: "SUBMIT", action: "CLOSE" }].reduce((s, e) => panelReducer(s, e as never), initialPanelState);
    expect(panel(controls, state)).toMatch(/<button[^>]*aria-busy="true"[^>]*>Working<\/button>/);
  });

  it("the acknowledgement in flight says Working on the filled button, and the filled control stays the only one", () => {
    const unacknowledged = controlsFor({ status: "ASSIGNED", safety: true, acknowledged: false, viewer: DUTY });
    const out = panel(unacknowledged, panelReducer(initialPanelState, { type: "SUBMIT", action: "ACKNOWLEDGE" }));
    expect(out).toMatch(/<button[^>]*aria-busy="true"[^>]*>Working<\/button>/);
    expect(count(out, /bg-accent/g)).toBeLessThanOrEqual(1);
  });

  it("the confirmations say what happened", () => {
    expect(words(panel(controls, { done: { action: "CLOSE", subject: null } }))).toContain("Safety complaint closed.");
    expect(words(panel(controls, { done: { action: "ACKNOWLEDGE", subject: null } }))).toContain("Marked as seen.");
  });
});

describe("SS5 at most ONE filled control in any view", () => {
  const statuses: ComplaintStatus[] = ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION", "REOPENED", "CLOSED"];
  const viewers: ControlViewer[] = [DUTY, MANAGER, { canManage: false, isDutyManager: false }];

  it("across every viewer, status, safety flag and acknowledgement the page has at most one filled control", () => {
    let seen = 0;
    for (const viewer of viewers) for (const status of statuses) for (const safety of [false, true]) for (const acknowledged of [false, true]) {
      const filled = count(render(page(viewer, status, safety, acknowledged)), /bg-accent/g);
      expect(filled, `${viewer.isDutyManager} ${viewer.canManage} ${status} ${safety} ${acknowledged}`).toBeLessThanOrEqual(1);
      seen += filled;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("the one filled control is 'I have seen this', and only while a safety complaint is unacknowledged", () => {
    for (const viewer of viewers) for (const status of statuses) for (const safety of [false, true]) for (const acknowledged of [false, true]) {
      const out = render(page(viewer, status, safety, acknowledged));
      const filled = count(out, /bg-accent/g) === 1;
      const expected = viewer.canManage && viewer.isDutyManager && safety && status !== "CLOSED" && !acknowledged;
      expect(filled, `${viewer.isDutyManager} ${viewer.canManage} ${status} ${safety} ${acknowledged}`).toBe(expected);
    }
  });
});
