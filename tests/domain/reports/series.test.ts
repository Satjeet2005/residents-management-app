import { describe, expect, it } from "vitest";
import { ageingTable } from "@/domain/reports/age";
import { collectionQuality, moneyLine } from "@/domain/reports/money-line";
import { lastPeriods, previousPeriod } from "@/domain/reports/periods";
import { monthlySeries, onTimeRateByPeriod } from "@/domain/reports/series";
import { createPrng } from "@/domain/seed/prng";
import { type FlatSpec, bill, payment, positionsOf, randomFlat } from "./report-helpers";

const AS_OF = "2026-10-27";
const flat = (code: string, bills: ReturnType<typeof bill>[], entries: ReturnType<typeof payment>[] = []): FlatSpec => ({ flatId: `id-${code}`, flatCode: code, bills, entries });

describe("SE1 period helpers", () => {
  it.each([
    ["2026-10-01", "2026-09-01"],
    ["2026-01-01", "2025-12-01"],
    ["2026-03-15", "2026-02-01"],
  ])("previousPeriod %s is %s", (period, expected) => {
    expect(previousPeriod(period)).toBe(expected);
  });

  it("the last six months end at the selected month, oldest first, across a year end", () => {
    expect(lastPeriods("2026-02-01", "2026-10-27")).toEqual(["2025-09-01", "2025-10-01", "2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  });

  it("a selected month in the future ends the list at the business month: never a future month", () => {
    const periods = lastPeriods("2027-03-01", AS_OF);
    expect(periods.at(-1)).toBe("2026-10-01");
    expect(periods).toHaveLength(6);
    expect(periods.every((p) => p <= "2026-10-01")).toBe(true);
  });
});

describe("SE2 the monthly series", () => {
  const a = bill("2026-09-01", 600_000n);
  const b = bill("2026-10-01", 700_000n);
  const positions = positionsOf([flat("T01-0001", [a, b], [payment(a.id, 600_000n, "2026-09-05"), payment(b.id, 300_000n, "2026-10-12")])], AS_OF);

  it("each period holds its billed, collected and outstanding, and a month without bills is a gap", () => {
    const series = monthlySeries(positions, ["2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(series[0]).toMatchObject({ hasBills: false, billedPaise: 0n, collectedPercent: null });
    expect(series[1]).toMatchObject({ hasBills: true, billedPaise: 600_000n, collectedPaise: 600_000n, outstandingPaise: 0n, collectedPercent: 100 });
    expect(series[2]).toMatchObject({ billedPaise: 700_000n, collectedPaise: 300_000n, outstandingPaise: 400_000n, collectedPercent: 43 });
  });

  it("collected and outstanding are not swapped: a bill with 30% paid has collectedPercent 30", () => {
    const only = bill("2026-10-01", 1_000_000n);
    const [point] = monthlySeries(positionsOf([flat("T01-0002", [only], [payment(only.id, 300_000n, "2026-10-05")])], AS_OF), ["2026-10-01"]);
    expect(point.collectedPaise).toBe(300_000n);
    expect(point.outstandingPaise).toBe(700_000n);
    expect(point.collectedPercent).toBe(30);
  });
});

describe("SE3 on-time rates by period", () => {
  const a = bill("2026-09-01", 600_000n);
  const b = bill("2026-10-01", 600_000n);
  const c = bill("2026-10-01", 600_000n);
  const d = bill("2026-10-01", 600_000n);
  const positions = positionsOf(
    [
      flat("T01-0001", [a], [payment(a.id, 600_000n, "2026-09-12")]),
      flat("T01-0002", [b], [payment(b.id, 600_000n, "2026-10-08")]),
      flat("T01-0003", [c], [payment(c.id, 600_000n, "2026-10-20")]),
      flat("T01-0004", [d]),
    ],
    AS_OF,
  );

  it("the headline counts on-time payments over ALL bills due; the secondary rate over paid bills only", () => {
    const [sep, oct] = onTimeRateByPeriod(positions, ["2026-09-01", "2026-10-01"], AS_OF);
    expect(sep).toMatchObject({ due: 1, dueOnTime: 0, headlinePercent: 0, ofPaidPercent: 0 });
    expect(oct).toMatchObject({ due: 3, dueOnTime: 1, paid: 2, paidOnTime: 1, headlinePercent: 33, ofPaidPercent: 50 });
  });

  it("a period without bills is a gap, and a period whose bills are not yet due has no headline", () => {
    const [none, early] = onTimeRateByPeriod(positions, ["2026-08-01", "2026-10-01"], "2026-10-05");
    expect(none).toMatchObject({ due: 0, headlinePercent: null, ofPaidPercent: null });
    expect(early.headlinePercent).toBeNull();
  });
});

describe("SE4 properties over 2,000 seeded random inputs", () => {
  it("Billed = Collected + Outstanding, collected never exceeds billed, ageing sums to the total, and the series equals each period alone", () => {
    const r = createPrng(20261027);
    for (let n = 0; n < 2000; n++) {
      const flats = Array.from({ length: r.int(1, 8) }, (_, i) => randomFlat(r.fork(`f${n}-${i}`), i));
      const positions = positionsOf(flats, AS_OF);
      const periods = [...new Set(positions.map((p) => p.bill.period))].sort();
      const series = monthlySeries(positions, periods);
      const rates = onTimeRateByPeriod(positions, periods, AS_OF);
      series.forEach((point, i) => {
        const alone = positions.filter((p) => p.bill.period === point.period);
        const line = moneyLine(alone);
        expect(point.billedPaise, `n=${n}`).toBe(point.collectedPaise + point.outstandingPaise);
        expect(point.collectedPaise <= point.billedPaise, `n=${n}`).toBe(true);
        expect([point.billedPaise, point.collectedPaise, point.outstandingPaise], `n=${n}`).toEqual([line.billedPaise, line.collectedPaise, line.outstandingPaise]);
        const q = collectionQuality(alone, AS_OF);
        expect([rates[i].due, rates[i].dueOnTime, rates[i].paid, rates[i].paidOnTime], `n=${n}`).toEqual([q.due, q.dueOnTime, q.paid, q.paidOnTime]);
      });
      const totals = series.reduce((sum, p) => ({ billed: sum.billed + p.billedPaise, collected: sum.collected + p.collectedPaise }), { billed: 0n, collected: 0n });
      const all = moneyLine(positions);
      expect([totals.billed, totals.collected], `n=${n}`).toEqual([all.billedPaise, all.collectedPaise]);
      const ageing = ageingTable(positions, AS_OF);
      expect(ageing.buckets.reduce((sum, b) => sum + b.amountDuePaise, 0n), `n=${n}`).toBe(ageing.total.amountDuePaise);
    }
  });
});
