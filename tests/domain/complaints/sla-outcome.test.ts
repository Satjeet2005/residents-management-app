import { describe, expect, it } from "vitest";
import { slaOutcome, type SlaOutcome } from "@/domain/complaints/sla";
import { slaState } from "@/domain/complaints/lifecycle";
import { type ReportComplaint, complaintMetrics } from "@/domain/reports/complaints";
import { createPrng } from "@/domain/seed/prng";

const DUE = Date.UTC(2026, 9, 10, 6, 30);
const NOW = DUE + 3_600_000;

describe("D150 slaOutcome", () => {
  const table: [string, { responseDueAt: number; firstResponseAt: number | null; now: number }, SlaOutcome][] = [
    ["a reply well before the due time", { responseDueAt: DUE, firstResponseAt: DUE - 60_000, now: NOW }, "MET"],
    ["a reply exactly at the due time (the boundary)", { responseDueAt: DUE, firstResponseAt: DUE, now: NOW }, "MET"],
    ["a reply one millisecond late", { responseDueAt: DUE, firstResponseAt: DUE + 1, now: NOW }, "MISSED_LATE"],
    ["a reply hours late", { responseDueAt: DUE, firstResponseAt: DUE + 7_200_000, now: DUE + 9_000_000 }, "MISSED_LATE"],
    ["a late reply stays late however much time passes", { responseDueAt: DUE, firstResponseAt: DUE + 1, now: DUE + 9e9 }, "MISSED_LATE"],
    ["no reply and the due time passed by a millisecond", { responseDueAt: DUE, firstResponseAt: null, now: DUE + 1 }, "MISSED_OPEN"],
    ["no reply and now is exactly the due time (not yet passed)", { responseDueAt: DUE, firstResponseAt: null, now: DUE }, "NOT_DUE"],
    ["no reply and the due time ahead", { responseDueAt: DUE, firstResponseAt: null, now: DUE - 1 }, "NOT_DUE"],
    ["an on-time reply is met even before the due time has come", { responseDueAt: DUE, firstResponseAt: DUE - 5, now: DUE - 1 }, "MET"],
  ];
  it.each(table)("%s", (_name, input, expected) => {
    expect(slaOutcome(input)).toBe(expected);
  });

  it("no due time at all is NOT_DUE: there is no SLA to meet or miss", () => {
    expect(slaOutcome({ responseDueAt: null, firstResponseAt: null, now: NOW })).toBe("NOT_DUE");
    expect(slaOutcome({ responseDueAt: null, firstResponseAt: DUE, now: NOW })).toBe("NOT_DUE");
  });

  it("property: over 2,000 seeded random complaints the four outcomes add up to the number of complaints, and each agrees with its definition", () => {
    const prng = createPrng(150);
    const counts: Record<SlaOutcome, number> = { MET: 0, MISSED_LATE: 0, MISSED_OPEN: 0, NOT_DUE: 0 };
    for (let i = 0; i < 2000; i++) {
      const due = DUE + prng.int(-5, 5) * 60_000;
      const first = prng.int(0, 3) === 0 ? null : DUE + prng.int(-10, 10) * 60_000;
      const now = DUE + prng.int(-10, 10) * 60_000;
      const outcome = slaOutcome({ responseDueAt: due, firstResponseAt: first, now });
      counts[outcome]++;
      if (first !== null) expect(outcome).toBe(first <= due ? "MET" : "MISSED_LATE");
      else expect(outcome).toBe(now > due ? "MISSED_OPEN" : "NOT_DUE");
    }
    expect(counts.MET + counts.MISSED_LATE + counts.MISSED_OPEN + counts.NOT_DUE).toBe(2000);
    expect(Object.values(counts).every((n) => n > 0)).toBe(true);
  });
});

describe("D150 every SLA figure uses the same outcome", () => {
  const base = { status: "ASSIGNED" as const, responseDueAt: DUE };
  it("the SLA state: a late reply is LATE, never MET; an on-time one is MET; no reply is ON_TIME then OVERDUE", () => {
    expect(slaState({ ...base, firstResponseAt: DUE, now: NOW })).toBe("MET");
    expect(slaState({ ...base, firstResponseAt: DUE + 1, now: NOW })).toBe("LATE");
    expect(slaState({ ...base, firstResponseAt: null, now: DUE })).toBe("ON_TIME");
    expect(slaState({ ...base, firstResponseAt: null, now: DUE + 1 })).toBe("OVERDUE");
    expect(slaState({ ...base, status: "CLOSED", firstResponseAt: DUE + 1, now: NOW })).toBe("NONE");
  });

  it("the committee metric: MET over MET + LATE + OPEN, NOT_DUE left out, and equal to the outcome counts", () => {
    const prng = createPrng(1501);
    const rows: ReportComplaint[] = [];
    for (let i = 0; i < 2000; i++) {
      const created = DUE - 86_400_000;
      rows.push({
        createdAt: created, safetyFlag: false, status: "ASSIGNED", closeKind: null, reopenCount: 0, resolvedAt: null, acknowledgedAt: null, closedAt: null,
        responseDueAt: DUE + prng.int(-5, 5) * 60_000,
        firstResponseAt: prng.int(0, 3) === 0 ? null : DUE + prng.int(-10, 10) * 60_000,
      });
    }
    const now = DUE + 2 * 60_000;
    const outcomes = rows.map((r) => slaOutcome({ responseDueAt: r.responseDueAt, firstResponseAt: r.firstResponseAt, now }));
    const n = (o: SlaOutcome) => outcomes.filter((x) => x === o).length;
    const { firstReply } = complaintMetrics(rows, now);
    expect(firstReply.withinSla).toBe(n("MET"));
    expect(firstReply.decided).toBe(n("MET") + n("MISSED_LATE") + n("MISSED_OPEN"));
  });

  it("a complaint with no due time is outside the SLA figure, replied or not", () => {
    const row: ReportComplaint = { createdAt: DUE, safetyFlag: false, status: "ASSIGNED", closeKind: null, reopenCount: 0, resolvedAt: null, acknowledgedAt: null, closedAt: null, responseDueAt: null, firstResponseAt: DUE + 1 };
    expect(complaintMetrics([row], NOW).firstReply).toMatchObject({ replied: 1, decided: 0, withinSla: 0 });
  });
});
