import { describe, expect, it } from "vitest";
import { ageingTable } from "@/domain/reports/age";
import { collectionQuality, moneyLine } from "@/domain/reports/money-line";
import { lastPeriods, previousPeriod } from "@/domain/reports/periods";
import { collectedByDay, monthlySeries, onTimeRateByPeriod } from "@/domain/reports/series";
import { createPrng } from "@/domain/seed/prng";
import { type FlatSpec, bill, entry, lateFee, payment, positionsOf, randomFlat } from "./report-helpers";

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
    const series = monthlySeries(positions, ["2026-08-01", "2026-09-01", "2026-10-01"], AS_OF);
    expect(series[0]).toMatchObject({ hasBills: false, billedPaise: 0n, collectedPercent: null });
    expect(series[1]).toMatchObject({ hasBills: true, billedPaise: 600_000n, collectedPaise: 600_000n, outstandingPaise: 0n, collectedPercent: 100 });
    expect(series[2]).toMatchObject({ billedPaise: 700_000n, collectedPaise: 300_000n, outstandingPaise: 400_000n, collectedPercent: 43 });
  });

  it("collected and outstanding are not swapped: a bill with 30% paid has collectedPercent 30", () => {
    const only = bill("2026-10-01", 1_000_000n);
    const [point] = monthlySeries(positionsOf([flat("T01-0002", [only], [payment(only.id, 300_000n, "2026-10-05")])], AS_OF), ["2026-10-01"], AS_OF);
    expect(point.collectedPaise).toBe(300_000n);
    expect(point.outstandingPaise).toBe(700_000n);
    expect(point.collectedPercent).toBe(30);
  });
});

describe("SE2b collected within 20 days of the bill (D173)", () => {
  const one = (amount: bigint, entries: (id: string) => ReturnType<typeof payment>[], asOf = AS_OF) => {
    const b = bill("2026-09-01", amount);
    return positionsOf([flat("T01-0003", [b], entries(b.id))], asOf);
  };

  it.each([
    ["a payment on day 20 counts", (id: string) => [payment(id, 500_000n, "2026-09-21")], 50, false],
    ["a payment on day 21 does not", (id: string) => [payment(id, 500_000n, "2026-09-22")], 0, false],
    ["a payment on the issue date counts", (id: string) => [payment(id, 250_000n, "2026-09-01")], 25, false],
    ["part payments add up inside the window only", (id: string) => [payment(id, 250_000n, "2026-09-05"), payment(id, 250_000n, "2026-09-20"), payment(id, 500_000n, "2026-09-30")], 50, false],
    ["nothing paid is 0 percent, not no data", () => [], 0, false],
  ])("%s", (_name, entries, expected, inProgress) => {
    expect(collectedByDay(one(1_000_000n, entries), AS_OF)).toMatchObject({ percent: expected, inProgress });
  });

  it("a late fee paid above the bill is never counted: the share is capped at the bill", () => {
    const entries = (id: string) => [payment(id, 1_000_000n, "2026-09-10"), payment(id, 40_000n, "2026-09-12"), lateFee(id, 40_000n, "2026-09-12")];
    expect(collectedByDay(one(1_000_000n, entries), AS_OF).percent).toBe(100);
  });

  it("a reversed payment does not count", () => {
    const entries = (id: string) => {
      const p = payment(id, 600_000n, "2026-09-05");
      return [p, entry({ entryType: "REVERSAL", direction: "CHARGE", amountPaise: 600_000n, effectiveDate: "2026-09-08", billId: id, reversesEntryId: p.id }), payment(id, 100_000n, "2026-09-09")];
    };
    expect(collectedByDay(one(1_000_000n, entries), AS_OF).percent).toBe(10);
  });

  it("a month whose day 20 is after the as-of date is read up to the as-of date and flagged in progress", () => {
    const b = bill("2026-10-01", 1_000_000n);
    const early = positionsOf([flat("T01-0004", [b], [payment(b.id, 300_000n, "2026-10-05"), payment(b.id, 200_000n, "2026-10-15")])], "2026-10-10");
    expect(collectedByDay(early, "2026-10-10")).toMatchObject({ percent: 30, inProgress: true });
    expect(collectedByDay(early, "2026-10-21")).toMatchObject({ percent: 30, inProgress: false });
  });

  it("no bills is no data", () => {
    expect(collectedByDay([], AS_OF)).toEqual({ paise: 0n, percent: null, inProgress: false });
  });

  it("monthlySeries carries both measures: older months by day 20 are close to today, the young month differs", () => {
    const a = bill("2026-09-01", 1_000_000n);
    const b = bill("2026-10-01", 1_000_000n);
    const positions = positionsOf([flat("T01-0005", [a, b], [payment(a.id, 500_000n, "2026-09-10"), payment(a.id, 500_000n, "2026-10-20"), payment(b.id, 600_000n, "2026-10-12")])], AS_OF);
    const [sep, oct] = monthlySeries(positions, ["2026-09-01", "2026-10-01"], AS_OF);
    expect(sep).toMatchObject({ byDay20Percent: 50, collectedPercent: 100, inProgress: false });
    expect(oct).toMatchObject({ byDay20Percent: 60, collectedPercent: 60, inProgress: false });
    expect(monthlySeries(positions, ["2026-10-01"], "2026-10-15")[0]).toMatchObject({ inProgress: true });
  });

  it("over 2,000 seeded random flat sets: by day 20 never exceeds today's share, and neither exceeds 100", () => {
    const r = createPrng(1703);
    for (let n = 0; n < 2000; n++) {
      const positions = positionsOf(Array.from({ length: r.int(1, 6) }, (_, i) => randomFlat(r.fork(`d${n}-${i}`), i)), AS_OF);
      for (const point of monthlySeries(positions, [...new Set(positions.map((p) => p.bill.period))].sort(), AS_OF)) {
        expect(point.byDay20Percent as number, `n=${n}`).toBeLessThanOrEqual(point.collectedPercent as number);
        expect(point.collectedPercent as number).toBeLessThanOrEqual(100);
      }
    }
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
      const series = monthlySeries(positions, periods, AS_OF);
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
