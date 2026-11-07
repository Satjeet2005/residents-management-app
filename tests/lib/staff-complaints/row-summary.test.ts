import { describe, expect, it } from "vitest";
import { DUE_SOON_MINUTES, rowSummary } from "@/lib/staff-complaints/row-summary";
import type { BoardRow } from "@/server/complaints/board-views";

const NOW = Date.UTC(2026, 10, 7, 6, 30);
const MIN = 60_000;
const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  id: "b0000000-0000-4000-8000-000000000001",
  title: "Water leak under the kitchen sink",
  flatCode: "T12-0408",
  category: "PLUMBING",
  urgency: "NORMAL",
  safety: false,
  acknowledged: false,
  status: "ASSIGNED",
  needsReview: false,
  assignee: { id: "u1", name: "Kavita Rao" },
  ageMinutes: 185,
  responseDueAt: NOW + 600 * MIN,
  sla: "ON_TIME",
  source: "LLM",
  version: 1,
  ...over,
});

describe("D151 the compact row", () => {
  it("line 1 has the flat, no urgency for Normal, no Safety chip for an ordinary complaint", () => {
    expect(rowSummary(row(), NOW)).toMatchObject({ flat: "T12-0408", urgency: null, safety: false });
  });

  it.each([
    ["CRITICAL", { text: "Critical", critical: true }],
    ["HIGH", { text: "High", critical: false }],
    ["LOW", { text: "Low", critical: false }],
  ] as const)("the urgency %s is shown", (urgency, expected) => {
    expect(rowSummary(row({ urgency }), NOW).urgency).toEqual(expected);
  });

  it("a safety complaint has the Safety flag", () => {
    expect(rowSummary(row({ safety: true }), NOW).safety).toBe(true);
  });

  it("line 3 is Category · Status · Assignee, and says Unassigned and No category in words", () => {
    expect(rowSummary(row(), NOW).meta).toBe("Plumbing · Assigned · Kavita Rao");
    expect(rowSummary(row({ category: null, status: "NEW", assignee: null }), NOW).meta).toBe("No category · New · Unassigned");
    expect(rowSummary(row({ status: "PENDING_CONFIRMATION" }), NOW).meta).toBe("Plumbing · Waiting for resident · Kavita Rao");
  });

  it("line 4 is overdue with the time, due in when within 4 hours, replied late, and nothing otherwise", () => {
    expect(rowSummary(row({ sla: "OVERDUE", responseDueAt: NOW - 152 * MIN }), NOW).notice).toEqual({ text: "Reply overdue 2 h 32 min", tone: "caution" });
    expect(rowSummary(row({ responseDueAt: NOW + 40 * MIN }), NOW).notice).toEqual({ text: "Reply due in 40 min", tone: "neutral" });
    expect(rowSummary(row({ responseDueAt: NOW + DUE_SOON_MINUTES * MIN }), NOW).notice?.text).toBe("Reply due in 4 h");
    expect(rowSummary(row({ responseDueAt: NOW + (DUE_SOON_MINUTES + 1) * MIN }), NOW).notice).toBeNull();
    expect(rowSummary(row({ sla: "LATE", responseDueAt: NOW - 100 * MIN }), NOW).notice).toEqual({ text: "Replied late", tone: "caution" });
    expect(rowSummary(row({ sla: "MET", responseDueAt: NOW - 100 * MIN }), NOW).notice).toBeNull();
    expect(rowSummary(row({ sla: "NONE", status: "CLOSED" }), NOW).notice).toBeNull();
    expect(rowSummary(row({ responseDueAt: null }), NOW).notice).toBeNull();
  });

  it("carries the title and nothing about the classification source or the review flag", () => {
    const summary = rowSummary(row({ needsReview: true, source: "FALLBACK" }), NOW);
    expect(summary.title).toBe("Water leak under the kitchen sink");
    expect(JSON.stringify(summary)).not.toMatch(/Model|Rules|Keywords|Needs review/);
  });
});
