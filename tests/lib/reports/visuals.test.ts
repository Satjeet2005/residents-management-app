import { describe, expect, it } from "vitest";
import { paymentCurve } from "@/domain/reports/payment-curve";
import type { MonthlyPoint } from "@/domain/reports/series";
import type { WeeklyPoint } from "@/domain/reports/weekly-sla";
import { curvePlainNumbers, curveVisual, monthlyVisual, weeklyVisual } from "@/lib/reports/visuals";

const point = (period: string, billed: bigint, collected: bigint): MonthlyPoint => ({
  period,
  hasBills: billed > 0n,
  billedPaise: billed,
  collectedPaise: collected,
  outstandingPaise: billed - collected,
  collectedPercent: billed === 0n ? null : Number((200n * collected + billed) / (2n * billed)),
  byDay20Percent: billed === 0n ? null : Number((200n * collected + billed) / (2n * billed)),
  byDay20Paise: collected,
  inProgress: false,
});

describe("VZ1 the monthly visual: every month at the same age, one text and one table per width (D173)", () => {
  const young = { ...point("2026-10-01", 1_000_000n, 820_000n), byDay20Percent: 70, byDay20Paise: 700_000n, inProgress: true };
  const sep = { ...point("2026-09-01", 1_000_000n, 960_000n), byDay20Percent: 79, byDay20Paise: 790_000n };
  const visual = monthlyVisual([point("2026-08-01", 0n, 0n), sep, young]);

  it("the takeaway is about the share within 20 days, computed from the series, with the young month said to be so far", () => {
    expect(visual.text.description).toBe("Share of each month's bills paid within 20 days of the bill. Oct was 70%, down from Sep (79%). October is still younger than 20 days, so its figure is so far. Months before billing started are not shown.");
    expect(visual.text.title).toBe("Collected within 20 days of the bill, month by month");
  });

  it("a month without bills is not drawn and not listed, and the chart description (not a line of the page) says that months before billing started are not shown; the same-age line moved into the page's expander", () => {
    expect(visual.rows.map((r) => r.label)).toEqual(["Sep", "Oct so far"]);
    expect(visual.text.description).toContain("Months before billing started are not shown.");
    expect(visual.phoneText.description).toContain("Months before billing started are not shown.");
    expect(monthlyVisual([sep, point("2026-10-01", 1n, 1n)]).text.description).not.toContain("Months before billing");
  });

  it("the table of the columns holds both measures: within 20 days and still unpaid today, in full Indian grouping", () => {
    expect(visual.text.table.columns).toEqual(["Month", "Billed", "Within 20 days", "Collected today", "Still unpaid today"]);
    expect(visual.text.table.rows[1]).toEqual({ header: "October 2026 so far", cells: ["₹10,000", "70% so far", "82%", "₹1,800"] });
  });

  it("the table of the phone has THREE columns, so it needs no sideways scroll, with the unpaid amount in lakh", () => {
    expect(visual.phoneText.table.columns).toEqual(["Month", "Within 20 days", "Still unpaid today (lakh)"]);
    expect(visual.phoneText.table.rows[0]).toEqual({ header: "September 2026", cells: ["79%", "₹400"] });
    expect(visual.phoneText.table.rows.every((r) => r.cells.length === 2)).toBe(true);
  });

  it("the bars and the columns carry the same percents, in the same order, plotted by day 20 and not by today; the young month is dotted and says so", () => {
    expect(visual.rows.map((r) => r.valueText)).toEqual(["79%", "70% so far"]);
    expect(visual.rows.map((r) => r.value)).toEqual([79, 70]);
    expect(visual.rows.map((r) => r.emphasis)).toEqual([undefined, "partial"]);
    expect(visual.columns.map((c) => c.percentText)).toEqual(["79%", "70% so far"]);
    expect(visual.columns[1]).toMatchObject({ collected: 700_000, outstanding: 300_000, hasData: true, partial: true });
    expect(visual.columns[0]).toMatchObject({ collected: 790_000, outstanding: 210_000 });
  });
});

describe("VZ3 the payment curve visual", () => {
  const curve = paymentCurve({ bills: [{ amountPaise: 1_000_000n, payments: [{ date: "2026-10-03", amountPaise: 700_000n }] }], issueDate: "2026-10-01", dueDate: "2026-10-10", asOf: "2026-10-27" });

  it("the plain numbers and the takeaway say by the due date, by day 20 and now", () => {
    expect(curve && curvePlainNumbers(curve)).toEqual({ due: "70%", day20: "70%", now: "70%" });
    expect(curveVisual(curve, 90, "2026-10-01").text.description).toBe("By the due date 70% of the billing was collected, by day 20 70%, and 70% so far.");
  });

  it("before day 20 and before the due date the missing numbers are left out or said in words", () => {
    const early = paymentCurve({ bills: [{ amountPaise: 1_000_000n, payments: [] }], issueDate: "2026-10-01", dueDate: "2026-10-10", asOf: "2026-10-05" });
    expect(early && curvePlainNumbers(early)).toEqual({ due: "not yet due", day20: null, now: "0%" });
    expect(curveVisual(early, 90, "2026-10-01").marker).toBeNull();
  });

  it("marks the due day, draws the goal, and the table lists every plotted day", () => {
    const visual = curveVisual(curve, 90, "2026-10-01");
    expect(visual.marker).toEqual({ x: 9, label: "70% paid by the due date" });
    expect(visual.text.title).toBe("How fast October's money came in");
    expect(visual.note).toBe("Line stops at today.");
    expect(visual.goal).toEqual({ percent: 90, label: "Goal 90%" });
    expect(visual.text.table.rows).toHaveLength(curve?.points.length as number);
    expect(visual.series[0].points).toHaveLength(curve?.points.length as number);
  });

  it("the note says where the line stops: today while the month is young, day 45 once it is older", () => {
    const old = paymentCurve({ bills: [{ amountPaise: 1_000_000n, payments: [] }], issueDate: "2026-08-01", dueDate: "2026-08-10", asOf: "2026-10-27" });
    expect(curveVisual(old, 90, "2026-08-01").note).toBe("The line shows the first 45 days after the bill.");
    expect(curveVisual(null, 90, "2026-08-01").note).toBeNull();
  });

  it("the weekly chart writes the value above every point but the last, which has its name and value at its end", () => {
    const week = (weekStart: string, share: number | null) => ({ weekStart, raised: 3, decided: 3, met: 2, sharePercent: share, partial: false });
    const goal = { key: "firstReplyWithinSla" as const, status: "NOT_MET" as const, targetPercent: 90, text: "Goal 90%", gap: "3 points short" };
    expect(weeklyVisual([week("2026-10-12", 67), week("2026-10-19", 80)], goal, "2026-10-27").series[0].valueLabels).toBe(true);
  });

  it("no bills gives an empty curve with a description in words", () => {
    expect(curveVisual(null, 90, "2026-10-01").text.description).toBe("The month has no bills, so there is no curve.");
  });
});

describe("VZ4 the weekly SLA visual", () => {
  const week = (weekStart: string, raised: number, decided: number, met: number): WeeklyPoint => ({ weekStart, raised, decided, met, sharePercent: decided === 0 ? null : Math.round((100 * met) / decided), partial: false });
  const goal = { key: "firstReplyWithinSla" as const, status: "NOT_MET" as const, targetPercent: 90, text: "Goal: At least 90%", gap: "3 points short" };
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
