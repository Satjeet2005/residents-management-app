import { describe, expect, it } from "vitest";
import { AGE_BUCKETS } from "@/domain/reports/age";
import { complaintMetrics } from "@/domain/reports/complaints";
import { defaultGoals, evaluateGoals } from "@/domain/reports/goals";
import type { MoneyLine } from "@/domain/reports/money-line";
import { reconciliationLine } from "@/domain/reports/reconciliation";
import type { OnTimePoint } from "@/domain/reports/series";
import type { MonthlySlaPoint } from "@/domain/reports/monthly-sla";
import { buildCards, countText } from "@/lib/reports/cards";
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
  buckets: AGE_BUCKETS.map((bucket) => ({ bucket, flats: bucket === "OVER_90" ? 24 : 100, bills: 10, amountDuePaise: 606_000_000n / 5n })),
  total: { flats: 817, bills: 900, amountDuePaise: 606_000_000n },
};
const point = (period: string, due: number, dueOnTime: number): OnTimePoint => ({ period, due, dueOnTime, paid: dueOnTime + 1, paidOnTime: dueOnTime, headlinePercent: due === 0 ? null : Math.round((100 * dueOnTime) / due), ofPaidPercent: null });
const month = (period: string, decided: number, met: number): MonthlySlaPoint => ({ period, raised: decided, decided, met, sharePercent: decided === 0 ? null : Math.round((100 * met) / decided) });
const rows = evaluateGoals(defaultGoals, { onTime: { n: 7, d: 10 }, firstReply: { n: 17, d: 20 }, reopened: { n: 0, d: 0 } });
const input = {
  money,
  ageing,
  onTime: [point("2026-09-01", 10, 9), point("2026-10-01", 10, 7)],
  sla: { months: [month("2026-08-01", 0, 0), month("2026-09-01", 0, 0), month("2026-10-01", 20, 17)] },
  goals: rows,
};

describe("CD1 the four cards", () => {
  const cards = buildCards(input);

  it("Collected this month: the percent, both amounts in the short form, and the exact figure in full Indian grouping", () => {
    expect(cards.collected).toEqual({ percent: 82, value: "82%", comparison: "₹1.48 crore of ₹1.81 crore", exact: "₹1,48,42,714 of ₹1,80,52,190" });
  });

  it("Total owed: the all-open-dues total in short form, its flats, and the flats over 90 days", () => {
    expect(cards.owed).toEqual({ value: "₹60.6 lakh", comparison: "817 flats", detail: "24 flats are over 90 days" });
  });

  it("Paid on time: the headline against the goal, last month, and six points of trend with a gap", () => {
    expect(cards.onTime).toMatchObject({ percent: 70, value: "70%", lastMonth: "last month 90%" });
    expect(cards.onTime.goal).toMatchObject({ status: "NOT_MET", targetPercent: 90, text: "Goal: At least 90%" });
    expect(cards.onTime.trend).toEqual([
      { label: "Sep", value: 90 },
      { label: "Oct", value: 70 },
    ]);
  });

  it("Replies within the SLA: share against the goal, no previous month without data, and the line's LAST point is the card's figure (D174)", () => {
    expect(cards.sla).toMatchObject({ percent: 85, value: "85%", lastMonth: null });
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
    expect(none.collected).toMatchObject({ percent: null, value: "No data", exact: null });
    expect(none.onTime).toMatchObject({ value: "No data", lastMonth: null });
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
  const quality = { due: 100, dueOnTime: 70, paid: 80, paidOnTime: 70, paidLate: 10, medianDaysToPay: 6 };
  const headlines = sectionHeadlines({ money, ageing, quality, complaints, reconciliation });

  it("says each one in a sentence from the data", () => {
    expect(headlines.money).toBe("₹1.48 crore collected of ₹1.81 crore");
    expect(headlines.owed).toBe("817 flats owe ₹60.6 lakh");
    expect(headlines.quality).toBe("70% paid on time, 88% of paid bills");
    expect(headlines.complaints).toBe("1,603 raised, 85% replied in time");
    expect(headlines.bank).toBe("24 of 106 rows posted automatically");
  });

  it("says so in words when there is nothing to count", () => {
    const empty = sectionHeadlines({ money: null, ageing: { buckets: [], total: { flats: 0, bills: 0, amountDuePaise: 0n } }, quality: null, complaints: complaintMetrics([], 0), reconciliation: reconciliationLine({ states: { QUEUED: 0, AUTO_MATCHED: 0, AWAITING_APPROVAL: 0, MANUALLY_MATCHED: 0, IGNORED: 0 }, imports: [], decisions: [] }) });
    expect(empty).toEqual({ money: "No bills this month", owed: "Nothing is owed", quality: "No bills this month", complaints: "None raised this month", bank: "No bank statement in the last 30 days" });
  });

  it("a flat count of one is singular", () => {
    expect(sectionHeadlines({ money, ageing: { ...ageing, total: { ...ageing.total, flats: 1 } }, quality, complaints, reconciliation }).owed).toBe("1 flat owes ₹60.6 lakh");
  });
});
