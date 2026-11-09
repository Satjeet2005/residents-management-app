import { describe, expect, it } from "vitest";
import { AGE_BUCKETS } from "@/domain/reports/age";
import { complaintMetrics } from "@/domain/reports/complaints";
import { type GoalRow, defaultGoals, evaluateGoals } from "@/domain/reports/goals";
import type { MoneyLine } from "@/domain/reports/money-line";
import { reconciliationLine } from "@/domain/reports/reconciliation";
import type { MonthlyPoint, OnTimePoint } from "@/domain/reports/series";
import type { MonthlySlaPoint } from "@/domain/reports/monthly-sla";
import { buildCards, countText, goalBarLabel, goalGap, goalText } from "@/lib/reports/cards";
import { sectionHeadlines } from "@/lib/reports/headlines";

const money: MoneyLine = {
  billedPaise: 1_805_219_000n,
  collectedPaise: 1_484_271_400n,
  outstandingPaise: 320_947_600n,
  flatsBilled: 2399,
  flatsPaidInFull: 1915,
  flatsOutstanding: 484,
  fees: { postedPaidPaise: 0n, postedOwingPaise: 0n, accruingPaise: 0n },
};
const ageing = {
  buckets: AGE_BUCKETS.map((bucket) => ({ bucket, flats: bucket === "OVER_90" ? 24 : 100, bills: 10, unpaidBillsPaise: 606_000_000n / 5n, lateFeesPaise: 0n, amountDuePaise: 606_000_000n / 5n })),
  total: { flats: 817, bills: 900, unpaidBillsPaise: 606_000_000n, lateFeesPaise: 0n, amountDuePaise: 606_000_000n },
};
const point = (period: string, due: number, dueOnTime: number): OnTimePoint => ({ period, due, dueOnTime, paid: dueOnTime + 1, paidOnTime: dueOnTime, headlinePercent: due === 0 ? null : Math.round((100 * dueOnTime) / due), ofPaidPercent: null });
const month = (period: string, decided: number, met: number): MonthlySlaPoint => ({ period, raised: decided, decided, met, sharePercent: decided === 0 ? null : Math.round((100 * met) / decided) });
const rows = evaluateGoals(defaultGoals, { onTime: { n: 7, d: 10 }, firstReply: { n: 17, d: 20 }, reopened: { n: 0, d: 0 } });
const monthly: MonthlyPoint[] = [
  { period: "2026-09-01", hasBills: true, billedPaise: 100n, collectedPaise: 93n, outstandingPaise: 7n, collectedPercent: 93, byDay20Percent: 91, byDay20Paise: 91n, inProgress: false },
  { period: "2026-10-01", hasBills: true, billedPaise: 100n, collectedPaise: 82n, outstandingPaise: 18n, collectedPercent: 82, byDay20Percent: 79, byDay20Paise: 79n, inProgress: false },
];
const input = {
  money,
  ageing,
  onTime: [point("2026-09-01", 10, 9), point("2026-10-01", 10, 7)],
  sla: { months: [month("2026-08-01", 0, 0), month("2026-09-01", 0, 0), month("2026-10-01", 20, 17)] },
  goals: rows,
  monthly,
};

describe("CD1 the four cards", () => {
  const cards = buildCards(input);

  it("Collected this month: the percent, both amounts in the short form, and the same-age comparison", () => {
    expect(cards.collected).toEqual({ percent: 82, value: "82%", comparison: "₹1.48 crore of ₹1.81 crore billed", within20: "October within 20 days: 79%", sameAge: "September, at the same age: 91%" });
  });

  it("Total owed: the all-open-dues total in short form, its flats, the amount over 90 days and the split into unpaid bills and late fees", () => {
    expect(cards.owed).toEqual({ value: "₹60.6 lakh", comparison: "817 flats", detail: "₹12.1 lakh is over 90 days", split: "Unpaid ₹60.6 lakh + late fees ₹0" });
  });

  it("Paid on time: the headline against the goal, last month, and six points of trend with a gap", () => {
    expect(cards.onTime).toMatchObject({ percent: 70, value: "70%", previous: { text: "September 90%", direction: "down", change: "down 20 points" } });
    expect(cards.onTime.goal).toMatchObject({ status: "NOT_MET", targetPercent: 90, text: "Goal 90% · 20 points short", gap: "20 points short" });
    expect(cards.onTime.trend).toEqual([
      { label: "Sep", value: 90 },
      { label: "Oct", value: 70 },
    ]);
  });

  it("Replies within the SLA: share against the goal, no previous month without data, and the line's LAST point is the card's figure (D174)", () => {
    expect(cards.sla).toMatchObject({ percent: 85, value: "85%", previous: null });
    expect(cards.sla.goal.status).toBe("NOT_MET");
    expect(cards.sla.trend).toEqual([
      { label: "Aug", value: null },
      { label: "Sep", value: null },
      { label: "Oct", value: 85 },
    ]);
    expect(cards.sla.trend.at(-1)?.value).toBe(cards.sla.percent);
  });

  it("with nothing to measure the values say No data and the goal has no verdict", () => {
    const none = buildCards({ ...input, money: null, onTime: [point("2026-10-01", 0, 0)], sla: { months: [month("2026-10-01", 0, 0)] }, goals: evaluateGoals(defaultGoals, { onTime: { n: 0, d: 0 }, firstReply: { n: 0, d: 0 }, reopened: { n: 0, d: 0 } }) });
    expect(none.collected).toMatchObject({ percent: null, value: "No data" });
    expect(none.onTime).toMatchObject({ value: "No data", previous: null });
    expect(none.onTime.goal.status).toBe("NO_DATA");
    expect(none.sla.value).toBe("No data");
  });

  it("uses Indian grouping for counts", () => {
    expect(countText(1603)).toBe("1,603");
    expect(countText(123_456)).toBe("1,23,456");
  });
});

