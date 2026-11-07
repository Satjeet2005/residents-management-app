import { describe, expect, it } from "vitest";
import { type EventRow, residentTimeline } from "@/domain/complaints/timeline";

const at = (n: number) => 1_000_000 + n * 1000;
const ev = (n: number, eventType: EventRow["eventType"], payload: unknown = {}): EventRow => ({ eventType, createdAt: at(n), payload });
const kinds = (events: EventRow[]) => residentTimeline(events).map((e) => e.label);

describe("CL2 what a resident sees of the events", () => {
  it("CL2 Raised, Assigned, the status changes and the close, in time order, whatever order the events come in", () => {
    const events = [
      ev(5, "CLOSED", { closeKind: "CONFIRMED", rating: 5 }),
      ev(1, "CREATED"),
      ev(3, "STATUS_CHANGED", { from: "ASSIGNED", to: "IN_PROGRESS" }),
      ev(2, "ASSIGNED", { assignee: "x" }),
      ev(4, "STATUS_CHANGED", { from: "IN_PROGRESS", to: "PENDING_CONFIRMATION" }),
    ];
    expect(kinds(events)).toEqual(["Raised", "Assigned", "In progress", "Marked resolved. Please confirm or reopen", "Closed. You confirmed it is fixed"]);
  });

  it("CL2 CLASSIFIED, a category correction, links, affected flats, an acknowledgement and an internal note are never shown", () => {
    const events = [
      ev(1, "CREATED"),
      ev(2, "CLASSIFIED", { source: "LLM", category: "PLUMBING" }),
      ev(3, "CATEGORY_CORRECTED", { from: "OTHER", to: "PLUMBING" }),
      ev(4, "DUPLICATE_LINKED", {}),
      ev(5, "AFFECTED_TOO", {}),
      ev(6, "COMMENT", { kind: "ack" }),
      ev(7, "COMMENT", { body: "call the vendor, he is slow", visibleToResident: false }),
      ev(8, "COMMENT", { body: "seeded comment with no mark" }),
    ];
    expect(kinds(events)).toEqual(["Raised"]);
  });

  it("CL2 a staff comment marked visible is shown with its words", () => {
    expect(residentTimeline([ev(1, "COMMENT", { body: "The plumber comes tomorrow", visibleToResident: true })])).toEqual([
      { kind: "COMMENT", label: "Update from the society", at: at(1), text: "The plumber comes tomorrow" },
    ]);
  });

  it("CL2 a safety complaint shows 'Sent to the duty manager' once, not also an Assigned line for the automatic assignment", () => {
    const events = [ev(1, "CREATED"), ev(2, "CLASSIFIED"), ev(3, "ESCALATED", { reason: "SAFETY_RULE" }), ev(4, "ASSIGNED", { assignee: "dm" })];
    expect(kinds(events)).toEqual(["Raised", "Sent to the duty manager"]);
  });

  it("CL2 a reopen shows the resident's own reason; each way of closing has its words; no actor or assignee id is in any entry", () => {
    const events = [ev(1, "REOPENED", { reason: "Still leaking", reopenCount: 1 }), ev(2, "CLOSED", { closeKind: "AUTO_CLOSED" }), ev(3, "CLOSED", { closeKind: "DUTY_MANAGER" }), ev(4, "CLOSED", {})];
    const out = residentTimeline(events);
    expect(out.map((e) => e.label)).toEqual(["Reopened", "Closed automatically after no answer", "Closed by the duty manager", "Closed"]);
    expect(out[0].text).toBe("Still leaking");
    expect(JSON.stringify(residentTimeline([ev(1, "ASSIGNED", { assignee: "secret-id" })]))).not.toContain("secret-id");
  });

  it("CL2 it never throws on a payload of the wrong shape", () => {
    expect(() => residentTimeline([ev(1, "COMMENT", null), ev(2, "STATUS_CHANGED", 5), ev(3, "CLOSED", [])])).not.toThrow();
  });
});
