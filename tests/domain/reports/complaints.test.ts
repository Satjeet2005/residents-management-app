import { describe, expect, it } from "vitest";
import { type ReportComplaint, complaintMetrics } from "@/domain/reports/complaints";
import { percent } from "@/domain/reports/stats";
import { createPrng } from "@/domain/seed/prng";

const T0 = Date.UTC(2026, 9, 5, 6, 30);
const NOW = Date.UTC(2026, 9, 27, 6, 30);
const minute = 60_000;

const c = (over: Partial<ReportComplaint> = {}): ReportComplaint => ({
  createdAt: T0,
  safetyFlag: false,
  status: "ASSIGNED",
  closeKind: null,
  responseDueAt: T0 + 1440 * minute,
  firstResponseAt: null,
  reopenCount: 0,
  resolvedAt: null,
  acknowledgedAt: null,
  closedAt: null,
  ...over,
});

describe("RP4 complaint metrics on hand-built rows", () => {
  it("no complaints: every count is zero, every median is null and every share would be 'no data'", () => {
    const m = complaintMetrics([], NOW);
    expect(m).toEqual({
      raised: 0,
      firstReply: { replied: 0, medianMinutes: null, decided: 0, withinSla: 0 },
      resolved: { count: 0, medianMinutes: null, reopened: 0 },
      closed: { byResident: 0, automatically: 0, byDutyManager: 0, other: 0 },
      openNow: 0,
      safety: { count: 0, closedByDutyManager: 0, openSeen: 0, openNotSeen: 0, closedOtherWay: 0, medianMinutesToSeen: null },
    });
    expect(percent(m.firstReply.withinSla, m.firstReply.decided)).toBeNull();
    expect(percent(m.resolved.reopened, m.resolved.count)).toBeNull();
  });

  it("first reply: the median of whole minutes (the lower middle for an even count) and the share within the SLA", () => {
    const rows = [30, 90, 200, 1500].map((m) => c({ firstResponseAt: T0 + m * minute }));
    const m = complaintMetrics(rows, NOW);
    expect(m.firstReply).toEqual({ replied: 4, medianMinutes: 90, decided: 4, withinSla: 3 });
    expect(percent(m.firstReply.withinSla, m.firstReply.decided)).toBe(75);
  });

  it("a reply exactly at the due time is within the SLA; a minute later is not", () => {
    const due = T0 + 120 * minute;
    const m = complaintMetrics([c({ responseDueAt: due, firstResponseAt: due }), c({ responseDueAt: due, firstResponseAt: due + minute })], NOW);
    expect(m.firstReply).toMatchObject({ decided: 2, withinSla: 1 });
  });

  it("an unreplied complaint past its due time counts against the SLA; one not yet due is left out", () => {
    const m = complaintMetrics([c({ responseDueAt: NOW - minute }), c({ responseDueAt: NOW + minute }), c({ firstResponseAt: T0 + 10 * minute })], NOW);
    expect(m.firstReply).toMatchObject({ replied: 1, decided: 2, withinSla: 1 });
  });

  it("seconds are rounded down to whole minutes", () => {
    const m = complaintMetrics([c({ firstResponseAt: T0 + 59_999 }), c({ firstResponseAt: T0 + 119_000 })], NOW);
    expect(m.firstReply.medianMinutes).toBe(0);
    expect(complaintMetrics([c({ firstResponseAt: T0 + 119_000 })], NOW).firstReply.medianMinutes).toBe(1);
  });

  it("resolved: the median time to the first 'marked resolved', and the reopened share of the resolved", () => {
    const rows = [
      c({ resolvedAt: T0 + 60 * minute }),
      c({ resolvedAt: T0 + 600 * minute, reopenCount: 1 }),
      c({ resolvedAt: T0 + 120 * minute }),
      c({ resolvedAt: T0 + 3000 * minute, reopenCount: 2 }),
      c(),
    ];
    const m = complaintMetrics(rows, NOW);
    expect(m.resolved).toEqual({ count: 4, medianMinutes: 120, reopened: 2 });
    expect(percent(m.resolved.reopened, m.resolved.count)).toBe(50);
  });

  it("a complaint that was reopened but never marked resolved is not in the resolved figures", () => {
    expect(complaintMetrics([c({ reopenCount: 3 })], NOW).resolved).toEqual({ count: 0, medianMinutes: null, reopened: 0 });
  });

  it("closed by the resident, automatically, by the duty manager, and with no kind; only closed complaints count", () => {
    const rows = [
      c({ status: "CLOSED", closeKind: "CONFIRMED" }),
      c({ status: "CLOSED", closeKind: "CONFIRMED" }),
      c({ status: "CLOSED", closeKind: "AUTO_CLOSED" }),
      c({ status: "CLOSED", closeKind: "DUTY_MANAGER", safetyFlag: true }),
      c({ status: "PENDING_CONFIRMATION" }),
    ];
    const m = complaintMetrics(rows, NOW);
    expect(m.closed).toEqual({ byResident: 2, automatically: 1, byDutyManager: 1, other: 0 });
    expect(m.openNow).toBe(1);
    expect(m.raised).toBe(5);
  });

  it("open now counts every status but CLOSED", () => {
    const statuses = ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION", "REOPENED", "CLOSED"] as const;
    expect(complaintMetrics(statuses.map((status) => c({ status, closeKind: status === "CLOSED" ? "CONFIRMED" : null })), NOW).openNow).toBe(5);
  });

  it("safety (D171): closed by the duty manager, open and seen, open and not yet seen; the median is over the seen ones, a closing counting as the sight", () => {
    const rows = [
      c({ safetyFlag: true, acknowledgedAt: T0 + 2 * minute }),
      c({ safetyFlag: true, acknowledgedAt: T0 + 10 * minute }),
      c({ safetyFlag: true, acknowledgedAt: T0 + 4 * minute }),
      c({ safetyFlag: true }),
      c({ safetyFlag: true, status: "CLOSED", closeKind: "DUTY_MANAGER", closedAt: T0 + 6 * minute }),
      c({ safetyFlag: true, status: "CLOSED", closeKind: "CONFIRMED", closedAt: T0 + 60 * minute }),
      c({ acknowledgedAt: T0 + 1 * minute }),
    ];
    expect(complaintMetrics(rows, NOW).safety).toEqual({ count: 6, closedByDutyManager: 1, openSeen: 3, openNotSeen: 1, closedOtherWay: 1, medianMinutesToSeen: 4 });
  });

  it("a safety complaint acknowledged and then closed by the duty manager is seen at the acknowledgement, the earlier time", () => {
    const row = c({ safetyFlag: true, status: "CLOSED", closeKind: "DUTY_MANAGER", acknowledgedAt: T0 + 3 * minute, closedAt: T0 + 30 * minute });
    expect(complaintMetrics([row], NOW).safety).toMatchObject({ closedByDutyManager: 1, openSeen: 0, openNotSeen: 0, medianMinutesToSeen: 3 });
  });

  it("safety with nobody having seen it has no median, and with none at all there is no data", () => {
    expect(complaintMetrics([c({ safetyFlag: true })], NOW).safety).toEqual({ count: 1, closedByDutyManager: 0, openSeen: 0, openNotSeen: 1, closedOtherWay: 0, medianMinutesToSeen: null });
    expect(complaintMetrics([c()], NOW).safety.count).toBe(0);
  });
});