describe("CD2 the section headlines", () => {
  const states = { QUEUED: 70, AUTO_MATCHED: 24, AWAITING_APPROVAL: 2, MANUALLY_MATCHED: 4, IGNORED: 6 };
  const reconciliation = reconciliationLine({ states, imports: [{ rowsRead: 106, stored: 106, invalidRows: 0, alreadyImported: 0 }], decisions: [] });
  const complaints = { ...complaintMetrics([], 0), raised: 1603, firstReply: { replied: 1400, medianMinutes: 60, decided: 1500, withinSla: 1275 } };
  const quality = { bills: 100, due: 100, dueOnTime: 70, paid: 80, paidOnTime: 70, paidLate: 10, medianDaysToPay: 6 };
  const headlines = sectionHeadlines({ money, ageing, quality, complaints, reconciliation });

  it("says each one in a sentence from the data", () => {
    expect(headlines.money).toBe("Billed ₹1.81 crore · 484 flats still to pay");
    expect(headlines.owed).toBe("₹12.1 lakh is over 90 days");
    expect(headlines.quality).toBe("Typical 6 days to pay · 88% of paid bills were on time");
    expect(headlines.complaints).toBe("1,603 raised, 85% answered in time");
    expect(headlines.bank).toBe("70 bank entries need a person");
  });

  it("says so in words when there is nothing to count", () => {
    const empty = sectionHeadlines({ money: null, ageing: { buckets: [], total: { flats: 0, bills: 0, unpaidBillsPaise: 0n, lateFeesPaise: 0n, amountDuePaise: 0n } }, quality: null, complaints: complaintMetrics([], 0), reconciliation: reconciliationLine({ states: { QUEUED: 0, AUTO_MATCHED: 0, AWAITING_APPROVAL: 0, MANUALLY_MATCHED: 0, IGNORED: 0 }, imports: [], decisions: [] }) });
    expect(empty).toEqual({ money: "No bills this month", owed: "Nothing is owed", quality: "No bills this month", complaints: "None raised this month", bank: "No bank statement in the last 30 days" });
  });

  it("none over 90 days, one bank entry waiting, nobody waiting and every flat paid are said in words", () => {
    const none = { ...ageing, buckets: ageing.buckets.map((b) => (b.bucket === "OVER_90" ? { ...b, bills: 0, flats: 0, unpaidBillsPaise: 0n, lateFeesPaise: 0n, amountDuePaise: 0n } : b)) };
    expect(sectionHeadlines({ money, ageing: none, quality, complaints, reconciliation }).owed).toBe("Nothing is over 90 days");
    const one = reconciliationLine({ states: { ...states, QUEUED: 1 }, imports: [{ rowsRead: 37, stored: 37, invalidRows: 0, alreadyImported: 0 }], decisions: [] });
    expect(sectionHeadlines({ money, ageing, quality, complaints, reconciliation: one }).bank).toBe("1 bank entry needs a person");
    const nobody = reconciliationLine({ states: { ...states, QUEUED: 0 }, imports: [{ rowsRead: 36, stored: 36, invalidRows: 0, alreadyImported: 0 }], decisions: [] });
    expect(sectionHeadlines({ money, ageing, quality, complaints, reconciliation: nobody }).bank).toBe("No bank entry needs a person");
    expect(sectionHeadlines({ money: { ...money, flatsOutstanding: 0 }, ageing, quality, complaints, reconciliation }).money).toBe("Billed ₹1.81 crore · every flat has paid");
  });

  it("a section headline never repeats a card's figure: it carries new information", () => {
    expect(Object.values(headlines).join(" ")).not.toContain("₹1.48 crore");
  });
});

