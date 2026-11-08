import { describe, expect, it } from "vitest";
import { monthlySla } from "@/domain/reports/monthly-sla";
import { percent } from "@/domain/reports/stats";
import { type SlaComplaint, slaShare, weeklySla } from "@/domain/reports/weekly-sla";
import { createPrng } from "@/domain/seed/prng";
import { dayStartInstant } from "@/domain/time/calendar";

const HOUR = 3_600_000;
const NOW = dayStartInstant("2026-10-27") + 12 * HOUR;
const c = (created: string, dueHours: number | null, replyHours: number | null): SlaComplaint => {
  const createdAt = dayStartInstant(created) + 10 * HOUR;
  return { createdAt, responseDueAt: dueHours === null ? null : createdAt + dueHours * HOUR, firstResponseAt: replyHours === null ? null : createdAt + replyHours * HOUR };
};

describe("MS1 the monthly SLA series (D174)", () => {
  it("groups by the month raised in India time, oldest first; a month with nothing due is a gap", () => {
    const complaints = [c("2026-09-30", 4, 2), c("2026-10-01", 4, 6), c("2026-10-02", 4, 1), c("2026-10-03", null, null)];
    const points = monthlySla(complaints, ["2026-08-01", "2026-09-01", "2026-10-01"], NOW);
    expect(points.map((p) => [p.period, p.raised, p.decided, p.met, p.sharePercent])).toEqual([
      ["2026-08-01", 0, 0, 0, null],
      ["2026-09-01", 1, 1, 1, 100],
      ["2026-10-01", 3, 2, 1, 50],
    ]);
  });

  it("the last point equals the card's figure: slaShare of the selected month, over 2,000 seeded random complaint sets", () => {
    const r = createPrng(1704);
    for (let n = 0; n < 2000; n++) {
      const complaints = Array.from({ length: r.int(0, 15) }, () => c(`2026-${["08", "09", "10"][r.int(0, 2)]}-${String(r.int(1, 27)).padStart(2, "0")}`, r.chance(0.9) ? r.int(1, 30) : null, r.chance(0.7) ? r.int(0, 40) : null));
      const selected = complaints.filter((x) => x.createdAt >= dayStartInstant("2026-10-01"));
      const card = slaShare(selected, NOW);
      const last = monthlySla(complaints, ["2026-08-01", "2026-09-01", "2026-10-01"], NOW).at(-1);
      expect(last?.sharePercent, `n=${n}`).toBe(percent(card.met, card.decided));
      expect([last?.decided, last?.met], `n=${n}`).toEqual([card.decided, card.met]);
    }
  });
});

describe("MS2 the weekly series marks the week that is not over", () => {
  it("the week containing the end date is partial unless the end date is its Sunday; the earlier weeks are whole", () => {
    expect(weeklySla([], "2026-10-27", NOW).map((w) => w.partial)).toEqual([false, false, false, false, false, false, false, true]);
    expect(weeklySla([], "2026-11-01", NOW).at(-1)?.partial).toBe(false);
  });
});