describe("RP4b the counts add up (D171, D172), over 2,000 seeded random complaint sets", () => {
  const statuses = ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION", "CLOSED", "REOPENED"] as const;
  const kinds = ["CONFIRMED", "AUTO_CLOSED", "DUTY_MANAGER", null] as const;

  it("safety: closed by the duty manager + open seen + open not yet seen + closed another way = raised, and the complaint counts add up", () => {
    const prng = createPrng(1701);
    for (let set = 0; set < 2000; set++) {
      const rows = Array.from({ length: prng.int(0, 12) }, () => {
        const status = statuses[prng.int(0, statuses.length - 1)];
        const closed = status === "CLOSED";
        return c({ safetyFlag: prng.chance(0.5), status, closeKind: closed ? kinds[prng.int(0, 3)] : null, closedAt: closed ? T0 + prng.int(1, 500) * minute : null, acknowledgedAt: prng.chance(0.5) ? T0 + prng.int(1, 500) * minute : null });
      });
      const m = complaintMetrics(rows, NOW);
      const { safety, closed } = m;
      expect(safety.closedByDutyManager + safety.openSeen + safety.openNotSeen + safety.closedOtherWay).toBe(safety.count);
      expect(closed.byResident + closed.automatically + closed.byDutyManager + closed.other + m.openNow).toBe(m.raised);
    }
  });
});