describe("CD3 goal wording and previous period names (D176, D177)", () => {
  const row = (over: Partial<GoalRow>): GoalRow => ({ key: "onTimeCollection", targetPercent: 90, actualPercent: 70, status: "NOT_MET", gapPoints: 20, ...over });

  it.each([
    [row({}), "Goal 90% · 20 points short"],
    [row({ gapPoints: 1 }), "Goal 90% · 1 point short"],
    [row({ status: "MET", gapPoints: 3, actualPercent: 93 }), "Goal 90% · 3 points above"],
    [row({ status: "MET", gapPoints: 0, actualPercent: 90 }), "Goal 90%"],
    [row({ status: "NO_DATA", gapPoints: null, actualPercent: null }), "Goal 90%"],
    [row({ key: "reopenedMax", targetPercent: 8, gapPoints: 2 }), "Limit 8% · 2 points over"],
    [row({ key: "reopenedMax", targetPercent: 8, status: "MET", gapPoints: 3 }), "Limit 8% · 3 points under"],
  ])("%j reads %s", (goal, text) => {
    expect(goalText(goal)).toBe(text);
  });

  it("the previous month is named with the move in points (up, down, same), and left out when it has no figure", () => {
    expect(buildCards(input).onTime.previous?.text).toBe("September 90%");
    const none = buildCards({ ...input, onTime: [point("2026-09-01", 0, 0), point("2026-10-01", 10, 7)] });
    expect(none.onTime.previous).toBeNull();
  });

  it("Collected compares the month with the previous month at the same age, and says 'so far' for a young month", () => {
    expect(buildCards(input).collected).toMatchObject({ within20: "October within 20 days: 79%", sameAge: "September, at the same age: 91%" });
    const young = buildCards({ ...input, monthly: [input.monthly[0], { ...input.monthly[1], inProgress: true }] });
    expect(young.collected.within20).toBe("October so far: 79%");
  });
});

describe("CD4 the previous month's move and the goal bar's sentence", () => {
  const row = (over: Partial<GoalRow>): GoalRow => ({ key: "onTimeCollection", targetPercent: 90, actualPercent: 70, status: "NOT_MET", gapPoints: 20, ...over });
  const onTimeWith = (before: OnTimePoint) => buildCards({ ...input, onTime: [before, point("2026-10-01", 10, 7)] }).onTime.previous;

  it("up, down, the same, and one point in the singular", () => {
    expect(onTimeWith(point("2026-09-01", 10, 6))).toEqual({ text: "September 60%", direction: "up", change: "up 10 points" });
    expect(onTimeWith(point("2026-09-01", 10, 9))).toEqual({ text: "September 90%", direction: "down", change: "down 20 points" });
    expect(onTimeWith(point("2026-09-01", 10, 7))).toEqual({ text: "September 70%", direction: "same", change: "same" });
    expect(onTimeWith(point("2026-09-01", 100, 69))?.change).toBe("up 1 point");
  });

  it.each([
    [row({ targetPercent: 90, status: "NOT_MET", gapPoints: 20 }), "20 points short"],
    [row({ targetPercent: 90, status: "MET", gapPoints: 3 }), "3 points above"],
    [row({ targetPercent: 90, status: "MET", gapPoints: 0 }), "On the goal"],
    [row({ key: "reopenedMax", targetPercent: 8, status: "NOT_MET", gapPoints: 2 }), "2 points over"],
    [row({ key: "reopenedMax", targetPercent: 8, status: "MET", gapPoints: 1 }), "1 point under"],
    [row({ status: "NO_DATA", gapPoints: null }), null],
  ])("the gap of %j is %s", (goal, gap) => {
    expect(goalGap(goal)).toBe(gap);
  });

  it("the bar's sentence names the value, the goal or limit, and the same gap the card prints", () => {
    const mark = buildCards(input).onTime.goal;
    expect(goalBarLabel(70, mark)).toBe("70 percent. Goal 90 percent. 20 points short.");
    expect(mark.text).toContain(mark.gap as string);
    expect(goalBarLabel(6, { key: "reopenedMax", status: "MET", targetPercent: 8, text: "Limit 8% · 2 points under", gap: "2 points under" })).toBe("6 percent. Limit 8 percent. 2 points under.");
    expect(goalBarLabel(null, mark)).toBe("No data.");
    expect(goalBarLabel(70, { ...mark, gap: null })).toBe("70 percent.");
  });
});
