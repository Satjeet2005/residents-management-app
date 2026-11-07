import { describe, expect, it } from "vitest";
import { BOARD_VIEWS, type RankFacts, type ViewFacts, compareForView, inView, isTriage, rankBand } from "@/domain/complaints/board-views";
import { createPrng } from "@/domain/seed/prng";

const NOW = Date.UTC(2026, 10, 7, 6, 30);
const ME = "me";
const base: ViewFacts = { status: "ASSIGNED", safetyFlag: false, acknowledged: false, assigneeId: "other", needsReview: false, responseDueAt: NOW + 3600_000, firstResponseAt: null };
const f = (over: Partial<ViewFacts>): ViewFacts => ({ ...base, ...over });
const views = (c: ViewFacts) => BOARD_VIEWS.filter((v) => inView(v, c, ME, NOW));

describe("D151 view definitions", () => {
  it("has the eight views in the order of the views sheet", () => {
    expect(BOARD_VIEWS).toEqual(["needs_action", "mine", "safety", "triage", "open", "overdue", "waiting", "closed"]);
  });

  it.each([
    ["an assigned complaint that is on time is only open", f({}), ["open"]],
    ["an unassigned NEW complaint needs action and triage", f({ status: "NEW", assigneeId: null }), ["needs_action", "triage"]],
    ["a NEW complaint with needs_review (assigned) needs action and triage", f({ status: "NEW", needsReview: true }), ["needs_action", "triage"]],
    ["an ASSIGNED complaint with needs_review is NOT in triage and needs no action", f({ needsReview: true }), ["open"]],
    ["an in-progress complaint with needs_review is not in triage", f({ status: "IN_PROGRESS", needsReview: true }), ["open"]],
    ["an unacknowledged safety complaint needs action, is safety and open", f({ safetyFlag: true }), ["needs_action", "safety", "open"]],
    ["an acknowledged safety complaint no longer needs action", f({ safetyFlag: true, acknowledged: true }), ["safety", "open"]],
    ["my complaint past its first-reply time needs action, is mine and overdue", f({ assigneeId: ME, responseDueAt: NOW - 1 }), ["needs_action", "mine", "open", "overdue"]],
    ["someone else's overdue complaint is overdue but needs no action from me", f({ responseDueAt: NOW - 1 }), ["open", "overdue"]],
    ["my REOPENED complaint needs action", f({ assigneeId: ME, status: "REOPENED", firstResponseAt: NOW - 5 }), ["needs_action", "mine", "open"]],
    ["someone else's REOPENED complaint does not", f({ status: "REOPENED", firstResponseAt: NOW - 5 }), ["open"]],
    ["a late first reply is not overdue (D150)", f({ assigneeId: ME, responseDueAt: NOW - 1000, firstResponseAt: NOW - 10 }), ["mine", "open"]],
    ["a complaint waiting for the resident", f({ status: "PENDING_CONFIRMATION", firstResponseAt: NOW - 5 }), ["waiting"]],
    ["resolved late after an in-time reply is not overdue (D150)", f({ status: "PENDING_CONFIRMATION", responseDueAt: NOW - 1000, firstResponseAt: NOW - 2000 }), ["waiting"]],
    ["a closed complaint is only closed, even unassigned, flagged or unacknowledged", f({ status: "CLOSED", assigneeId: null, safetyFlag: true, needsReview: true, responseDueAt: NOW - 1 }), ["closed"]],
    ["a complaint with no due time is never overdue", f({ assigneeId: ME, responseDueAt: null }), ["mine", "open"]],
    ["the due time equal to now has not passed", f({ assigneeId: ME, responseDueAt: NOW }), ["mine", "open"]],
  ])("%s", (_name, facts, expected) => {
    expect(views(facts)).toEqual(expected);
  });

  it("triage is exactly: not closed and (no assignee, or NEW with needs_review)", () => {
    for (const status of ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION", "CLOSED", "REOPENED"] as const)
      for (const assigneeId of [null, "other"])
        for (const needsReview of [false, true]) {
          const c = f({ status, assigneeId, needsReview });
          expect(isTriage(c), JSON.stringify(c)).toBe(status !== "CLOSED" && (assigneeId === null || (needsReview && status === "NEW")));
        }
  });
});

const rank = (over: Partial<RankFacts>): RankFacts => ({ id: "00000000-0000-4000-8000-000000000001", status: "ASSIGNED", safetyFlag: false, acknowledged: false, urgency: "NORMAL", responseDueAt: NOW, createdAt: NOW - 1000, closedAt: null, ...over });

describe("D151 ranking", () => {
  it("bands: an unacknowledged safety complaint, then CRITICAL or HIGH, then the rest, then closed (a closed complaint is never band 0)", () => {
    expect(rankBand(rank({ safetyFlag: true }))).toBe(0);
    expect(rankBand(rank({ safetyFlag: true, acknowledged: true, urgency: "CRITICAL" }))).toBe(1);
    expect(rankBand(rank({ urgency: "HIGH" }))).toBe(1);
    expect(rankBand(rank({ urgency: "LOW" }))).toBe(2);
    expect(rankBand(rank({ safetyFlag: true, status: "CLOSED" }))).toBe(3);
  });

  it("a closed or low-urgency complaint never outranks an unacknowledged safety complaint, however overdue", () => {
    const safety = rank({ safetyFlag: true, responseDueAt: NOW + 1e9 });
    for (const other of [rank({ status: "CLOSED", responseDueAt: 0 }), rank({ urgency: "LOW", responseDueAt: 0 }), rank({ urgency: "CRITICAL", responseDueAt: 0 })])
      expect(compareForView("needs_action", safety, other)).toBeLessThan(0);
  });

  it("within a band the more overdue (older due time) comes first, a complaint with no due time last, then newest created, then the larger id", () => {
    const older = rank({ responseDueAt: NOW - 5000 });
    const newer = rank({ responseDueAt: NOW - 1000 });
    expect(compareForView("open", older, newer)).toBeLessThan(0);
    expect(compareForView("open", newer, rank({ responseDueAt: null }))).toBeLessThan(0);
    expect(compareForView("open", rank({ createdAt: 20 }), rank({ createdAt: 10 }))).toBeLessThan(0);
    expect(compareForView("open", rank({ id: "00000000-0000-4000-8000-000000000009" }), rank({ id: "00000000-0000-4000-8000-000000000001" }))).toBeLessThan(0);
  });

  it("the closed view is newest closed first, and sorting is a total order (no ties between different ids) for 500 seeded complaints", () => {
    expect(compareForView("closed", rank({ status: "CLOSED", closedAt: 20 }), rank({ status: "CLOSED", closedAt: 10 }))).toBeLessThan(0);
    const rng = createPrng(151);
    const items = Array.from({ length: 500 }, (_, i) =>
      rank({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, safetyFlag: rng.next() < 0.1, urgency: (["CRITICAL", "HIGH", "NORMAL", "LOW"] as const)[Math.floor(rng.next() * 4)], responseDueAt: Math.floor(rng.next() * 5), createdAt: Math.floor(rng.next() * 3) }),
    );
    for (const view of ["needs_action", "closed"] as const) {
      const sorted = [...items].sort((a, b) => compareForView(view, a, b));
      for (let i = 1; i < sorted.length; i++) {
        expect(compareForView(view, sorted[i - 1], sorted[i])).toBeLessThan(0);
      }
    }
  });
});
