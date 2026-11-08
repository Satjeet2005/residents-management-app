import { describe, expect, it } from "vitest";
import { AGE_BUCKETS } from "@/domain/reports/age";
import { paymentCurve } from "@/domain/reports/payment-curve";
import type { MonthlyPoint } from "@/domain/reports/series";
import type { WeeklyPoint } from "@/domain/reports/weekly-sla";
import { ageingVisual, curvePlainNumbers, curveVisual, monthlyVisual, weeklyVisual } from "@/lib/reports/visuals";

const point = (period: string, billed: bigint, collected: bigint): MonthlyPoint => ({
  period,
  hasBills: billed > 0n,
  billedPaise: billed,
  collectedPaise: collected,
  outstandingPaise: billed - collected,
  collectedPercent: billed === 0n ? null : Number((200n * collected + billed) / (2n * billed)),
  byDay20Percent: billed === 0n ? null : Number((200n * collected + billed) / (2n * billed)),
  inProgress: false,
});

describe("VZ1 the monthly visual: one text and one table for the phone bars and the laptop columns", () => {
  const visual = monthlyVisual([point("2026-08-01", 0n, 0n), point("2026-09-01", 1_000_000n, 790_000n), point("2026-10-01", 1_000_000n, 820_000n)]);

  it("the takeaway is computed from the series, and the gap is skipped", () => {
    expect(visual.text.description).toBe("Collected share of each month's billing. Oct was 82%, up from Sep (79%).");
  });

  it("the table has every month with the full Indian grouping, and 'No data' for a month without bills", () => {
    expect(visual.text.table.rows[0]).toEqual({ header: "August 2026", cells: ["No data", "No data", "No data", "No data"] });
    expect(visual.text.table.rows[2]).toEqual({ header: "October 2026", cells: ["₹10,000", "₹8,200", "₹1,800", "82%"] });
  });

  it("the bars and the columns carry the same percents, in the same order", () => {
    expect(visual.rows.map((r) => r.valueText)).toEqual(["No data", "79%", "82%"]);
    expect(visual.columns.map((c) => c.percentText)).toEqual(["No data", "79%", "82%"]);
    expect(visual.columns[2]).toMatchObject({ collected: 820_000, outstanding: 180_000, hasData: true });
  });
});

describe("VZ2 the ageing visual", () => {
  const ageing = {
    buckets: AGE_BUCKETS.map((bucket, i) => ({ bucket, flats: i + 1, bills: i + 2, unpaidBillsPaise: BigInt(i === 3 ? 50_000_000 : 1_000_000), lateFeesPaise: 0n, amountDuePaise: BigInt(i === 3 ? 50_000_000 : 1_000_000) })),
    total: { flats: 15, bills: 20, unpaidBillsPaise: 54_000_000n, lateFeesPaise: 0n, amountDuePaise: 54_000_000n },
  };
  const visual = ageingVisual(ageing);

  it("has five rows with the oldest hatched, and names the largest group in the takeaway", () => {
    expect(visual.rows).toHaveLength(5);
    expect(visual.rows.map((r) => r.emphasis)).toEqual([undefined, undefined, undefined, undefined, "warning"]);
    expect(visual.text.description).toBe("61 to 90 days holds the most: ₹5.0 lakh of the ₹5.4 lakh owed.");
  });

  it("the table has the flats, bills and the full amount of every group", () => {
    expect(visual.text.table.rows[3]).toEqual({ header: "61 to 90 days", cells: ["4", "5", "₹5,00,000"] });
  });
});

describe("VZ3 the payment curve visual", () => {
  const curve = paymentCurve({ bills: [{ amountPaise: 1_000_000n, payments: [{ date: "2026-10-03", amountPaise: 700_000n }] }], issueDate: "2026-10-01", dueDate: "2026-10-10", asOf: "2026-10-27" });

  it("the plain numbers and the takeaway say by the due date, by day 20 and now", () => {
    expect(curve && curvePlainNumbers(curve)).toEqual({ due: "70%", day20: "70%", now: "70%" });
    expect(curveVisual(curve, 90).text.description).toBe("By the due date 70% of the billing was collected, by day 20 70%, and 70% so far.");
  });

  it("before day 20 and before the due date the missing numbers are left out or said in words", () => {
    const early = paymentCurve({ bills: [{ amountPaise: 1_000_000n, payments: [] }], issueDate: "2026-10-01", dueDate: "2026-10-10", asOf: "2026-10-05" });
    expect(early && curvePlainNumbers(early)).toEqual({ due: "not yet due", day20: null, now: "0%" });
    expect(curveVisual(early, 90).marker).toBeNull();
  });

  it("marks the due day, draws the goal, and the table lists every plotted day", () => {
    const visual = curveVisual(curve, 90);
    expect(visual.marker).toEqual({ x: 9, label: "Due date" });
    expect(visual.goal).toEqual({ percent: 90, label: "Goal 90%" });
    expect(visual.text.table.rows).toHaveLength(curve?.points.length as number);
    expect(visual.series[0].points).toHaveLength(curve?.points.length as number);
  });

  it("no bills gives an empty curve with a description in words", () => {
    expect(curveVisual(null, 90).text.description).toBe("The month has no bills, so there is no curve.");
  });
});

describe("VZ4 the weekly SLA visual", () => {
  const week = (weekStart: string, raised: number, decided: number, met: number): WeeklyPoint => ({ weekStart, raised, decided, met, sharePercent: decided === 0 ? null : Math.round((100 * met) / decided), partial: false });
  const goal = { key: "firstReplyWithinSla" as const, status: "NOT_MET" as const, targetPercent: 90, text: "Goal: At least 90%" };
  const visual = weeklyVisual([week("2026-10-12", 4, 4, 4), week("2026-10-19", 3, 0, 0), week("2026-10-26", 5, 5, 3)], goal, "2026-10-27");

  it("has a gap for the week with nothing due, the table says No data, and the takeaway compares with the last known week", () => {
    expect(visual.series[0].points.map((p) => p.y)).toEqual([100, null, 60]);
    expect(visual.text.table.rows[1]).toEqual({ header: "19 Oct", cells: ["3", "No data"] });
    expect(visual.text.description).toBe("26 Oct was 60%, down from 12 Oct (100%). Goal: At least 90%: Not met.");
  });

  it("the part-finished last week is a hollow marker labelled 'this week so far', in the chart and in the table; a week cut by the month's end says 'part week'", () => {
    const partial = (asOf: string) => weeklyVisual([week("2026-10-19", 3, 3, 3), { ...week("2026-10-26", 5, 5, 3), partial: true }], goal, asOf);
    const soFar = partial("2026-10-27");
    expect(soFar.series[0]).toMatchObject({ partialIndex: 1, partialLabel: "this week so far" });
    expect(soFar.text.table.rows[1].header).toBe("26 Oct (this week so far)");
    expect(partial("2026-11-08").series[0]).toMatchObject({ partialIndex: 1, partialLabel: "part week" });
    expect(visual.series[0].partialIndex).toBeUndefined();
    expect(visual.text.table.rows[2].header).toBe("26 Oct");
  });
});
