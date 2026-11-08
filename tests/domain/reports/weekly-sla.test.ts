import { describe, expect, it } from "vitest";
import { complaintMetrics } from "@/domain/reports/complaints";
import { type SlaComplaint, isoWeekStart, slaShare, weeklySla } from "@/domain/reports/weekly-sla";
import { createPrng } from "@/domain/seed/prng";
import { dayStartInstant } from "@/domain/time/calendar";

const HOUR = 3_600_000;
/** 10:00 India time on a date. */
const at = (date: string, hours = 10) => dayStartInstant(date) + hours * HOUR;
const NOW = at("2026-10-27", 12);
const c = (created: string, dueHours: number | null, replyHours: number | null): SlaComplaint => ({
  createdAt: at(created),
  responseDueAt: dueHours === null ? null : at(created) + dueHours * HOUR,
  firstResponseAt: replyHours === null ? null : at(created) + replyHours * HOUR,
});

describe("WS1 ISO weeks in India time", () => {
  it.each([
    ["2026-10-27", "2026-10-26"],
    ["2026-10-26", "2026-10-26"],
    ["2026-11-01", "2026-10-26"],
    ["2026-11-02", "2026-11-02"],
  ])("the week of %s starts on Monday %s", (date, monday) => {
    expect(isoWeekStart(date)).toBe(monday);
  });

  it("a complaint raised at 23:30 on Sunday India time belongs to that week, not the next", () => {
    const sunday = dayStartInstant("2026-10-25") + 23.5 * HOUR;
    const points = weeklySla([{ createdAt: sunday, responseDueAt: null, firstResponseAt: null }], "2026-10-27", NOW);
    expect(points.at(-2)).toMatchObject({ weekStart: "2026-10-19", raised: 1 });
    expect(points.at(-1)?.raised).toBe(0);
  });
});

describe("WS2 the weekly SLA series", () => {
  const complaints = [
    c("2026-10-26", 4, 2), // MET, this week
    c("2026-10-27", 4, 6), // replied late
    c("2026-10-20", 4, null), // unreplied past due
    c("2026-10-21", 4, 1), // MET
    c("2026-10-14", null, null), // no SLA: not decided
  ];

  it("has eight weeks, oldest first, ending with the week of the end date", () => {
    const points = weeklySla(complaints, "2026-10-27", NOW);
    expect(points).toHaveLength(8);
    expect(points[0].weekStart).toBe("2026-09-07");
    expect(points[7].weekStart).toBe("2026-10-26");
  });

  it("counts MET over MET + MISSED_LATE + MISSED_OPEN: a late first reply is NOT met", () => {
    const points = weeklySla(complaints, "2026-10-27", NOW);
    expect(points[7]).toMatchObject({ raised: 2, decided: 2, met: 1, sharePercent: 50 });
    expect(points[6]).toMatchObject({ raised: 2, decided: 2, met: 1, sharePercent: 50 });
  });

  it("a week with no due complaints is a gap, not 0%", () => {
    const points = weeklySla(complaints, "2026-10-27", NOW);
    expect(points[5]).toMatchObject({ raised: 1, decided: 0, sharePercent: null });
    expect(points[0]).toMatchObject({ raised: 0, decided: 0, sharePercent: null });
  });

  it("a reply exactly at the due time is met, and an unreplied complaint is not decided before its due time", () => {
    expect(slaShare([c("2026-10-27", 4, 4)], NOW)).toMatchObject({ decided: 1, met: 1 });
    expect(slaShare([{ createdAt: NOW, responseDueAt: NOW + HOUR, firstResponseAt: null }], NOW)).toMatchObject({ raised: 1, decided: 0, met: 0 });
  });

  it("the month figure of the cards is the same function: slaShare agrees with complaintMetrics", () => {
    const metrics = complaintMetrics(
      complaints.map((x) => ({ ...x, safetyFlag: false, status: "ASSIGNED" as const, closeKind: null, reopenCount: 0, resolvedAt: null, acknowledgedAt: null })),
      NOW,
    );
    expect(slaShare(complaints, NOW)).toMatchObject({ decided: metrics.firstReply.decided, met: metrics.firstReply.withinSla });
  });

  it("the weeks' raised add up to the complaints inside the window, over 2,000 seeded inputs", () => {
    const r = createPrng(20261029);
    for (let n = 0; n < 2000; n++) {
      const list: SlaComplaint[] = Array.from({ length: r.int(0, 30) }, () => {
        const created = dayStartInstant("2026-08-01") + r.int(0, 100 * 24) * HOUR;
        const due = r.chance(0.9) ? created + r.int(1, 48) * HOUR : null;
        return { createdAt: created, responseDueAt: due, firstResponseAt: r.chance(0.7) ? created + r.int(0, 60) * HOUR : null };
      });
      const points = weeklySla(list, "2026-10-27", NOW);
      const first = dayStartInstant(points[0].weekStart);
      const end = dayStartInstant("2026-11-02");
      const inWindow = list.filter((x) => x.createdAt >= first && x.createdAt < end).length;
      expect(
        points.reduce((sum, p) => sum + p.raised, 0),
        `n=${n}`,
      ).toBe(inWindow);
    }
  });
});
