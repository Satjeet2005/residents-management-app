import { describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { DAY, dataset, median, MINUTE, share, userNamed } from "./complaint-helpers";

const complaints = dataset.complaints;
const count = (predicate: (c: (typeof complaints)[number]) => boolean) => complaints.filter(predicate).length;

describe("C2 volume and mix", () => {
  it("C2 has 3,300 to 3,600 complaints, about 1,800 in September", () => {
    expect(complaints.length).toBeGreaterThanOrEqual(3300);
    expect(complaints.length).toBeLessThanOrEqual(3600);
    const september = count((c) => c.createdAt < Date.UTC(2026, 8, 30, 18, 30));
    expect(september).toBeGreaterThanOrEqual(1700);
    expect(september).toBeLessThanOrEqual(1900);
  });

  it.each([
    ["PLUMBING", 28.7],
    ["ELECTRICAL", 22.6],
    ["HOUSEKEEPING", 18.2],
    ["LIFT", 16.0],
    ["OTHER", 14.5],
  ])("C2 category %s is within 2 points of %d%%", (code, target) => {
    expect(Math.abs(share(count((c) => c.categoryCode === code), complaints.length) - target)).toBeLessThan(2);
  });

  it.each([
    ["NORMAL", 70],
    ["HIGH", 15],
    ["LOW", 12],
  ])("C2 urgency %s is within 3 points of %d%%", (urgency, target) => {
    expect(Math.abs(share(count((c) => c.urgency === urgency), complaints.length) - target)).toBeLessThan(3);
  });

  it("C2 safety complaints are 0.5% to 1.5% of all", () => {
    const safety = count((c) => c.safetyFlag);
    expect(share(safety, complaints.length)).toBeGreaterThanOrEqual(0.5);
    expect(share(safety, complaints.length)).toBeLessThanOrEqual(1.5);
  });

  it("C2 CRITICAL is only for safety complaints, and every safety complaint is CRITICAL", () => {
    for (const c of complaints) expect(c.urgency === "CRITICAL", c.key).toBe(c.safetyFlag);
  });

  it("C2 every safety complaint goes to Sanjay Pawar and is never CONFIRMED or AUTO_CLOSED", () => {
    const dutyManager = userNamed("Sanjay Pawar").key;
    for (const c of complaints.filter((x) => x.safetyFlag)) {
      expect(c.assigneeUserKey, c.key).toBe(dutyManager);
      expect(c.closeKind === null || c.closeKind === "DUTY_MANAGER", c.key).toBe(true);
    }
  });

  it("C2 non-safety complaints go to Kavita Rao once assigned, and NEW ones to nobody", () => {
    const kavita = userNamed("Kavita Rao").key;
    for (const c of complaints.filter((x) => !x.safetyFlag)) expect(c.assigneeUserKey, c.key).toBe(c.status === "NEW" ? null : kavita);
  });

  it("C2 bodies are varied: at least 8 different texts for each category", () => {
    for (const code of ["PLUMBING", "ELECTRICAL", "HOUSEKEEPING", "LIFT", "OTHER"]) {
      expect(new Set(complaints.filter((c) => c.categoryCode === code && !c.safetyFlag).map((c) => c.body)).size, code).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("C3 SLA", () => {
  const answered = complaints.filter((c) => c.firstResponseAt !== null);

  it("C3 responseDueAt is createdAt plus the SLA minutes of the urgency", () => {
    const sla = { CRITICAL: 15, HIGH: 120, NORMAL: 1440, LOW: 4320 };
    for (const c of complaints) expect(c.responseDueAt - c.createdAt, c.key).toBe(sla[c.urgency] * MINUTE);
  });

  it("C3 the median first response is 60 to 120 minutes", () => {
    const minutes = median(answered.map((c) => (c.firstResponseAt as number) - c.createdAt)) / MINUTE;
    expect(minutes).toBeGreaterThanOrEqual(60);
    expect(minutes).toBeLessThanOrEqual(120);
  });

  it("C3 82% to 90% of first responses are on or before the due time", () => {
    const within = share(answered.filter((c) => (c.firstResponseAt as number) <= c.responseDueAt).length, answered.length);
    expect(within).toBeGreaterThanOrEqual(82);
    expect(within).toBeLessThanOrEqual(90);
  });

  it("C3 a first response is after creation and never after DEMO_NOW", () => {
    for (const c of answered) {
      expect(c.firstResponseAt as number, c.key).toBeGreaterThan(c.createdAt);
      expect(c.firstResponseAt as number, c.key).toBeLessThanOrEqual(DEMO_NOW);
    }
  });
});

describe("C4 closure mix and reopen rate", () => {
  it("C4 8% to 12% of complaints are not closed", () => {
    const open = share(count((c) => c.status !== "CLOSED"), complaints.length);
    expect(open).toBeGreaterThanOrEqual(8);
    expect(open).toBeLessThanOrEqual(12);
  });

  it("C4 a complaint older than 10 days is CLOSED, except a few REOPENED", () => {
    const old = complaints.filter((c) => c.createdAt < DEMO_NOW - 10 * DAY);
    for (const c of old) expect(["CLOSED", "REOPENED"], c.key).toContain(c.status);
    expect(old.filter((c) => c.status === "REOPENED").length).toBeLessThanOrEqual(20);
  });

  it("C4 recent complaints use all of NEW, ASSIGNED, IN_PROGRESS and PENDING_CONFIRMATION", () => {
    const statuses = new Set(complaints.filter((c) => c.createdAt >= DEMO_NOW - 10 * DAY).map((c) => c.status));
    for (const status of ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION"]) expect(statuses.has(status as never), status).toBe(true);
  });

  it("C4 72% to 84% of closed non-safety complaints are CONFIRMED, the rest AUTO_CLOSED", () => {
    const closed = complaints.filter((c) => c.status === "CLOSED" && !c.safetyFlag);
    const confirmed = share(closed.filter((c) => c.closeKind === "CONFIRMED").length, closed.length);
    expect(confirmed).toBeGreaterThanOrEqual(72);
    expect(confirmed).toBeLessThanOrEqual(84);
    expect(closed.filter((c) => c.closeKind !== "CONFIRMED").every((c) => c.closeKind === "AUTO_CLOSED")).toBe(true);
  });

  it("C4 8% to 14% of resolved complaints were reopened at least once", () => {
    const resolved = complaints.filter((c) => c.closedAt !== null || c.reopenCount >= 1);
    const reopened = share(resolved.filter((c) => c.reopenCount >= 1).length, resolved.length);
    expect(reopened).toBeGreaterThanOrEqual(8);
    expect(reopened).toBeLessThanOrEqual(14);
    expect(complaints.some((c) => c.reopenCount >= 1 && c.status === "CLOSED")).toBe(true);
    expect(complaints.some((c) => c.status === "REOPENED")).toBe(true);
  });

  it("C4 every CLOSED row has closedAt and closeKind, and no other row has them", () => {
    for (const c of complaints) {
      expect(c.closedAt !== null && c.closeKind !== null, c.key).toBe(c.status === "CLOSED");
      expect(c.closedAt === null && c.closeKind === null, c.key).toBe(c.status !== "CLOSED");
    }
  });

  it("C4 AUTO_CLOSED complaints close 7 days after pendingConfirmationAt and have no rating", () => {
    const auto = complaints.filter((c) => c.closeKind === "AUTO_CLOSED");
    expect(auto.length).toBeGreaterThan(0);
    for (const c of auto) {
      expect(c.closedAt, c.key).toBe((c.pendingConfirmationAt as number) + 7 * DAY);
      expect(c.rating, c.key).toBeNull();
    }
  });

  it("C4 ratings are 1 to 5, only on CONFIRMED, every CONFIRMED has one, and 4 and 5 are most common", () => {
    const confirmed = complaints.filter((c) => c.closeKind === "CONFIRMED");
    for (const c of complaints) expect(c.rating !== null, c.key).toBe(c.closeKind === "CONFIRMED");
    for (const c of confirmed) expect(c.rating as number).toBeGreaterThanOrEqual(1);
    for (const c of confirmed) expect(c.rating as number).toBeLessThanOrEqual(5);
    expect(share(confirmed.filter((c) => (c.rating as number) >= 4).length, confirmed.length)).toBeGreaterThan(60);
  });
});
