import { describe, expect, it } from "vitest";
import { type ReportComplaint, complaintMetrics } from "@/domain/reports/complaints";
import { percent } from "@/domain/reports/stats";

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
  ...over,
});

describe("RP4 complaint metrics on hand-built rows", () => {
  it("no complaints: every count is zero, every median is null and every share would be 'no data'", () => {
    const m = complaintMetrics([], NOW);
    expect(m).toEqual({
      raised: 0,
      firstReply: { replied: 0, medianMinutes: null, decided: 0, withinSla: 0 },
      resolved: { count: 0, medianMinutes: null, reopened: 0 },
      closed: { byResident: 0, automatically: 0 },
      openNow: 0,
      safety: { count: 0, acknowledged: 0, medianMinutesToAcknowledge: null, unacknowledgedNow: 0 },
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

  it("closed by the resident versus by itself; a closure by the duty manager is in neither; only closed complaints count", () => {
    const rows = [
      c({ status: "CLOSED", closeKind: "CONFIRMED" }),
      c({ status: "CLOSED", closeKind: "CONFIRMED" }),
      c({ status: "CLOSED", closeKind: "AUTO_CLOSED" }),
      c({ status: "CLOSED", closeKind: "DUTY_MANAGER", safetyFlag: true }),
      c({ status: "PENDING_CONFIRMATION" }),
    ];
    const m = complaintMetrics(rows, NOW);
    expect(m.closed).toEqual({ byResident: 2, automatically: 1 });
    expect(m.openNow).toBe(1);
    expect(m.raised).toBe(5);
  });

  it("open now counts every status but CLOSED", () => {
    const statuses = ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION", "REOPENED", "CLOSED"] as const;
    expect(complaintMetrics(statuses.map((status) => c({ status, closeKind: status === "CLOSED" ? "CONFIRMED" : null })), NOW).openNow).toBe(5);
  });

  it("safety: the count, the median minutes to acknowledgement, and any still unacknowledged (closed ones are not 'unacknowledged now')", () => {
    const rows = [
      c({ safetyFlag: true, acknowledgedAt: T0 + 2 * minute }),
      c({ safetyFlag: true, acknowledgedAt: T0 + 10 * minute }),
      c({ safetyFlag: true, acknowledgedAt: T0 + 4 * minute }),
      c({ safetyFlag: true }),
      c({ safetyFlag: true, status: "CLOSED", closeKind: "DUTY_MANAGER" }),
      c({ acknowledgedAt: T0 + 1 * minute }),
    ];
    const m = complaintMetrics(rows, NOW);
    expect(m.safety).toEqual({ count: 5, acknowledged: 3, medianMinutesToAcknowledge: 4, unacknowledgedNow: 1 });
  });

  it("safety with no acknowledgement has no median, and with none at all there is no data", () => {
    expect(complaintMetrics([c({ safetyFlag: true })], NOW).safety).toEqual({ count: 1, acknowledged: 0, medianMinutesToAcknowledge: null, unacknowledgedNow: 1 });
    expect(complaintMetrics([c()], NOW).safety.count).toBe(0);
  });
});
