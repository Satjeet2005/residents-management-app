import { describe, expect, it } from "vitest";
import type { DemoComplaint, DemoComplaintLink } from "@/domain/seed/complaint-types";
import { DEMO_NOW } from "@/domain/seed/types";
import { dataset } from "./complaint-helpers";

/*
 * The predicates below are the CHECK constraints of the complaints and
 * complaint_links tables (prisma/migrations/20261104091653_complaints_outbox_audit_visitors),
 * written again here as small pure functions.
 */

/** K1: a safety complaint is CRITICAL. */
const k1 = (c: DemoComplaint) => !c.safetyFlag || c.urgency === "CRITICAL";
/** K2: a safety complaint is never closed by itself. */
const k2 = (c: DemoComplaint) => !c.safetyFlag || c.closeKind === null || c.closeKind === "DUTY_MANAGER";
/** K3: closure fields exist exactly when CLOSED; PENDING_CONFIRMATION has its timestamp. */
const k3 = (c: DemoComplaint) =>
  ((c.status === "CLOSED" && c.closedAt !== null && c.closeKind !== null) || (c.status !== "CLOSED" && c.closedAt === null && c.closeKind === null)) &&
  (c.status !== "PENDING_CONFIRMATION" || c.pendingConfirmationAt !== null);
/** K4: a rating is 1 to 5 and only on CLOSED + CONFIRMED; REOPENED needs a reopen count. */
const k4 = (c: DemoComplaint) =>
  (c.rating === null || (c.rating >= 1 && c.rating <= 5)) &&
  (c.rating === null || (c.status === "CLOSED" && c.closeKind === "CONFIRMED")) &&
  c.reopenCount >= 0 &&
  (c.status !== "REOPENED" || c.reopenCount >= 1);
/** K6: no link to itself, one primary per duplicate, and nothing is both a primary and a duplicate. */
const k6 = (links: readonly DemoComplaintLink[]) => {
  const duplicates = links.map((l) => l.duplicateKey);
  const primaries = new Set(links.map((l) => l.primaryKey));
  return (
    links.every((l) => l.primaryKey !== l.duplicateKey) &&
    new Set(duplicates).size === duplicates.length &&
    duplicates.every((d) => !primaries.has(d))
  );
};

describe("C5 database compatibility", () => {
  it("C5 every complaint passes K1, K2, K3 and K4", () => {
    for (const c of dataset.complaints) {
      expect(k1(c), `K1 ${c.key}`).toBe(true);
      expect(k2(c), `K2 ${c.key}`).toBe(true);
      expect(k3(c), `K3 ${c.key}`).toBe(true);
      expect(k4(c), `K4 ${c.key}`).toBe(true);
    }
  });

  it("C5 the links pass K6", () => {
    expect(k6(dataset.links)).toBe(true);
  });

  it("C5 the predicates reject a bad row (so they are not always true)", () => {
    const base = dataset.complaints[0];
    expect(k1({ ...base, safetyFlag: true, urgency: "HIGH" })).toBe(false);
    expect(k2({ ...base, safetyFlag: true, closeKind: "AUTO_CLOSED" })).toBe(false);
    expect(k3({ ...base, status: "CLOSED", closedAt: null })).toBe(false);
    expect(k3({ ...base, status: "PENDING_CONFIRMATION", pendingConfirmationAt: null, closedAt: null, closeKind: null })).toBe(false);
    expect(k4({ ...base, rating: 3, status: "NEW", closeKind: null })).toBe(false);
    expect(k4({ ...base, status: "REOPENED", reopenCount: 0 })).toBe(false);
    expect(k6([{ ...dataset.links[0], duplicateKey: dataset.links[0].primaryKey }])).toBe(false);
    expect(k6([dataset.links[0], { ...dataset.links[1], duplicateKey: dataset.links[0].duplicateKey }])).toBe(false);
    expect(k6([dataset.links[0], { ...dataset.links[1], primaryKey: dataset.links[0].duplicateKey }])).toBe(false);
  });

  it("C5 every complaint has events, in time order, starting with CREATED, none after DEMO_NOW", () => {
    const events = new Map<string, typeof dataset.events>();
    for (const e of dataset.events) events.set(e.complaintKey, [...(events.get(e.complaintKey) ?? []), e]);
    for (const c of dataset.complaints) {
      const list = events.get(c.key) ?? [];
      expect(list.length, c.key).toBeGreaterThanOrEqual(2);
      expect(list[0].type, c.key).toBe("CREATED");
      expect(list[0].createdAt, c.key).toBe(c.createdAt);
      for (let i = 1; i < list.length; i++) expect(list[i].createdAt, c.key).toBeGreaterThanOrEqual(list[i - 1].createdAt);
      expect(list[list.length - 1].createdAt, c.key).toBeLessThanOrEqual(DEMO_NOW);
    }
  });

  it("C5 the events agree with the row: closure, reopens, escalation, assignment", () => {
    const byComplaint = new Map<string, typeof dataset.events>();
    for (const e of dataset.events) byComplaint.set(e.complaintKey, [...(byComplaint.get(e.complaintKey) ?? []), e]);
    for (const c of dataset.complaints) {
      const list = byComplaint.get(c.key) ?? [];
      const ofType = (type: string) => list.filter((e) => e.type === type);
      expect(ofType("REOPENED").length, `${c.key} reopens`).toBe(c.reopenCount);
      expect(ofType("ESCALATED").length, `${c.key} escalated`).toBe(c.safetyFlag ? 1 : 0);
      expect(ofType("ASSIGNED").length, `${c.key} assigned`).toBe(c.assigneeUserKey === null ? 0 : 1);
      expect(ofType("CLASSIFIED").length, `${c.key} classified`).toBe(1);
      const closed = ofType("CLOSED");
      if (c.status === "CLOSED") expect(closed[closed.length - 1].createdAt, `${c.key} closed`).toBe(c.closedAt);
      else expect(closed.length === 0 || c.reopenCount >= 1, `${c.key} closed events`).toBe(true);
      if (c.firstResponseAt !== null) expect(list.some((e) => e.type === "STATUS_CHANGED" && e.createdAt === c.firstResponseAt), c.key).toBe(true);
    }
  });

  it("C5 there is one classification per complaint with the right source and confidence", () => {
    const byComplaint = new Map(dataset.classifications.map((k) => [k.complaintKey, k]));
    expect(byComplaint.size).toBe(dataset.complaints.length);
    expect(dataset.classifications).toHaveLength(dataset.complaints.length);
    const correctedKeys = new Set(dataset.events.filter((e) => e.type === "CATEGORY_CORRECTED").map((e) => e.complaintKey));
    for (const c of dataset.complaints) {
      const k = byComplaint.get(c.key) as (typeof dataset.classifications)[number];
      expect(k.categoryCode, c.key).toBe(c.categoryCode);
      expect(k.urgency, c.key).toBe(c.urgency);
      expect(k.source === "RULE", c.key).toBe(c.safetyFlag);
      expect(k.source === "MANUAL", c.key).toBe(correctedKeys.has(c.key));
      if (k.source === "LLM") {
        expect(k.confidence as number).toBeGreaterThanOrEqual(0.6);
        expect(k.confidence as number).toBeLessThanOrEqual(0.98);
      } else if (k.source === "RULE" || k.source === "MANUAL") expect(k.confidence).toBeNull();
    }
  });

  it("C5 classification sources: LLM about 85%, FALLBACK about 10%, MANUAL about 5%", () => {
    const nonSafety = dataset.classifications.filter((k) => k.source !== "RULE");
    const pct = (source: string) => (100 * nonSafety.filter((k) => k.source === source).length) / nonSafety.length;
    expect(Math.abs(pct("LLM") - 85)).toBeLessThan(4);
    expect(Math.abs(pct("FALLBACK") - 10)).toBeLessThan(3);
    expect(Math.abs(pct("MANUAL") - 5)).toBeLessThan(2);
  });

  it("C5 ids and flats resolve: flat, resident of that flat, staff assignee, category, event actors", () => {
    const flats = new Set(dataset.flats.map((f) => f.key));
    const users = new Map(dataset.users.map((u) => [u.key, u]));
    const memberships = new Set(dataset.members.map((m) => `${m.flatKey}|${m.userKey}`));
    const categories = new Set(dataset.categories.map((c) => c.code));
    const keys = new Set(dataset.complaints.map((c) => c.key));
    expect(keys.size).toBe(dataset.complaints.length);
    for (const c of dataset.complaints) {
      expect(flats.has(c.flatKey), c.key).toBe(true);
      expect(memberships.has(`${c.flatKey}|${c.raisedByUserKey}`), c.key).toBe(true);
      expect(categories.has(c.categoryCode), c.key).toBe(true);
      if (c.assigneeUserKey !== null) expect(users.get(c.assigneeUserKey)?.role, c.key).toBe("STAFF");
    }
    expect(new Set(dataset.events.map((e) => e.key)).size).toBe(dataset.events.length);
    for (const e of dataset.events) {
      expect(keys.has(e.complaintKey), e.key).toBe(true);
      if (e.actorUserKey !== null) expect(users.has(e.actorUserKey), e.key).toBe(true);
    }
    for (const l of dataset.links) expect(keys.has(l.primaryKey) && keys.has(l.duplicateKey)).toBe(true);
    for (const a of dataset.affected) expect(keys.has(a.complaintKey) && flats.has(a.flatKey)).toBe(true);
  });

  it("C5 a complaint needing review is a FALLBACK classification that is not closed", () => {
    const fallback = new Set(dataset.classifications.filter((k) => k.source === "FALLBACK").map((k) => k.complaintKey));
    for (const c of dataset.complaints) expect(c.needsReview, c.key).toBe(fallback.has(c.key) && c.status !== "CLOSED");
  });
});
